import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";

/**
 * GET /api/suppliers/summary (appelé par `useBilling`) était capté par `router.get("/:id")` de
 * `server/api/suppliers.routes.ts` : `parseInt("summary")` donnait NaN, la réponse était un 400
 * « ID invalide », et la déclaration de `server/routes.ts` n'était jamais servie (le scan des routes
 * masquées ne compare pas `/:id` à `/summary`).
 *
 * Signalé le 3 novembre 2026 (témoin `it.fails`), corrigé le même jour : la route est déclarée
 * avant `/:id` dans le routeur fournisseurs, la déclaration morte de `routes.ts` est supprimée.
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

describe("GET /api/suppliers/summary servi avant /:id", { timeout: 60000 }, () => {
  it("l'admin reçoit la synthèse fournisseurs (200, tableau), pas le 400 « ID invalide »", async () => {
    const res = await session.call("GET", "/api/suppliers/summary", { actor: "admin" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
