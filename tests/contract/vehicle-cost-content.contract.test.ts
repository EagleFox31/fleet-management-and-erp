import { createServer, type Server } from "http";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vehicleCostSummaryPath, vehicleCostSummaryResponseSchema } from "../../shared/contracts/vehicle-cost-summary";
import { fuelRecords, partsUsed, workOrders } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Niveau C, P-14 : contenu de `GET /api/vehicles/:id/cost-summary`, ce qui entre et ce qui sort du coût.
 * Les droits restent à `aggregate-reads` (et à la cloison client) : un seul rôle staff ici, pour ne pas
 * doubler des assertions de droits qui évoluent ailleurs.
 */
const previousFlags = process.env.FEATURE_FLAGS;
process.env.FEATURE_FLAGS = "vehicle-cost-summary=on";

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
const APRIL = "from=2003-04-01&to=2003-04-30";

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
let loaded = 0;
let empty = 0;

async function summary(vehicleId: number, query = "") {
  const res = await fetch(`${baseUrl}${vehicleCostSummaryPath(vehicleId)}${query ? `?${query}` : ""}`, { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const parsed = vehicleCostSummaryResponseSchema.safeParse(await res.json());
  expect(parsed.success).toBe(true);
  return parsed.data!;
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const user = await createTestUser({ role: "admin" });
  ids.userIds.push(user.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];

  const v1 = await createTestVehicle();
  const v2 = await createTestVehicle();
  ids.vehicleIds.push(v1.id, v2.id);
  loaded = v1.id;
  empty = v2.id;
  const part = await createTestPart();
  ids.partIds.push(part.id);

  const wos = await db
    .insert(workOrders)
    .values([
      // Commencé en mars, terminé en avril : compte en avril (la date de fin prime).
      { vehicleId: loaded, title: "TEST-cost-a", status: "completed", startDate: at("2003-03-30"), endDate: at("2003-04-02"), cost: "10000.4" },
      // Commencé en avril, terminé en mai : hors avril.
      { vehicleId: loaded, title: "TEST-cost-b", status: "completed", startDate: at("2003-04-30"), endDate: at("2003-05-01"), cost: "2000" },
      // Annulé en avril : ni main-d'oeuvre ni pièces.
      { vehicleId: loaded, title: "TEST-cost-c", status: "cancelled", startDate: at("2003-04-10"), endDate: at("2003-04-10"), cost: "99999" },
      // Terminé le dernier jour de la période : compte (borne `to` incluse).
      { vehicleId: loaded, title: "TEST-cost-d", status: "completed", startDate: at("2003-04-30"), endDate: at("2003-04-30"), cost: "500" },
    ])
    .returning({ id: workOrders.id });
  workOrderIds.push(...wos.map((w) => w.id));
  await db.insert(partsUsed).values([
    { workOrderId: wos[0].id, partId: part.id, quantity: 2, unitPrice: "1500" },
    { workOrderId: wos[2].id, partId: part.id, quantity: 3, unitPrice: "1000" },
  ]);
  const fuel = await db
    .insert(fuelRecords)
    .values([
      { vehicleId: loaded, date: "2003-04-30", quantity: 10, cost: "8280" },
      // Plein supprimé (suppression douce) : hors coût et hors litres.
      { vehicleId: loaded, date: "2003-04-05", quantity: 100, cost: "82800", deletedAt: at("2003-04-06") },
      { vehicleId: loaded, date: "2003-05-01", quantity: 1, cost: "828" },
    ])
    .returning({ id: fuelRecords.id });
  ids.fuelRecordIds.push(...fuel.map((f) => f.id));
}, 180000);

afterAll(async () => {
  process.env.FEATURE_FLAGS = previousFlags;
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("coût d'un véhicule : contenu", { timeout: 120000 }, () => {
  it("période : OT classé par sa date de fin, borne de fin incluse, annulé et plein supprimé exclus", async () => {
    expect(await summary(loaded, APRIL)).toEqual({
      vehicleId: loaded,
      from: "2003-04-01",
      to: "2003-04-30",
      labor: 10500, // 10 000,4 + 500, arrondi
      parts: 3000, // 2 x 1 500 ; les 3 x 1 000 de l'OT annulé ne comptent pas
      fuel: 8280,
      total: 21780,
      workOrderCount: 2,
      fuelLiters: 10,
    });
  });

  it("sans période : tout l'historique, toujours sans annulé ni plein supprimé", async () => {
    expect(await summary(loaded)).toEqual({
      vehicleId: loaded,
      from: null,
      to: null,
      labor: 12500,
      parts: 3000,
      fuel: 9108,
      total: 24608,
      workOrderCount: 3,
      fuelLiters: 11,
    });
  });

  it("période d'un seul jour : la borne de début et la borne de fin le contiennent", async () => {
    const day = await summary(loaded, "from=2003-04-30&to=2003-04-30");
    expect(day).toMatchObject({ labor: 500, parts: 0, fuel: 8280, workOrderCount: 1, fuelLiters: 10 });
  });

  it("véhicule sans aucune donnée : tous les montants à zéro", async () => {
    expect(await summary(empty, APRIL)).toEqual({
      vehicleId: empty,
      from: "2003-04-01",
      to: "2003-04-30",
      labor: 0,
      parts: 0,
      fuel: 0,
      total: 0,
      workOrderCount: 0,
      fuelLiters: 0,
    });
  });
});
