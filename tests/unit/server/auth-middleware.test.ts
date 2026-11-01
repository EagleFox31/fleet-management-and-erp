import { beforeEach, describe, expect, it, vi } from "vitest";

// Les gardes lisent l'utilisateur en base: on remplace `storage` pour rester sans DB.
const getUser = vi.fn();
vi.mock("../../../server/storage", () => ({ storage: { getUser: (id: number) => getUser(id) } }));
// `authenticate` relit le compte par `findActiveSessionUser` (vrai code), qui interroge `db` :
// seule la base est simulée, pour que l'échec de lecture traverse le vrai chemin service → garde.
const selectUsers = vi.fn();
vi.mock("../../../server/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: () => selectUsers() }) }) }) },
}));

import {
  authenticate,
  isAdmin,
  isAnyUser,
  isDriverManager,
  isFuelCardManager,
  isFuelRecordWriter,
  isInventoryManager,
  isManagementOrAdmin,
  isPartRequester,
  isPartsCatalogManager,
  isSessionGuard,
  isStaff,
  isStockIssuer,
  isTechnician,
  isTireCatalogManager,
  isWorkshopManager,
  normalizeRole,
} from "../../../server/middleware/auth";
import { ALL_APP_ROLES, DRIVER_MANAGER_ROLES } from "../../../shared/constants/roles";

/**
 * Matrice RBAC des gardes serveur (plan de couverture, T1 niveau U).
 *
 * Changer une ligne de cette table est une décision de sécurité : elle doit
 * suivre `docs/analysis/MATRICE_ROLES_GAP.md`, pas l'inverse.
 */
type Guard = (req: unknown, res: unknown, next: () => void) => unknown;

const MATRIX: Record<string, { guard: Guard; allowed: string[] }> = {
  isAdmin: { guard: isAdmin as Guard, allowed: ["admin"] },
  isWorkshopManager: { guard: isWorkshopManager as Guard, allowed: ["admin", "workshop_manager"] },
  isTechnician: { guard: isTechnician as Guard, allowed: ["admin", "workshop_manager", "technician"] },
  isInventoryManager: {
    guard: isInventoryManager as Guard,
    allowed: ["admin", "workshop_manager", "warehouse", "secretary"],
  },
  // Le technicien demande la pièce, il ne se sert pas lui-même.
  isStockIssuer: { guard: isStockIssuer as Guard, allowed: ["admin", "warehouse", "workshop_manager"] },
  isPartsCatalogManager: { guard: isPartsCatalogManager as Guard, allowed: ["admin", "warehouse"] },
  // Régression connue : le magasinier était bloqué en 403 sur le catalogue pneus.
  isTireCatalogManager: { guard: isTireCatalogManager as Guard, allowed: ["admin", "warehouse"] },
  isPartRequester: {
    guard: isPartRequester as Guard,
    allowed: ["admin", "workshop_manager", "technician", "warehouse"],
  },
  isDriverManager: { guard: isDriverManager as Guard, allowed: ["admin", "logistics", "secretary"] },
  isFuelCardManager: { guard: isFuelCardManager as Guard, allowed: ["admin", "logistics", "secretary"] },
  // Saisie d'un plein : ni technicien, ni chauffeur (qui passe par sa mission).
  isFuelRecordWriter: {
    guard: isFuelRecordWriter as Guard,
    allowed: ["admin", "workshop_manager", "secretary", "logistics"],
  },
  isManagementOrAdmin: { guard: isManagementOrAdmin as Guard, allowed: ["admin", "management"] },
  isAnyUser: { guard: isAnyUser as Guard, allowed: [...ALL_APP_ROLES] },
  // Saisies d'exploitation sur un véhicule (kilométrage, position) : un client consulte, il ne saisit pas.
  isStaff: { guard: isStaff as Guard, allowed: ALL_APP_ROLES.filter((role) => role !== "client") },
};

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

async function run(guard: Guard, session: { userId?: number } | undefined) {
  const req: Record<string, unknown> = { session, method: "GET", path: "/test" };
  const res = fakeRes();
  const next = vi.fn();
  await guard(req, res, next);
  return { req, res, next };
}

beforeEach(() => {
  getUser.mockReset();
  selectUsers.mockReset();
  process.env.AUTH_DEBUG = "0";
});

