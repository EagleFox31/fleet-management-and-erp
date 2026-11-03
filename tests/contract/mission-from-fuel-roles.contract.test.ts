import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ALL_APP_ROLES, MISSION_MANAGER_ROLES, type AppRole } from "../../shared/constants/roles";
import { startContractSession } from "../support/contract-session";

/**
 * `POST /api/operations/missions/from-fuel` crée une mission : réservé aux gestionnaires
 * (MISSION_MANAGER_ROLES, lot 2 missions, 3 novembre 2026). Une erreur ne renvoie aucun
 * détail technique (AGENTS.md §10).
 *
 * Un enregistrement carburant inexistant suffit : la garde répond avant le handler, et le
 * gestionnaire, qui passe la garde, reçoit l'erreur du service.
 */

let session: Awaited<ReturnType<typeof startContractSession<AppRole>>>;
const REFUSED_STAFF = ALL_APP_ROLES.filter(
  (role) => role !== "client" && !(MISSION_MANAGER_ROLES as readonly string[]).includes(role),
);
const MISSING_FUEL_RECORD = { fuelRecordId: 2_147_483_000, clientName: "TEST from-fuel" };

beforeAll(async () => {
  session = await startContractSession<AppRole>(
    Object.fromEntries(ALL_APP_ROLES.map((role) => [role, role])) as Record<AppRole, AppRole>,
  );
});

afterAll(async () => {
  await session?.stop();
});

describe("POST /api/operations/missions/from-fuel : création réservée aux gestionnaires", () => {
  it.each(REFUSED_STAFF)("%s reçoit 403", async (role) => {
    const res = await session.call("POST", "/api/operations/missions/from-fuel", { actor: role, body: MISSING_FUEL_RECORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message).not.toMatch(/error|stack|select |insert /i);
    expect(res.body.requestId).toBeTruthy();
  });

  // Enregistrement carburant inconnu : 404 lisible au contrat ApiErrorBody, plus de 500.
  it.each([...MISSION_MANAGER_ROLES])("%s passe la garde, fuelRecordId inconnu donne 404", async (role) => {
    const res = await session.call("POST", "/api/operations/missions/from-fuel", { actor: role, body: MISSING_FUEL_RECORD });
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBeUndefined();
    expect(res.body.message).toBe("Enregistrement carburant non trouvé.");
    expect(res.body.code).toBeTruthy();
    expect(res.body.requestId).toBeTruthy();
  });

  // Corps validé par Zod : identifiant non numérique ou client absent, 400 sans appel au service.
  it.each([
    ["fuelRecordId non numérique", { fuelRecordId: "abc", clientName: "TEST" }],
    ["fuelRecordId négatif", { fuelRecordId: -3, clientName: "TEST" }],
    ["clientName vide", { fuelRecordId: 12, clientName: "   " }],
    ["corps vide", {}],
  ])("%s : 400", async (_label, body) => {
    const res = await session.call("POST", "/api/operations/missions/from-fuel", { actor: "logistics", body });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.requestId).toBeTruthy();
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});
