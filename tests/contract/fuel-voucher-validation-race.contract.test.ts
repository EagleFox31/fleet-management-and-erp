import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FUEL_VOUCHER_STALE_MESSAGE,
  fuelVoucherValidationResponseSchema,
  fuelVouchersResponseSchema,
} from "../../shared/contracts/fuel-vouchers";
import { fuelRecords } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * F3 (lot V1) : la validation d'un bon est conditionnée à son état. Deux validations simultanées
 * n'en réussissent qu'une ; un bon modifié entre l'affichage et la validation (version
 * différente) n'est pas validé : 409 lisible, le valideur recharge la liste.
 */
let server: Server;
let baseUrl = "";
let cookie = "";
let vehicleId = 0;
const ids = createIdBag();
const previousFlags = process.env.FEATURE_FLAGS;

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function pendingRecord() {
  // Plein physique (aucun débit de carte) : ses montants restent modifiables tant qu'il est en attente.
  const record = await createTestFuelRecord({ vehicleId, debitAmount: "0", creditAmount: "0", cost: "50000.00" });
  ids.fuelRecordIds.push(record.id);
  return record;
}

async function shownVersion(id: number): Promise<string> {
  const res = await call("GET", "/api/fuel-vouchers?status=pending");
  expect(res.status).toBe(200);
  const row = fuelVouchersResponseSchema.parse(res.body).find((v) => v.id === id);
  expect(row).toBeDefined();
  expect(row!.version).toBeDefined();
  return row!.version as string;
}

const statusOf = async (id: number) =>
  (await db.select({ s: fuelRecords.validationStatus, cost: fuelRecords.cost }).from(fuelRecords).where(eq(fuelRecords.id, id)))[0];

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "fuel-vouchers=on";
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const login = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
}, 120_000);

afterAll(async () => {
  if (previousFlags === undefined) delete process.env.FEATURE_FLAGS;
  else process.env.FEATURE_FLAGS = previousFlags;
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /api/fuel-vouchers/:id/validate : contrôle de version (F3)", { timeout: 60_000 }, () => {
  it("deux validations simultanées : une 200, une 409 lisible", async () => {
    const record = await pendingRecord();
    const results = await Promise.all([1, 2].map(() => call("POST", `/api/fuel-vouchers/${record.id}/validate`)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const conflict = results.find((r) => r.status === 409)!;
    expect(conflict.body.message).toBe(FUEL_VOUCHER_STALE_MESSAGE);
    const ok = fuelVoucherValidationResponseSchema.parse(results.find((r) => r.status === 200)!.body);
    expect(ok.validationStatus).toBe("validated");
  });

  it("bon déjà validé : 409, rien n'est réécrit", async () => {
    const record = await pendingRecord();
    const first = await call("POST", `/api/fuel-vouchers/${record.id}/validate`);
    expect(first.status).toBe(200);
    const second = await call("POST", `/api/fuel-vouchers/${record.id}/validate`);
    expect(second.status).toBe(409);
    expect(second.body.message).toBe(FUEL_VOUCHER_STALE_MESSAGE);
    const [row] = await db.select({ at: fuelRecords.validatedAt }).from(fuelRecords).where(eq(fuelRecords.id, record.id));
    expect(row.at?.toISOString()).toBe(first.body.validatedAt);
  });

  it("montant modifié par un PATCH entre l'affichage et la validation : 409, le bon reste en attente", async () => {
    const record = await pendingRecord();
    const version = await shownVersion(record.id);
    const patch = await call("PATCH", `/api/fuel-records/${record.id}`, { cost: 99999 });
    expect(patch.status).toBe(200);
    const stale = await call("POST", `/api/fuel-vouchers/${record.id}/validate`, { version });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe(FUEL_VOUCHER_STALE_MESSAGE);
    expect((await statusOf(record.id)).s).toBe("pending");
    // Après rechargement : la version affichée est la bonne, la validation passe.
    const fresh = await call("POST", `/api/fuel-vouchers/${record.id}/validate`, { version: await shownVersion(record.id) });
    expect(fresh.status).toBe(200);
    expect(await statusOf(record.id)).toEqual({ s: "validated", cost: "99999.00" });
  });

  it("version absente : validation acceptée (ancien client) ; version mal formée : 400", async () => {
    const record = await pendingRecord();
    expect((await call("POST", `/api/fuel-vouchers/${record.id}/validate`, { version: "x".repeat(200) })).status).toBe(400);
    expect((await statusOf(record.id)).s).toBe("pending");
    expect((await call("POST", `/api/fuel-vouchers/${record.id}/validate`)).status).toBe(200);
  });

  it("bon annulé (suppression douce) ou inconnu : 404 lisible, jamais 409, rien n'est validé", async () => {
    const record = await pendingRecord();
    await db.update(fuelRecords).set({ deletedAt: new Date() }).where(eq(fuelRecords.id, record.id));
    const cancelled = await call("POST", `/api/fuel-vouchers/${record.id}/validate`);
    expect(cancelled.status).toBe(404);
    expect(cancelled.body.message).not.toBe(FUEL_VOUCHER_STALE_MESSAGE);
    expect((await statusOf(record.id)).s).toBe("pending");
    expect((await call("POST", "/api/fuel-vouchers/2147483000/validate")).status).toBe(404);
  });
});
