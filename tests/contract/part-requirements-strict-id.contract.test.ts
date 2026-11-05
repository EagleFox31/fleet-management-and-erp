import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";

/**
 * Identifiants lus strictement (parseRouteId) sur les demandes de pièce et les pièces d'OT : « 1abc »
 * ne vise pas l'objet 1 mais reçoit un 400 lisible ; un id valide mais inconnu reste un 404.
 * Le flux de sortie de stock (issued / onTransition) n'est pas exercé ici : seul l'id est contrôlé.
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

type Call = [string, (a: string, b?: string) => string, unknown, number | null];
const CALLS: Call[] = [
  ["GET", (a) => `/api/part-requirements/by-part/${a}`, undefined, null],
  ["PATCH", (a) => `/api/part-requirements/${a}`, { quantity: 2 }, 404],
  ["DELETE", (a) => `/api/part-requirements/${a}`, undefined, 404],
  ["GET", (a) => `/api/work-orders/${a}/pending-part-requirements`, undefined, 404],
  ["POST", (a) => `/api/work-orders/${a}/awaiting-parts`, {}, 404],
  ["POST", (a) => `/api/work-orders/${a}/parts`, { partId: 1, quantity: 1 }, null],
  ["POST", (a, b = "1") => `/api/work-orders/${a}/part-requirements/${b}/issue`, {}, 404],
  ["POST", (a) => `/api/work-orders/1/part-requirements/${a}/issue`, {}, null],
];

describe("demandes de pièce et pièces d'OT : identifiant strict", { timeout: 60000 }, () => {
  for (const [method, path, body, unknown] of CALLS) {
    it(`${method} ${path(":id")} : « 1abc », « 1e3 », hors int4 et 0 donnent 400`, async () => {
      for (const bad of ["1abc", "1e3", "2147483648", "0"]) {
        const res = await session.call(method, path(bad), { actor: "admin", body });
        expect(apiErrorProblems(res.status, res.body, 400, "VALIDATION", res.headers.get("x-request-id")), `${bad} -> ${res.status} ${JSON.stringify(res.body)}`).toEqual([]);
      }
    });

    if (unknown !== null) {
      it(`${method} ${path(":id")} : id valide mais inconnu → ${unknown}`, async () => {
        const res = await session.call(method, path("2000000000"), { actor: "admin", body });
        expect(res.status, JSON.stringify(res.body)).toBe(unknown);
      });
    }
  }
});