describe("normalizeRole", () => {
  it("ramène les alias français au rôle canonique", () => {
    expect(normalizeRole("Technicien")).toBe("technician");
    expect(normalizeRole(" magasinier ")).toBe("warehouse");
    expect(normalizeRole("DG")).toBe("management");
    expect(normalizeRole("secrétaire")).toBe("secretary");
  });

  it("rabat un rôle inconnu ou vide sur le rôle sans droit", () => {
    expect(normalizeRole("superadmin")).toBe("user");
    expect(normalizeRole(null)).toBe("user");
    expect(normalizeRole("")).toBe("user");
  });
});

describe("authenticate", () => {
  it("401 sans session, next() avec une session", async () => {
    const anonymous = await run(authenticate as Guard, undefined);
    expect(anonymous.res.statusCode).toBe(401);
    expect(anonymous.next).not.toHaveBeenCalled();

    const empty = await run(authenticate as Guard, {});
    expect(empty.res.statusCode).toBe(401);

    selectUsers.mockResolvedValue([{ id: 1, role: "technician", deletedAt: null }]);
    const logged = await run(authenticate as Guard, { userId: 1 });
    expect(logged.next).toHaveBeenCalledOnce();
  });

  // Le filtre `deleted_at IS NULL` est en SQL : un compte supprimé revient comme un compte
  // inconnu (aucune ligne). Prouvé sur base par tests/integration/session-user.test.ts.
  it("relit le compte : aucune ligne active (supprimé ou inconnu) est refusé (401)", async () => {
    selectUsers.mockResolvedValue([]);
    const unknown = await run(authenticate as Guard, { userId: 99 });
    expect(unknown.res.statusCode).toBe(401);
    expect(unknown.next).not.toHaveBeenCalled();
  });

  it("échec de lecture du compte : 500 sans détail, jamais next()", async () => {
    // L'erreur naît dans la requête SQL et traverse findActiveSessionUser : c'est le chemin réel
    // d'une coupure de base. storage.getUser (qui l'avalait en 401) n'est plus consulté.
    selectUsers.mockRejectedValue(new Error("connexion perdue : SELECT secret"));
    const failed = await run(authenticate as Guard, { userId: 1 });
    expect(selectUsers).toHaveBeenCalledOnce();
    expect(getUser).not.toHaveBeenCalled();
    expect(failed.res.statusCode).toBe(500);
    expect(JSON.stringify(failed.res.body)).not.toMatch(/SELECT|connexion/);
    expect(failed.next).not.toHaveBeenCalled();
  });
});

describe.each(Object.entries(MATRIX))("%s", (_name, { guard, allowed }) => {
  it("est marqué comme garde de session", () => {
    expect(isSessionGuard(guard)).toBe(true);
  });

  it("401 sans session, sans lire la base", async () => {
    const { res, next } = await run(guard, undefined);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("401 si l'utilisateur de la session n'existe plus", async () => {
    getUser.mockResolvedValue(undefined);
    const { res, next } = await run(guard, { userId: 99 });
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([...ALL_APP_ROLES])("rôle %s", async (role) => {
    getUser.mockResolvedValue({ id: 7, username: "u", role });
    const { req, res, next } = await run(guard, { userId: 7 });
    if (allowed.includes(role)) {
      expect(next).toHaveBeenCalledOnce();
      expect(req.user).toMatchObject({ id: 7, role });
    } else {
      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
      expect(req.user).toBeUndefined();
    }
  });

  it("500 actionnable si la base tombe, jamais next()", async () => {
    getUser.mockRejectedValue(new Error("connexion perdue"));
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    const { res, next } = await run(guard, { userId: 7 });
    silence.mockRestore();
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("alignement avec les constantes partagées", () => {
  it("isDriverManager suit DRIVER_MANAGER_ROLES", () => {
    expect([...MATRIX.isDriverManager.allowed].sort()).toEqual([...DRIVER_MANAGER_ROLES].sort());
  });

  it("chaque rôle autorisé de la matrice existe dans le schéma", () => {
    const known = new Set<string>(ALL_APP_ROLES);
    const unknown = Object.values(MATRIX)
      .flatMap((entry) => entry.allowed)
      .filter((role) => !known.has(role));
    expect(unknown).toEqual([]);
  });
});
