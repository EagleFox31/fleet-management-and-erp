import { createServer, type Server } from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { FUEL_VOUCHER_STALE_MESSAGE, fuelVoucherValidationResponseSchema } from "../../shared/contracts/fuel-vouchers";
import { fuelPricesResponseSchema } from "../../shared/contracts/fuel-prices";
import { fuelPrices, fuelRecords } from "../../shared/schema";
import { db } from "../../server/db";
import { getFuelPriceAt } from "../../server/services/fuel-price-service";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** T-44 : validation des bons (P-17) et prix du litre daté (P-19). */

const PRICE_DATES = ["2090-11-01", "2090-12-15"];
let server: Server;
let baseUrl = "";
let recordId = 0;
const ids = createIdBag();
const cookies: Record<string, string> = {};
const userIds: Record<string, number> = {};
const previousFlags = process.env.FEATURE_FLAGS;

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any, headers: response.headers };
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "fuel-vouchers=on,fuel-prices=on";
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  for (const [label, role] of [["logistics", "logistics"], ["tech", "technician"], ["admin", "admin"], ["secretary", "secretary"], ["wm", "workshop_manager"], ["mgmt", "management"]] as [string, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    userIds[label] = user.id;
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies[label] = res.headers.get("set-cookie")!.split(";")[0];
  }
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const record = await createTestFuelRecord({ vehicleId: vehicle.id, createdBy: userIds.logistics });
  ids.fuelRecordIds.push(record.id);
  recordId = record.id;
}, 120000);

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await db.delete(fuelPrices).where(inArray(fuelPrices.effectiveFrom, PRICE_DATES));
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/fuel-vouchers/:id/validate", () => {
  it("401 anonyme, 403 technicien", async () => {
    expect((await call("POST", `/api/fuel-vouchers/${recordId}/validate`)).status).toBe(401);
    expect((await call("POST", `/api/fuel-vouchers/${recordId}/validate`, { cookie: cookies.tech })).status).toBe(403);
  });

  it("404 sur un bon inconnu", async () => {
    expect((await call("POST", "/api/fuel-vouchers/2147483000/validate", { cookie: cookies.logistics })).status).toBe(404);
  });

  it("valide avec la trace de l'auteur, et une seconde validation ne réécrit rien", async () => {
    const first = await call("POST", `/api/fuel-vouchers/${recordId}/validate`, { cookie: cookies.logistics });
    expect(first.status).toBe(200);
    const parsed = fuelVoucherValidationResponseSchema.parse(first.body);
    expect(parsed.validationStatus).toBe("validated");
    expect(parsed.validatedBy).toBe(userIds.logistics);

    // F3 (lot V1) : un bon déjà validé répond 409 lisible, au lieu de 200 ; l'auteur et la date restent.
    const second = await call("POST", `/api/fuel-vouchers/${recordId}/validate`, { cookie: cookies.logistics });
    expect(second.status).toBe(409);
    expect(second.body.message).toBe(FUEL_VOUCHER_STALE_MESSAGE);
    const [row] = await db
      .select({ at: fuelRecords.validatedAt, by: fuelRecords.validatedBy })
      .from(fuelRecords)
      .where(eq(fuelRecords.id, recordId));
    expect({ at: row.at?.toISOString(), by: row.by }).toEqual({ at: parsed.validatedAt, by: userIds.logistics });
  });
});

describe("GET /api/fuel-vouchers (lecture seule du chef d'atelier et de la direction)", () => {
  it("200 pour logistique, chef d'atelier et direction ; 401 anonyme ; 403 technicien", async () => {
    for (const label of ["logistics", "wm", "mgmt"]) {
      expect((await call("GET", "/api/fuel-vouchers", { cookie: cookies[label] })).status).toBe(200);
    }
    expect((await call("GET", "/api/fuel-vouchers")).status).toBe(401);
    expect((await call("GET", "/api/fuel-vouchers", { cookie: cookies.tech })).status).toBe(403);
  });

  it("la validation reste refusée au chef d'atelier et à la direction (403)", async () => {
    for (const label of ["wm", "mgmt"]) {
      expect((await call("POST", `/api/fuel-vouchers/${recordId}/validate`, { cookie: cookies[label] })).status).toBe(403);
    }
  });
});

describe("/api/fuel-prices", () => {
  it("écriture : 403 pour le secrétariat, le chef d'atelier et la direction ; admin et logistique autorisés", async () => {
    const body = { effectiveFrom: PRICE_DATES[0], pricePerLiter: 843 };
    for (const label of ["secretary", "wm", "mgmt"]) {
      expect((await call("POST", "/api/fuel-prices", { cookie: cookies[label], body })).status).toBe(403);
    }
    expect((await call("POST", "/api/fuel-prices", { cookie: cookies.admin, body })).status).toBe(201);
    expect((await call("POST", "/api/fuel-prices", { cookie: cookies.logistics, body })).status).toBe(201);
  });

  it("401 anonyme, écriture refusée au technicien (403)", async () => {
    expect((await call("GET", "/api/fuel-prices")).status).toBe(401);
    const res = await call("POST", "/api/fuel-prices", { cookie: cookies.tech, body: { effectiveFrom: PRICE_DATES[0], pricePerLiter: 843 } });
    expect(res.status).toBe(403);
  });

  it("refuse un prix négatif ou une date mal formée (400)", async () => {
    expect((await call("POST", "/api/fuel-prices", { cookie: cookies.logistics, body: { effectiveFrom: PRICE_DATES[0], pricePerLiter: -1 } })).status).toBe(400);
    expect((await call("POST", "/api/fuel-prices", { cookie: cookies.logistics, body: { effectiveFrom: "1er novembre", pricePerLiter: 843 } })).status).toBe(400);
  });

  it("pose un prix daté, le corrige à la même date et le liste", async () => {
    const created = await call("POST", "/api/fuel-prices", { cookie: cookies.logistics, body: { effectiveFrom: PRICE_DATES[0], pricePerLiter: 843 } });
    expect(created.status).toBe(201);
    expect(created.body.pricePerLiter).toBe(843);
    const fixed = await call("POST", "/api/fuel-prices", { cookie: cookies.logistics, body: { effectiveFrom: PRICE_DATES[0], pricePerLiter: 845 } });
    expect(fixed.body.pricePerLiter).toBe(845);

    const list = await call("GET", "/api/fuel-prices", { cookie: cookies.tech });
    expect(list.status).toBe(200);
    const prices = fuelPricesResponseSchema.parse(list.body);
    expect(prices.filter((p) => p.effectiveFrom === PRICE_DATES[0])).toHaveLength(1);
    expect(prices.some((p) => p.effectiveFrom === "2000-01-01" && p.pricePerLiter === 828)).toBe(true);
  });

  it("un plein garde le prix de son jour : 30 octobre ancien prix, 2 novembre nouveau prix", async () => {
    const before = await getFuelPriceAt("2090-10-30");
    expect(await getFuelPriceAt("2090-11-01")).toBe(845);
    expect(await getFuelPriceAt("2090-11-02")).toBe(845);
    expect(before).not.toBe(845);
    await call("POST", "/api/fuel-prices", { cookie: cookies.logistics, body: { effectiveFrom: PRICE_DATES[1], pricePerLiter: 860 } });
    expect(await getFuelPriceAt("2090-11-02")).toBe(845);
    expect(await getFuelPriceAt("2090-12-15")).toBe(860);
  });
});
