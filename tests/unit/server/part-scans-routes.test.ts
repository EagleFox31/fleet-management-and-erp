import express from "express";
import { createServer, type Server } from "http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Sans base : l'utilisateur de session est fourni par un faux `storage`, la session par un en-tête,
// et seule la lecture `db.select(...)` du service est remplacée par un jeu de lignes.
vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:1/test";
  process.env.AUTH_DEBUG = "0";
});
const ROLE_BY_ID = new Map<number, string>();
vi.mock("../../../server/storage", () => ({
  storage: {
    getUser: async (id: number) => (ROLE_BY_ID.has(id) ? { id, username: `u${id}`, role: ROLE_BY_ID.get(id) } : undefined),
  },
}));
vi.mock("../../../server/middleware/session", () => ({
  sessionMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const dbState = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  selected: [] as Record<string, unknown>[],
  limits: [] as number[],
  writes: 0,
}));
vi.mock("../../../server/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../server/db")>();
  const result = () => {
    const promise = Promise.resolve(dbState.rows);
    return Object.assign(promise, {
      limit: (n: number) => {
        dbState.limits.push(n);
        return Promise.resolve(dbState.rows);
      },
    });
  };
  const fakeDb = {
    select: (columns: Record<string, unknown>) => {
      dbState.selected.push(columns);
      return { from: () => ({ where: result }) };
    },
    insert: () => (dbState.writes++, {}),
    update: () => (dbState.writes++, {}),
    delete: () => (dbState.writes++, {}),
    transaction: () => (dbState.writes++, {}),
  };
  return { ...actual, db: fakeDb };
});

import { createApiRouter } from "../../../server/api";
import { errorHandler, errorResponseGuard, requestContext } from "../../../server/middleware/error-handler";
import { ALL_APP_ROLES, PART_LABEL_ROLES, PART_SCAN_ROLES, type AppRole } from "../../../shared/constants/roles";

/**
 * Routes `/api/part-scans` (CDC-3), HTTP in-process sans base : drapeau coupé, 401, 403 par rôle,
 * projection sans prix, 400 / 404 / 409 normalisés. Le jumeau avec base et sessions réelles est
 * tests/contract/part-scans.contract.test.ts.
 */
const ids = new Map<AppRole, number>();
ALL_APP_ROLES.forEach((role, index) => {
  ids.set(role, 9000 + index);
  ROLE_BY_ID.set(9000 + index, role);
});

let server: Server;
let baseUrl = "";
const previousFlags = process.env.FEATURE_FLAGS;

beforeAll(async () => {
  const app = express();
  app.use(requestContext);
  app.use(errorResponseGuard);
  app.use(express.json());
  const fakeSession: express.RequestHandler = (req, _res, next) => {
    const header = req.header("x-test-role");
    if (header) (req as unknown as { session: { userId: number } }).session = { userId: ids.get(header as AppRole)! };
    next();
  };
  app.use("/api", createApiRouter(fakeSession));
  app.use(errorHandler);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  process.env.FEATURE_FLAGS = "part-qr=on";
  dbState.rows = [];
  dbState.selected = [];
  dbState.limits = [];
  dbState.writes = 0;
});
afterEach(() => {
  delete process.env.FEATURE_FLAGS;
});

async function get(path: string, role?: AppRole) {
  const response = await fetch(baseUrl + path, { headers: role ? { "x-test-role": role } : {} });
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* corps non JSON */
  }
  return { status: response.status, body, text };
}

/** Ligne telle que la renverrait un `select()` complet : prix d'achat et fournisseur compris. */
const FULL_ROW = {
  id: 20,
  reference: "FIL-001",
  name: "Filtre à huile",
  quantity: 14,
  location: "A-03",
  unit: "pièce",
  unitPrice: "18500.00",
  supplier: "Fournisseur confidentiel",
  supplierId: 4,
  description: "Interne",
};
const RESOLVE = "/api/part-scans/resolve?code=";
const LABELS = "/api/part-scans/labels?ids=";
const FORBIDDEN_KEYS = ["unitPrice", "unit_price", "price", "prix", "supplier", "supplierId", "cost", "description"];

