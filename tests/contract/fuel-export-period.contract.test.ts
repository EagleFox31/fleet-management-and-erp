import { inArray } from "drizzle-orm";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * DIR2 / DIR3, export carburant par période : contenu exact du classeur et
 * filtre année / mois. Les droits par rôle sont déjà figés par
 * `lot-exports-roles.contract.test.ts`.
 */

type Actor = "admin" | "client";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
const recordIds: number[] = [];
const YEAR = 2031;

type Row = Record<string, any>;

/** Télécharge le classeur (binaire) : `call` renvoie du texte, on repasse par fetch. */
async function downloadRows(query: string): Promise<{ status: number; contentType: string | null; rows: Row[] }> {
  const response = await session.raw("GET", `/api/exports/fuel-consumption?${query}`, "admin");
  if (response.status !== 200) return { status: response.status, contentType: response.headers.get("content-type"), rows: [] };
  const workbook = XLSX.read(Buffer.from(await response.arrayBuffer()), { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return { status: 200, contentType: response.headers.get("content-type"), rows: XLSX.utils.sheet_to_json<Row>(sheet) };
}

async function seed(vehicleId: number, fields: { month: number; quantity: number; debit: number; station: string }) {
  const [row] = await db
    .insert(fuelRecords)
    .values({
      vehicleId,
      date: `${YEAR}-${String(fields.month).padStart(2, "0")}-15`,
      year: YEAR,
      month: fields.month,
      quantity: fields.quantity,
      debitAmount: String(fields.debit),
      stationName: fields.station,
      validationStatus: "validated",
    })
    .returning();
  recordIds.push(row.id);
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin", client: "client" });
}, 60000);

afterAll(async () => {
  if (recordIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.id, recordIds));
  await session.stop();
});

describe("DIR2 / DIR3 : export carburant par période", { timeout: 60000 }, () => {
  it("le mois demandé ne contient que les pleins de ce mois, avec les valeurs exactes", async () => {
    const march = await createTestVehicle();
    const april = await createTestVehicle();
    session.ids.vehicleIds.push(march.id, april.id);
    const stationMarch = uniqueTestToken("sta");
    await seed(march.id, { month: 3, quantity: 80, debit: 56000, station: stationMarch });
    await seed(april.id, { month: 4, quantity: 30, debit: 21000, station: uniqueTestToken("sta") });

    const result = await downloadRows(`year=${YEAR}&month=3`);
    expect(result.status).toBe(200);
    expect(result.contentType).toContain("spreadsheetml");
    const mine = result.rows.filter((r) => [march.registrationNumber, april.registrationNumber].includes(r["Véhicule"]));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      "Véhicule": march.registrationNumber,
      "Quantité (L)": 80,
      "Débit (FCFA)": 56000,
      "Station": stationMarch,
    });
  });

  it("sans mois, toute l'année ; un mois vide ou une autre année ne renvoie aucun de ces pleins", async () => {
    const a = await createTestVehicle();
    const b = await createTestVehicle();
    session.ids.vehicleIds.push(a.id, b.id);
    await seed(a.id, { month: 1, quantity: 10, debit: 7000, station: "TEST A" });
    await seed(b.id, { month: 12, quantity: 20, debit: 14000, station: "TEST B" });
    const regs = [a.registrationNumber, b.registrationNumber];
    const mineOf = (rows: Row[]) => rows.filter((r) => regs.includes(r["Véhicule"])).map((r) => r["Véhicule"]).sort();

    expect(mineOf((await downloadRows(`year=${YEAR}`)).rows)).toEqual([...regs].sort());
    expect(mineOf((await downloadRows(`year=${YEAR}&month=6`)).rows)).toEqual([]);
    expect(mineOf((await downloadRows(`year=${YEAR + 1}`)).rows)).toEqual([]);
  });

  it("refuse un client (403), une année absente ou un mois hors 1 à 12 (400)", async () => {
    expect((await session.call("GET", `/api/exports/fuel-consumption?year=${YEAR}`, { actor: "client" })).status).toBe(403);
    expect((await session.call("GET", "/api/exports/fuel-consumption", { actor: "admin" })).status).toBe(400);
    expect((await session.call("GET", `/api/exports/fuel-consumption?year=${YEAR}&month=13`, { actor: "admin" })).status).toBe(400);
  });

  // Défaut : l'export filtre sur les colonnes `year` et `month`
  // (server/services/excel-export-service.ts:125) que seul l'import Excel
  // renseigne. Un plein saisi par l'écran (POST /api/fuel-records,
  // server/routes.ts:3328) n'a ni année ni mois : il manque à l'export de son
  // propre mois.
  describe("plein saisi par l'application", () => {
    // Date fixe en milieu de mois (passée) : le mois filtré est celui de la date
    // envoyée, sans dépendre du fuseau ni de la date du jour.
    const ENTRY_DATE = "2026-06-15";
    const ENTRY_YEAR = 2026;
    const ENTRY_MONTH = 6;
    let registration = "";
    // Mise en place (véhicule, POST et son 201) hors du `it.fails` : une erreur
    // de création fait échouer le hook au lieu de rendre le cas vert.
    beforeAll(async () => {
      const vehicle = await createTestVehicle();
      session.ids.vehicleIds.push(vehicle.id);
      registration = vehicle.registrationNumber;
      const created = await session.call("POST", "/api/fuel-records", {
        actor: "admin",
        body: { vehicleId: vehicle.id, date: ENTRY_DATE, quantity: 25, cost: 17500, mileage: 120000 },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      recordIds.push(created.body.id);
    }, 60000);

    it.fails("un plein saisi par l'application figure dans l'export de son mois", async () => {
      const result = await downloadRows(`year=${ENTRY_YEAR}&month=${ENTRY_MONTH}`);
      const mine = result.rows.filter((r) => r["Véhicule"] === registration);
      expect(mine).toHaveLength(1);
    });
  });
});
