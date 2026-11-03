import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";

/**
 * GET /api/suppliers/summary (appelé par `useBilling`) est capté par `router.get("/:id")` de
 * `server/api/suppliers.routes.ts` : `parseInt("summary")` donne NaN, la réponse est un 400
 * « ID invalide », et la déclaration de `server/routes.ts` n'est jamais servie (le scan des routes
 * masquées ne compare pas `/:id` à `/summary`).
 *
 * Bug d'ordre de déclaration, signalé le 3 novembre 2026, correctif confié à une autre PR.
 * `it.fails` : le test passe tant que le bug est là, et passe au rouge le jour où il est corrigé,
 * ce qui oblige à retirer `.fails` et à garder l'assertion comme contrat.
 */

const ACTORS = { admin: "admin" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("GET /api/suppliers/summary capté par /:id", { timeout: 60000 }, () => {
  it("témoin du bug : aujourd'hui, 400 « ID invalide »", async () => {
    const res = await session.call("GET", "/api/suppliers/summary", { actor: "admin" });
    expect(res.status).toBe(400);
  });

  it.fails("attendu : l'admin reçoit la synthèse fournisseurs (200)", async () => {
    const res = await session.call("GET", "/api/suppliers/summary", { actor: "admin" });
    expect(res.status).toBe(200);
  });
});
