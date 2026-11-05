import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";

/**
 * Identifiants lus strictement (parseRouteId) : spécifications et variantes du catalogue pièces,
 * kilométrage et position d'un véhicule, factures fournisseur. « 1abc » ne vise pas l'objet 1 mais
 * reçoit un 400 lisible ; un id valide mais inconnu reste un 404 là où la route le dit.
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

type Call = [string, (id: string) => string, unknown, number | null];
const CALLS: Call[] = [
  ["GET", (id) => `/api/parts/${id}/specifications`, undefined, null],
  ["POST", (id) => `/api/parts/${id}/specifications`, { name: "x", value: "y" }, null],
  ["PATCH", (id) => `/api/parts/1/specifications/${id}`, { value: "y" }, null],
  ["DELETE", (id) => `/api/parts/1/specifications/${id}`, undefined, null],
  ["GET", (id) => `/api/parts/${id}/variants`, undefined, null],
  ["POST", (id) => `/api/parts/${id}/variants`, { name: "x" }, null],
  ["PATCH", (id) => `/api/parts/1/variants/${id}`, { name: "y" }, null],
  ["DELETE", (id) => `/api/parts/1/variants/${id}`, undefined, null],
  ["PUT", (id) => `/api/vehicles/${id}/mileage`, { kilometers: 10 }, 404],
  ["PUT", (id) => `/api/vehicles/${id}/maintenance-position`, { position: "atelier" }, null],
  ["GET", (id) => `/api/supplier-invoices/${id}`, undefined, 404],
  ["PATCH", (id) => `/api/supplier-invoices/${id}/validate`, {}, null],
  ["PATCH", (id) => `/api/supplier-invoices/${id}/approve`, {}, null],
  ["GET", (id) => `/api/supplier-invoices/${id}/settlements`, undefined, null],
  ["POST", (id) => `/api/supplier-invoices/${id}/payment`, { paymentDate: "2026-01-01", paymentMethod: "cash", proofReference: "r" }, null],
];

describe("derniers identifiants de route : lecture stricte", { timeout: 60000 }, () => {
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