describe("garde du montage", () => {
  it("drapeau coupé : 404 pour tous, session ou non, sur les deux routes", async () => {
    delete process.env.FEATURE_FLAGS;
    for (const path of [RESOLVE + "FM1:20", LABELS + "20"]) {
      expect((await get(path)).status).toBe(404);
      expect((await get(path, "admin")).status).toBe(404);
    }
  });

  it("drapeau allumé, sans session : 401", async () => {
    expect((await get(RESOLVE + "FM1:20")).status).toBe(401);
    expect((await get(LABELS + "20")).status).toBe(401);
  });

  it("rôles hors scan (dont driver, client, logistics) : 403 partout", async () => {
    const denied = ALL_APP_ROLES.filter((role) => !(PART_SCAN_ROLES as readonly string[]).includes(role));
    expect(denied).toEqual(expect.arrayContaining(["driver", "client", "logistics"]));
    dbState.rows = [FULL_ROW];
    for (const role of denied) {
      expect((await get(RESOLVE + "FM1:20", role)).status, `resolve ${role}`).toBe(403);
      expect((await get(LABELS + "20", role)).status, `labels ${role}`).toBe(403);
    }
    expect(dbState.selected).toHaveLength(0);
  });

  it("ancien squelette retiré : plus de GET ni de POST sur la racine", async () => {
    expect((await get("/api/part-scans", "admin")).status).toBe(404);
    const post = await fetch(baseUrl + "/api/part-scans", { method: "POST", headers: { "x-test-role": "admin", "Content-Type": "application/json" }, body: "{}" });
    expect(post.status).toBe(404);
  });
});

describe("GET /api/part-scans/resolve", () => {
  it.each([...PART_SCAN_ROLES])("%s : 200 avec la fiche minimale", async (role) => {
    dbState.rows = [FULL_ROW];
    const { status, body } = await get(RESOLVE + encodeURIComponent("/inventory/scan?c=FM1:20"), role);
    expect(status).toBe(200);
    expect(body).toEqual({ id: 20, reference: "FIL-001", name: "Filtre à huile", quantity: 14, location: "A-03", unit: "pièce" });
  });

  it("aucun champ prix ni fournisseur dans la réponse, même si la ligne lue en porte", async () => {
    dbState.rows = [FULL_ROW];
    for (const code of ["FM1:20", "FIL-001"]) {
      const { status, body, text } = await get(RESOLVE + encodeURIComponent(code), "warehouse");
      expect(status).toBe(200);
      for (const key of FORBIDDEN_KEYS) expect(Object.keys(body), key).not.toContain(key);
      expect(text).not.toContain("18500");
      expect(text).not.toContain("confidentiel");
    }
  });

  it("la requête ne lit pas les colonnes de prix", async () => {
    dbState.rows = [FULL_ROW];
    await get(RESOLVE + "FM1:20", "admin");
    expect(dbState.selected).toHaveLength(1);
    expect(Object.keys(dbState.selected[0]).sort()).toEqual(["id", "location", "name", "quantity", "reference", "unit"]);
    expect(dbState.limits).toEqual([2]);
  });

  it("location absente : null, jamais undefined", async () => {
    dbState.rows = [{ ...FULL_ROW, location: null }];
    expect((await get(RESOLVE + "FM1:20", "technician")).body.location).toBeNull();
  });

  it("lecture pure : aucune écriture en base", async () => {
    dbState.rows = [FULL_ROW];
    await get(RESOLVE + "FM1:20", "admin");
    await get(RESOLVE + "FIL-001", "technician");
    expect(dbState.writes).toBe(0);
  });

  it("code inconnu : 404 normalisé, sans détail technique", async () => {
    dbState.rows = [];
    const { status, body } = await get(RESOLVE + "FM1:999", "warehouse");
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", message: "Aucune pièce ne correspond à ce code." });
    expect(body.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toMatch(/sans résultat|select|sql/i);
  });

  it("référence portée par deux pièces : 409 lisible", async () => {
    dbState.rows = [FULL_ROW, { ...FULL_ROW, id: 21, reference: "fil-001" }];
    const { status, body } = await get(RESOLVE + "FIL-001", "admin");
    expect(status).toBe(409);
    expect(body.message).toMatch(/Plusieurs pièces/);
    expect(JSON.stringify(body)).not.toMatch(/ambiguë/);
  });

  it.each([
    ["sans paramètre", ""],
    ["code vide", "?code="],
    ["code d'espaces", "?code=%20%20"],
    ["code trop long", `?code=${"a".repeat(301)}`],
    ["code répété", "?code=FM1:1&code=FM1:2"],
    ["code objet", "?code[a]=b"],
    ["charge utile d'une version inconnue", "?code=FM2:12"],
    ["URL d'une autre page", `?code=${encodeURIComponent("https://exemple.test/vehicles?c=FM1:12")}`],
    ["caractère de contrôle", "?code=FIL%00-001"],
  ])("%s : 400 normalisé, la base n'est pas lue", async (_label, query) => {
    const { status, body } = await get("/api/part-scans/resolve" + query, "admin");
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: expect.any(String), message: expect.any(String), requestId: expect.any(String) });
    expect(dbState.selected).toHaveLength(0);
  });
});

