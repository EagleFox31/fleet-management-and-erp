import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startContractSession } from "../support/contract-session";

/**
 * GET /api/statistics/fleet-history : comportement figé avant la suppression de la
 * déclaration doublon de `server/routes.ts` (Express sert la première : service
 * `vehicleStatusService`, période par défaut `week`, 7 points datés par jour court).
 */

type Actor = "manager" | "technician";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;

const POINT_KEYS = ["date", "operational", "maintenance", "outOfService"];

beforeAll(async () => {
  session = await startContractSession<Actor>({ manager: "workshop_manager", technician: "technician" });
}, 60000);

afterAll(async () => {
  await session.stop();
});

describe("statistiques : historique de la flotte", { timeout: 60000 }, () => {
  it("refuse sans session (401)", async () => {
    const res = await session.call("GET", "/api/statistics/fleet-history", { actor: null });
    expect(res.status).toBe(401);
  });

  it("répond 7 points journaliers par défaut (période week), à tout utilisateur connecté", async () => {
    const res = await session.call("GET", "/api/statistics/fleet-history", { actor: "technician" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(7);
    for (const point of res.body) {
      expect(Object.keys(point).sort()).toEqual([...POINT_KEYS].sort());
      expect(typeof point.operational).toBe("number");
    }
  });

  it("period=week renvoie la même série que le défaut", async () => {
    const byDefault = await session.call("GET", "/api/statistics/fleet-history", { actor: "manager" });
    const explicit = await session.call("GET", "/api/statistics/fleet-history?period=week", { actor: "manager" });
    expect(explicit.status).toBe(200);
    expect(explicit.body.map((p: { date: string }) => p.date)).toEqual(byDefault.body.map((p: { date: string }) => p.date));
  });

  it("period=month renvoie un point par jour écoulé du mois courant", async () => {
    const res = await session.call("GET", "/api/statistics/fleet-history?period=month", { actor: "manager" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(new Date().getDate());
    expect(res.body[0].date).toBe("1");
  });
});
