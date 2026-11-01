import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * FUEL1, carte carburant et pleins : routes `/api/fuel-card/*` et `/api/fuel-records`.
 * La carte est un solde global (somme des crédits - somme des débits) : les montants
 * sont vérifiés par différence avant/après, jamais en valeur absolue.
 * Tout enregistrement créé est supprimé par id en fin de fichier.
 */

type Actor = "admin" | "logistics" | "secretary" | "workshop_manager" | "technician" | "client";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const recordIds: number[] = [];

// Année isolée : aucun autre jeu de données n'écrit en 2031.
const DATE = "2031-03-15";

function track(res: { body: any }) {
  const id = res.body?.recharge?.id ?? res.body?.consumption?.id ?? res.body?.id;
  if (typeof id === "number") recordIds.push(id);
}

async function balance() {
  const res = await session.call("GET", "/api/fuel-card/balance", { actor: "admin" });
  expect(res.status).toBe(200);
  return res.body.balance as number;
}

async function recharge(body: Record<string, unknown>, actor: Actor = "admin") {
  const res = await session.call("POST", "/api/fuel-card/recharge", { actor, body });
  track(res);
  return res;
}

const validRecharge = (over: Record<string, unknown> = {}) => ({
  amount: 100000,
  unitPrice: 800,
  date: DATE,
  paymentMode: "virement",
  orderNumber: uniqueTestToken("cmd"),
  ...over,
});

async function newVehicle() {
  const vehicle = await createTestVehicle();
  session.ids.vehicleIds.push(vehicle.id);
  return vehicle;
}

beforeAll(async () => {
  session = await startContractSession<Actor>({
    admin: "admin",
    logistics: "logistics",
    secretary: "secretary",
    workshop_manager: "workshop_manager",
    technician: "technician",
    client: "client",
  });
}, 60000);

afterAll(async () => {
  if (recordIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.id, recordIds));
  // Balayage : 2031 est réservée à ce fichier. Un débit NaN resté en base empoisonnerait le solde global.
  await db.delete(fuelRecords).where(sql`${fuelRecords.date} >= '2031-01-01' AND ${fuelRecords.date} < '2032-01-01'`);
  await session.stop();
});

describe("FUEL1 : recharge de la carte", { timeout: 60000 }, () => {
  it("sans session -> 401", async () => {
    const res = await session.call("POST", "/api/fuel-card/recharge", { actor: null, body: validRecharge() });
    expect(res.status).toBe(401);
  });

  for (const actor of ["workshop_manager", "technician", "client"] as const) {
    it(`${actor} -> 403, solde inchangé`, async () => {
      const before = await balance();
      const res = await recharge(validRecharge(), actor);
      expect(res.status).toBe(403);
      expect(await balance()).toBe(before);
    });
  }

  for (const actor of ["admin", "logistics", "secretary"] as const) {
    it(`${actor} recharge : 201, crédit en base attribué à lui, solde + montant`, async () => {
      const before = await balance();
      const body = validRecharge();
      const res = await recharge(body, actor);
      expect(res.status).toBe(201);
      expect(res.body.recharge).toMatchObject({
        vehicleId: null,
        createdBy: session.userId(actor),
        orderNumber: body.orderNumber,
        paymentMode: "virement",
      });
      expect(Number(res.body.recharge.creditAmount)).toBe(100000);
      expect(Number(res.body.recharge.debitAmount)).toBe(0);
      expect(res.body.recharge.quantity).toBeCloseTo(100000 / 800, 5);
      expect(await balance()).toBeCloseTo(before + 100000, 2);
    });
  }

  it("quantité fournie sans prix : le prix unitaire est déduit", async () => {
    const res = await recharge(validRecharge({ unitPrice: undefined, quantity: 200, amount: 150000 }));
    expect(res.status).toBe(201);
    expect(Number(res.body.recharge.unitPrice)).toBeCloseTo(750, 5);
    expect(res.body.recharge.quantity).toBe(200);
  });

  const invalid: Array<[string, Record<string, unknown>]> = [
    ["montant nul", { amount: 0 }],
    ["montant négatif", { amount: -500 }],
    ["montant illisible", { amount: "abc" }],
    ["date absente", { date: undefined }],
    ["mode de paiement absent", { paymentMode: undefined }],
    ["ni quantité ni prix unitaire", { unitPrice: undefined, quantity: undefined }],
  ];
  for (const [label, over] of invalid) {
    it(`${label} -> 400, aucun crédit créé`, async () => {
      const before = await balance();
      const res = await recharge(validRecharge(over));
      expect(res.status).toBe(400);
      expect(await balance()).toBe(before);
    });
  }

  it("corps vide -> 400", async () => {
    const res = await recharge({});
    expect(res.status).toBe(400);
  });
});

