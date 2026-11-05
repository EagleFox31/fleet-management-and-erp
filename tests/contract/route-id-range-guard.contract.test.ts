import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_DB_INTEGER_ID } from "../../server/lib/route-id";
import { ROUTE_ID_OUT_OF_RANGE_MESSAGE } from "../../server/middleware/route-id-range-guard";
import { startContractSession } from "../support/contract-session";

/**
 * Filet des ids hors int4 (server/app.ts) : un id au-delà de MAX_DB_INTEGER_ID répondait 500 après
 * une erreur Postgres 22003. Il répond désormais 400 avant toute
 * route, qu'elle vienne de server/api ou de routes.ts.
 */
let session: Awaited<ReturnType<typeof startContractSession<"admin">>>;

beforeAll(async () => {
  session = await startContractSession({ admin: "admin" });
});

afterAll(async () => {
  await session?.stop();
});

const OUT_OF_RANGE = String(MAX_DB_INTEGER_ID + 1);
const ROUTES = [
  ["server/api drivers", "/api/drivers/"],
  ["server/api suppliers", "/api/suppliers/"],
  ["routes.ts vehicles", "/api/vehicles/"],
] as const;

describe("id de route hors int4 : 400 avant la base", () => {
  for (const [label, prefix] of ROUTES) {
    it(`${label} : 99999999999 et MAX+1 → 400 lisible, jamais 500`, async () => {
      for (const id of ["99999999999", OUT_OF_RANGE]) {
        const res = await session.call("GET", prefix + id);
        expect(res.status, id).toBe(400);
        expect(res.body.message).toBe(ROUTE_ID_OUT_OF_RANGE_MESSAGE);
      }
    });

    it(`${label} : MAX_DB_INTEGER_ID passe le filet`, async () => {
      const res = await session.call("GET", prefix + MAX_DB_INTEGER_ID);
      expect(res.body?.message).not.toBe(ROUTE_ID_OUT_OF_RANGE_MESSAGE);
    });
  }

  it("20 ids hors plage en parallèle : tous en 400, une route saine reste rapide", async () => {
    const burst = Promise.all(Array.from({ length: 20 }, () => session.call("GET", "/api/drivers/99999999999")));
    const started = Date.now();
    const healthy = await session.call("GET", "/api/vehicles");
    const healthyMs = Date.now() - started;
    const results = await burst;
    expect(results.every((r) => r.status === 400)).toBe(true);
    expect(healthy.status).toBe(200);
    expect(healthyMs).toBeLessThan(1000);
  });
});
