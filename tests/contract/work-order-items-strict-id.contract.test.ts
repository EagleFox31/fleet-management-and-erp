import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";

/**
 * Identifiants lus strictement (parseRouteId) sur les lignes de travail : « 1abc » ne vise pas l'OT ou la
 * ligne 1 mais reçoit un 400 lisible ; un id valide mais inconnu reste un 404.
 */
const ACTORS = { technician: "technician" } as const;
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

const CALLS: Array<[string, (id: string) => string, unknown]> = [
  ["GET", (id) => `/api/work-orders/${id}/items`, undefined],
  ["POST", (id) => `/api/work-orders/${id}/items`, { hours: 1, description: "test" }],
  ["PATCH", (id) => `/api/work-order-items/${id}`, { hours: 2 }],
  ["DELETE", (id) => `/api/work-order-items/${id}`, undefined],
];

describe("lignes de travail : identifiant strict", { timeout: 60000 }, () => {
  for (const [method, path, body] of CALLS) {
    it(`${method} ${path(":id")} : « 1abc », « 1e3 », hors int4 et 0 donnent 400`, async () => {
      for (const bad of ["1abc", "1e3", "2147483648", "0"]) {
        const res = await session.call(method, path(bad), { actor: "technician", body });
        expect(apiErrorProblems(res.status, res.body, 400, "VALIDATION", res.headers.get("x-request-id")), `${bad} -> ${res.status} ${JSON.stringify(res.body)}`).toEqual([]);
      }
    });

    it(`${method} ${path(":id")} : id valide mais inconnu → 404`, async () => {
      const res = await session.call(method, path("2000000000"), { actor: "technician", body });
      expect(res.status, JSON.stringify(res.body)).toBe(404);
    });
  }
});