describe("FUEL1 : consommation (débit)", { timeout: 60000 }, () => {
  const validConsumption = (vehicleId: number, over: Record<string, unknown> = {}) => ({
    vehicleId,
    quantity: 50,
    unitPrice: 800,
    date: DATE,
    stationName: uniqueTestToken("sta"),
    destination: "Douala",
    ...over,
  });

  async function consume(body: Record<string, unknown>, actor: Actor = "admin") {
    const res = await session.call("POST", "/api/fuel-card/consumption", { actor, body });
    track(res);
    return res;
  }

  it("sans session -> 401 ; client -> 403", async () => {
    const vehicle = await newVehicle();
    expect((await session.call("POST", "/api/fuel-card/consumption", { actor: null, body: validConsumption(vehicle.id) })).status).toBe(401);
    expect((await consume(validConsumption(vehicle.id), "client")).status).toBe(403);
  });

  it("201 : débit = quantité x prix, rattaché au véhicule, solde - coût", async () => {
    await recharge(validRecharge());
    const vehicle = await newVehicle();
    const before = await balance();
    const res = await consume(validConsumption(vehicle.id));
    expect(res.status).toBe(201);
    expect(res.body.cost).toBe(40000);
    expect(res.body.consumption).toMatchObject({ vehicleId: vehicle.id, createdBy: session.userId("admin") });
    expect(Number(res.body.consumption.debitAmount)).toBe(40000);
    expect(await balance()).toBeCloseTo(before - 40000, 2);
  });

  const invalid: Array<[string, Record<string, unknown>]> = [
    ["véhicule absent", { vehicleId: undefined }],
    ["quantité absente", { quantity: undefined }],
    ["prix absent", { unitPrice: undefined }],
    ["date absente", { date: undefined }],
    ["station absente", { stationName: undefined }],
    ["destination absente", { destination: undefined }],
  ];
  for (const [label, over] of invalid) {
    it(`${label} -> 400, aucun débit`, async () => {
      const vehicle = await newVehicle();
      const before = await balance();
      const res = await consume(validConsumption(vehicle.id, over));
      expect(res.status).toBe(400);
      expect(await balance()).toBe(before);
    });
  }
});