describe("GET /api/part-scans/labels", () => {
  it.each([...PART_LABEL_ROLES])("%s : 200, charge utile et textes, dans l'ordre demandé", async (role) => {
    dbState.rows = [FULL_ROW, { ...FULL_ROW, id: 7, reference: "BOU-007", name: "Bougie", location: null }];
    const { status, body } = await get(LABELS + "7,20", role);
    expect(status).toBe(200);
    expect(body.missingIds).toEqual([]);
    expect(body.items).toEqual([
      { partId: 7, payload: "/inventory/scan?c=FM1:7", reference: "BOU-007", name: "Bougie", location: null, unit: "pièce" },
      { partId: 20, payload: "/inventory/scan?c=FM1:20", reference: "FIL-001", name: "Filtre à huile", location: "A-03", unit: "pièce" },
    ]);
  });

  it.each(["workshop_manager", "technician"] satisfies AppRole[])("%s (rôle de scan) : 403 sur les étiquettes", async (role) => {
    dbState.rows = [FULL_ROW];
    expect((await get(LABELS + "20", role)).status).toBe(403);
    expect(dbState.selected).toHaveLength(0);
    // Le même rôle garde la résolution.
    expect((await get(RESOLVE + "FM1:20", role)).status).toBe(200);
  });

  it("aucun champ prix ni fournisseur", async () => {
    dbState.rows = [FULL_ROW];
    const { body, text } = await get(LABELS + "20", "warehouse");
    for (const item of body.items) for (const key of FORBIDDEN_KEYS) expect(Object.keys(item), key).not.toContain(key);
    expect(text).not.toContain("18500");
    expect(text).not.toContain("confidentiel");
    expect(Object.keys(dbState.selected[0]).sort()).toEqual(["id", "location", "name", "quantity", "reference", "unit"]);
  });

  it("identifiants sans pièce : listés à part, sans erreur", async () => {
    dbState.rows = [FULL_ROW];
    const { status, body } = await get(LABELS + "20,999,5", "admin");
    expect(status).toBe(200);
    expect(body.items.map((item: { partId: number }) => item.partId)).toEqual([20]);
    expect(body.missingIds).toEqual([999, 5]);
  });

  it("doublons ignorés", async () => {
    dbState.rows = [FULL_ROW];
    const { body } = await get(LABELS + "20,20, 20", "admin");
    expect(body.items).toHaveLength(1);
  });

  it("lecture pure : aucune écriture en base", async () => {
    dbState.rows = [FULL_ROW];
    await get(LABELS + "20", "admin");
    expect(dbState.writes).toBe(0);
  });

  it.each([
    ["sans ids", ""],
    ["ids vide", "?ids="],
    ["valeur non numérique", "?ids=1,abc"],
    ["valeur tronquable", "?ids=12abc"],
    ["trou dans la liste", "?ids=1,,2"],
    ["zéro", "?ids=0"],
    ["négatif", "?ids=-3"],
    ["hors bornes", "?ids=2147483648"],
    ["trop d'identifiants", `?ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(",")}`],
    ["ids répété", "?ids=1&ids=2"],
  ])("%s : 400 normalisé, la base n'est pas lue", async (_label, query) => {
    const { status, body } = await get("/api/part-scans/labels" + query, "admin");
    expect(status).toBe(400);
    expect(body).toMatchObject({ code: expect.any(String), message: expect.any(String), requestId: expect.any(String) });
    expect(dbState.selected).toHaveLength(0);
  });

  it("100 identifiants : accepté", async () => {
    dbState.rows = [];
    const list = Array.from({ length: 100 }, (_, i) => i + 1).join(",");
    const { status, body } = await get(LABELS + list, "admin");
    expect(status).toBe(200);
    expect(body.missingIds).toHaveLength(100);
  });
});
