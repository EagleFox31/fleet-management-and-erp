import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestPart } from "../support/factories";
import { startContractSession } from "../support/contract-session";

/**
 * GET /api/parts/:id/usage-history : comportement figé avant la suppression de la
 * déclaration doublon de `server/routes.ts` (la première, servie, passe par
 * `partsService.getUsageHistory` et lit `parts_stock_movements`).
 */

type Actor = "warehouse";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;

beforeAll(async () => {
  session = await startContractSession<Actor>({ warehouse: "warehouse" });
}, 60000);

afterAll(async () => {
  await session.stop();
});

describe("pièces : historique d'utilisation", { timeout: 60000 }, () => {
  it("refuse sans session (401)", async () => {
    const res = await session.call("GET", "/api/parts/1/usage-history", { actor: null });
    expect(res.status).toBe(401);
  });

  it("refuse un identifiant non numérique (400, message métier)", async () => {
    const res = await session.call("GET", "/api/parts/abc/usage-history", { actor: "warehouse" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("ID de pièce invalide");
  });

  it("renvoie une liste vide pour une pièce neuve sans mouvement", async () => {
    const part = await createTestPart();
    session.ids.partIds.push(part.id);
    const res = await session.call("GET", `/api/parts/${part.id}/usage-history`, { actor: "warehouse" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("renvoie une liste (vide) pour une pièce inconnue, pas une erreur", async () => {
    const res = await session.call("GET", "/api/parts/999999999/usage-history", { actor: "warehouse" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