describe("FUEL1 : lectures de la carte", { timeout: 60000 }, () => {
  it("solde : 200, cohérent (solde = crédits - débits), client 403, sans session 401", async () => {
    const res = await session.call("GET", "/api/fuel-card/balance", { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.balance).toBeCloseTo(res.body.totalCredits - res.body.totalDebits, 2);
    expect((await session.call("GET", "/api/fuel-card/balance", { actor: "client" })).status).toBe(403);
    expect((await session.call("GET", "/api/fuel-card/balance", { actor: null })).status).toBe(401);
  });

  it("historique : filtres par type, par véhicule, par année/mois ; liste vide hors période", async () => {
    const vehicle = await newVehicle();
    const credit = await recharge(validRecharge());
    const debit = await session.call("POST", "/api/fuel-card/consumption", {
      actor: "admin",
      body: { vehicleId: vehicle.id, quantity: 10, unitPrice: 800, date: DATE, stationName: "TEST histo", destination: "Yaoundé" },
    });
    track(debit);
    expect(debit.status).toBe(201);
    const creditId = credit.body.recharge.id;
    const debitId = debit.body.consumption.id;

    const all = await session.call("GET", "/api/fuel-card/history?year=2031&month=3", { actor: "admin" });
    expect(all.status).toBe(200);
    const allIds = all.body.map((r: any) => r.id);
    expect(allIds).toEqual(expect.arrayContaining([creditId, debitId]));

    const credits = await session.call("GET", "/api/fuel-card/history?year=2031&month=3&type=credit", { actor: "admin" });
    expect(credits.body.map((r: any) => r.id)).toContain(creditId);
    expect(credits.body.map((r: any) => r.id)).not.toContain(debitId);

    const debits = await session.call("GET", "/api/fuel-card/history?year=2031&month=3&type=debit", { actor: "admin" });
    expect(debits.body.map((r: any) => r.id)).toContain(debitId);
    expect(debits.body.map((r: any) => r.id)).not.toContain(creditId);

    const byVehicle = await session.call("GET", `/api/fuel-card/history?vehicleId=${vehicle.id}`, { actor: "admin" });
    expect(byVehicle.body.map((r: any) => r.id)).toEqual([debitId]);
    expect(byVehicle.body[0].createdByName).toEqual(expect.any(String));

    const otherMonth = await session.call("GET", "/api/fuel-card/history?year=2031&month=4", { actor: "admin" });
    expect(otherMonth.status).toBe(200);
    expect(otherMonth.body).toEqual([]);
  });

  it("historique : client 403", async () => {
    expect((await session.call("GET", "/api/fuel-card/history", { actor: "client" })).status).toBe(403);
  });

  it("statistiques mensuelles : solde du mois = crédits - débits, mois vide à zéro", async () => {
    await recharge(validRecharge());
    const res = await session.call("GET", "/api/fuel-card/monthly-stats?year=2031&month=3", { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ year: 2031, month: 3 });
    expect(res.body.totalCredits).toBeGreaterThanOrEqual(100000);
    expect(res.body.balance).toBeCloseTo(res.body.totalCredits - res.body.totalDebits, 2);

    const empty = await session.call("GET", "/api/fuel-card/monthly-stats?year=2031&month=11", { actor: "admin" });
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ totalCredits: 0, totalDebits: 0, balance: 0 });
  });

  it("statistiques par client : 200 tableau ; client 403", async () => {
    const res = await session.call("GET", "/api/fuel-card/stats-by-client", { actor: "admin" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect((await session.call("GET", "/api/fuel-card/stats-by-client", { actor: "client" })).status).toBe(403);
  });

  it("anomalies d'un véhicule : id illisible 400, véhicule sans historique 200 sans anomalie", async () => {
    expect((await session.call("GET", "/api/fuel-card/vehicle/abc/anomalies", { actor: "admin" })).status).toBe(400);
    const vehicle = await newVehicle();
    const res = await session.call("GET", `/api/fuel-card/vehicle/${vehicle.id}/anomalies`, { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasAnomaly: false, anomalies: [] });
  });
});

describe("FUEL1 : pleins (liste, lecture par véhicule, suppression)", { timeout: 60000 }, () => {
  const fuelBody = (vehicleId: number) => ({ vehicleId, date: DATE, quantity: 30, cost: 24000, mileage: 5000, notes: uniqueTestToken("fuel") });

  async function createRecord(vehicleId: number) {
    const res = await session.call("POST", "/api/fuel-records", { actor: "admin", body: fuelBody(vehicleId) });
    expect(res.status).toBe(201);
    recordIds.push(res.body.id);
    return res.body.id as number;
  }

  it("liste d'un véhicule sans plein : 200 tableau vide", async () => {
    const vehicle = await newVehicle();
    const res = await session.call("GET", `/api/fuel-records/vehicle/${vehicle.id}`, { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("liste par véhicule : le plein créé apparaît avec prix au litre et coût total", async () => {
    const vehicle = await newVehicle();
    const id = await createRecord(vehicle.id);
    const res = await session.call("GET", `/api/fuel-records/vehicle/${vehicle.id}`, { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id, totalCost: 24000, pricePerLiter: 800 });
  });

  it("identifiant de véhicule illisible -> 400", async () => {
    expect((await session.call("GET", "/api/fuel-records/vehicle/abc", { actor: "admin" })).status).toBe(400);
  });

  it("suppression : logistics -> 403 et plein conservé ; id illisible 400 ; inconnu 404", async () => {
    const vehicle = await newVehicle();
    const id = await createRecord(vehicle.id);
    expect((await session.call("DELETE", `/api/fuel-records/${id}`, { actor: "logistics" })).status).toBe(403);
    expect((await session.call("DELETE", `/api/fuel-records/${id}`, { actor: "client" })).status).toBe(403);
    expect((await session.call("DELETE", `/api/fuel-records/abc`, { actor: "admin" })).status).toBe(400);
    expect((await session.call("DELETE", `/api/fuel-records/2147483000`, { actor: "admin" })).status).toBe(404);
    const list = await session.call("GET", `/api/fuel-records/vehicle/${vehicle.id}`, { actor: "admin" });
    expect(list.body.map((r: any) => r.id)).toContain(id);
  });

  it("suppression par le chef d'atelier : 204, plein disparu, second appel 404", async () => {
    const vehicle = await newVehicle();
    const id = await createRecord(vehicle.id);
    expect((await session.call("DELETE", `/api/fuel-records/${id}`, { actor: "workshop_manager" })).status).toBe(204);
    const list = await session.call("GET", `/api/fuel-records/vehicle/${vehicle.id}`, { actor: "admin" });
    expect(list.body).toEqual([]);
    expect((await session.call("DELETE", `/api/fuel-records/${id}`, { actor: "workshop_manager" })).status).toBe(404);
  });
});

/**
 * Défauts figés. Chaque requête fautive est jouée une fois dans `beforeAll`, ses lignes sont
 * supprimées aussitôt (une valeur NaN fausserait le solde global de la carte), et le `it.fails`
 * ne contient que l'assertion métier.
 */
describe("FUEL1 : défauts figés (it.fails)", { timeout: 120000 }, () => {
  const probes: Record<string, { status: number; body: any; balanceFinite?: boolean }> = {};

  async function probe(key: string, path: string, body: Record<string, unknown>) {
    const res = await session.call("POST", path, { actor: "admin", body });
    const id = res.body?.recharge?.id ?? res.body?.consumption?.id;
    if (typeof id === "number") {
      // L'id est enregistré avant la suppression : si elle échoue, le ménage de fin de fichier le reprend.
      recordIds.push(id);
      await db.delete(fuelRecords).where(inArray(fuelRecords.id, [id]));
    }
    probes[key] = { status: res.status, body: res.body };
  }

  const consumption = (vehicleId: number, over: Record<string, unknown> = {}) => ({
    vehicleId,
    quantity: 50,
    unitPrice: 800,
    date: DATE,
    stationName: uniqueTestToken("sta"),
    destination: "Douala",
    ...over,
  });

  let foreignVehicleId = 0;
  let foreignRecordId = 0;
  let clientRead: { status: number } = { status: 0 };

  beforeAll(async () => {
    const vehicle = await newVehicle();
    await probe("badDate", "/api/fuel-card/recharge", validRecharge({ date: "pas-une-date" }));
    await probe("nanQuantity", "/api/fuel-card/consumption", consumption(vehicle.id, { quantity: "abc" }));
    await probe("negativeQuantity", "/api/fuel-card/consumption", consumption(vehicle.id, { quantity: -50 }));
    await probe("unknownVehicle", "/api/fuel-card/consumption", consumption(2147483000));
    await probe("insufficient", "/api/fuel-card/consumption", consumption(vehicle.id, { quantity: 1_000_000, unitPrice: 100_000 }));

    const other = await newVehicle();
    foreignVehicleId = other.id;
    const created = await session.call("POST", "/api/fuel-records", {
      actor: "admin",
      body: { vehicleId: other.id, date: DATE, quantity: 30, cost: 24000, mileage: 5000, notes: uniqueTestToken("fuel") },
    });
    foreignRecordId = created.body.id;
    recordIds.push(foreignRecordId);
    clientRead = await session.call("GET", `/api/fuel-records/vehicle/${foreignVehicleId}`, { actor: "client" });
  });

  it.fails("recharge : date illisible -> 400 (500 aujourd'hui, année NaN à l'insertion)", () => {
    expect(probes.badDate.status).toBe(400);
  });

  it.fails("consommation : quantité illisible -> 400 (201 aujourd'hui, débit NaN qui fausse tout le solde)", () => {
    expect(probes.nanQuantity.status).toBe(400);
  });

  it.fails("consommation : quantité négative -> 400 (201 aujourd'hui, le débit négatif crédite la carte)", () => {
    expect(probes.negativeQuantity.status).toBe(400);
  });

  it.fails("consommation : véhicule inconnu -> 404 (500 aujourd'hui)", () => {
    expect(probes.unknownVehicle.status).toBe(404);
  });

  it.fails("consommation : solde insuffisant -> 409 (500 aujourd'hui)", () => {
    expect(probes.insufficient.status).toBe(409);
  });

  it.fails("un client ne lit pas les pleins d'un véhicule qui n'est pas le sien -> 403 (200 aujourd'hui)", () => {
    expect(clientRead.status).toBe(403);
  });
});
