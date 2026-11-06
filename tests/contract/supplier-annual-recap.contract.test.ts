import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import { isoDateInZone } from "../../shared/contracts/kpi-period";
import { SUPPLIER_ANNUAL_RECAP_PATH, supplierAnnualRecapResponseSchema } from "../../shared/contracts/supplier-annual-recap";
import { apiErrorProblems } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { createTestSupplier, createTestSupplierInvoice } from "../support/factories";

/**
 * GET /api/supplier-invoices/annual-recap : HT, TVA, TTC et reste dû actuel par fournisseur et par mois.
 * - Rôles : lecture des factures fournisseurs (admin, secretary, warehouse, logistics) ; autres 403.
 * - Périmètre : `invoice_date` du 1er janvier au 31 décembre inclus, tous statuts, litiges isolés en plus.
 * - Colonnes alias : TVA `vat_amount` puis `tax_amount` ; TTC `total_ttc` puis `total_amount` puis HT + TVA.
 * - `outstandingAsOfToday` = somme de `balance` (reste dû actuel).
 * Année 2002 : aucun autre fichier n'y date de facture fournisseur. Écrit en base ; tout est supprimé.
 */
const Y = "year=2002";
const path = (query = "") => `${SUPPLIER_ANNUAL_RECAP_PATH}${query ? `?${query}` : ""}`;

let session: Awaited<ReturnType<typeof startContractSession<"admin" | "secretary" | "warehouse" | "logistics" | "management" | "workshop" | "technician" | "driver" | "client">>>;
const supplier = { a: 0, b: 0, c: 0 };
let orphan = 0;

async function invoice(
  supplierId: number,
  invoiceDate: string,
  over: Partial<Omit<typeof supplierInvoices.$inferInsert, "supplierId">> = {},
) {
  const row = await createTestSupplierInvoice({ supplierId, invoiceDate, ...over });
  return row.id;
}

beforeAll(async () => {
  session = await startContractSession({
    admin: "admin",
    secretary: "secretary",
    warehouse: "warehouse",
    logistics: "logistics",
    management: "management",
    workshop: "workshop_manager",
    technician: "technician",
    driver: "driver",
    client: "client",
  });
  for (const key of ["a", "b", "c"] as const) {
    const row = await createTestSupplier();
    session.ids.supplierIds.push(row.id);
    supplier[key] = row.id;
  }
  // A : bornes de l'année (1er janvier, 31 décembre), en janvier une facture réglée (balance 0).
  await invoice(supplier.a, "2002-01-01", { balance: "0.00", status: "paid" });
  await invoice(supplier.a, "2002-12-31", { amountHT: "50000.00", vatAmount: "9625.00", totalTTC: "59625.00", balance: "20000.00" });
  // A : colonnes alias seules (vat_amount et total_ttc nuls), en mars.
  const alias = await invoice(supplier.a, "2002-03-15", { amountHT: "10000.00", taxAmount: "1925.00", totalAmount: "11925.00", balance: "11925.00" });
  await db.update(supplierInvoices).set({ vatAmount: null, totalTTC: null }).where(eq(supplierInvoices.id, alias));
  // A : aucun TTC renseigné, en mars : TTC = HT + TVA.
  const bare = await invoice(supplier.a, "2002-03-20", { amountHT: "20000.00", vatAmount: "3850.00", balance: "0.00" });
  await db.update(supplierInvoices).set({ totalTTC: null, totalAmount: null, taxAmount: null }).where(eq(supplierInvoices.id, bare));
  // B : une facture en litige, en juin.
  await invoice(supplier.b, "2002-06-10", { status: "disputed" });
  // C : TTC renseigné, TVA absente des deux colonnes, en mai : TVA = TTC − HT.
  const noVat = await invoice(supplier.c, "2002-05-05", { amountHT: "10000.00", totalTTC: "11925.00", balance: "0.00" });
  await db.update(supplierInvoices).set({ vatAmount: null, taxAmount: null, totalAmount: null }).where(eq(supplierInvoices.id, noVat));
  // Hors année : veille et lendemain.
  await invoice(supplier.a, "2001-12-31");
  await invoice(supplier.a, "2003-01-01");
  // Sans fournisseur : créée sur B puis détachée ; supprimée à la main (le nettoyage passe par le fournisseur).
  orphan = await invoice(supplier.b, "2002-06-11", { balance: "5000.00" });
  await db.update(supplierInvoices).set({ supplierId: null }).where(eq(supplierInvoices.id, orphan));
}, 180000);

afterAll(async () => {
  if (orphan) await db.delete(supplierInvoices).where(inArray(supplierInvoices.id, [orphan]));
  await session.stop();
});

describe("droits", () => {
  it("sans session : 401", async () => {
    expect((await session.call("GET", path(Y), { actor: null })).status).toBe(401);
  });

  it.each(["management", "workshop", "technician", "driver", "client"] as const)("%s : 403", async (actor) => {
    expect((await session.call("GET", path(Y), { actor })).status).toBe(403);
  });

  it.each(["admin", "secretary", "warehouse", "logistics"] as const)("%s : 200 au contrat", async (actor) => {
    const r = await session.call("GET", path(Y), { actor });
    expect(r.status).toBe(200);
    supplierAnnualRecapResponseSchema.parse(r.body);
  });
});

describe("paramètres", () => {
  it.each([
    ["year=02", "Année attendue au format AAAA."],
    ["year=1999", "Année attendue entre 2000 et 2100."],
    ["year=2002&year=2003", "Année invalide."],
    ["year[]=2002", "Année invalide."],
    ["status=paid", "Paramètre non reconnu."],
    [`${Y}&supplierId=12abc`, "Identifiant de fournisseur invalide."],
    [`${Y}&supplierId=0`, "Identifiant de fournisseur invalide."],
    [`${Y}&supplierId=1&supplierId=2`, "Identifiant de fournisseur invalide."],
  ])("%s : 400 lisible", async (query, message) => {
    const r = await session.call("GET", path(query), { actor: "admin" });
    expect(apiErrorProblems(r.status, r.body, 400)).toEqual([]);
    expect(r.body.message).toBe(message);
  });

  it("sans année : année en cours à Africa/Douala", async () => {
    const r = await session.call("GET", path(), { actor: "secretary" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ year: Number(isoDateInZone(new Date()).slice(0, 4)), supplierId: null });
  });

  it("supplierId vide : tous les fournisseurs", async () => {
    const r = await session.call("GET", path(`${Y}&supplierId=`), { actor: "admin" });
    expect(r.status).toBe(200);
    expect(r.body.supplierId).toBeNull();
  });
});

describe("récapitulatif", () => {
  it("un fournisseur : bornes incluses, colonnes alias, TTC reconstitué, reste dû actuel, 12 mois", async () => {
    const r = await session.call("GET", path(`${Y}&supplierId=${supplier.a}`), { actor: "logistics" });
    const s = supplierAnnualRecapResponseSchema.parse(r.body);
    expect(s).toMatchObject({ year: 2002, supplierId: supplier.a });
    const totals = {
      count: 4,
      amountHt: 180000,
      vatAmount: 34650,
      amountTtc: 214650,
      outstandingAsOfToday: 31925,
      disputedCount: 0,
      disputedAmountTtc: 0,
    };
    expect(s.totals).toEqual(totals);
    expect(s.months.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s.months[0]).toMatchObject({ count: 1, amountTtc: 119250, outstandingAsOfToday: 0 });
    expect(s.months[2]).toMatchObject({ count: 2, amountHt: 30000, vatAmount: 5775, amountTtc: 35775, outstandingAsOfToday: 11925 });
    expect(s.months[11]).toMatchObject({ count: 1, amountTtc: 59625, outstandingAsOfToday: 20000 });
    expect(s.months[5]).toMatchObject({ count: 0, amountTtc: 0 });
    expect(s.bySupplier).toHaveLength(1);
    expect(s.bySupplier[0]).toMatchObject({ supplierId: supplier.a, ...totals });
    expect(s.bySupplier[0].months).toEqual(s.months);
  });

  it("litige : compté dans les totaux et isolé (décompte et montant séparés)", async () => {
    const r = await session.call("GET", path(`${Y}&supplierId=${supplier.b}`), { actor: "admin" });
    const s = supplierAnnualRecapResponseSchema.parse(r.body);
    expect(s.totals).toMatchObject({ count: 1, amountTtc: 119250, disputedCount: 1, disputedAmountTtc: 119250 });
    expect(s.months[5]).toMatchObject({ disputedCount: 1, disputedAmountTtc: 119250 });
  });

  it("TVA absente et TTC présent : TVA = TTC − HT, donc HT + TVA = TTC", async () => {
    const r = await session.call("GET", path(`${Y}&supplierId=${supplier.c}`), { actor: "admin" });
    const s = supplierAnnualRecapResponseSchema.parse(r.body);
    const expected = { count: 1, amountHt: 10000, vatAmount: 1925, amountTtc: 11925 };
    expect(s.totals).toMatchObject(expected);
    expect(s.months[4]).toMatchObject(expected);
  });

  it("tous fournisseurs : ligne sans fournisseur unique et placée en dernier, totaux = somme des lignes", async () => {
    const r = await session.call("GET", path(Y), { actor: "warehouse" });
    const s = supplierAnnualRecapResponseSchema.parse(r.body);
    const last = s.bySupplier[s.bySupplier.length - 1];
    expect(last).toMatchObject({ supplierId: null, supplierName: null });
    expect(last.outstandingAsOfToday).toBeGreaterThanOrEqual(5000);
    expect(s.bySupplier.filter((x) => x.supplierId === null)).toHaveLength(1);
    const sum = (k: "amountTtc" | "outstandingAsOfToday") => s.bySupplier.reduce((t, x) => t + Math.round(x[k] * 100), 0) / 100;
    expect(s.totals.amountTtc).toBe(sum("amountTtc"));
    expect(s.totals.outstandingAsOfToday).toBe(sum("outstandingAsOfToday"));
    const monthSum = s.months.reduce((t, m) => t + m.count, 0);
    expect(monthSum).toBe(s.totals.count);
  });

  it("année sans facture du fournisseur : douze mois à zéro", async () => {
    const r = await session.call("GET", path(`year=2004&supplierId=${supplier.a}`), { actor: "admin" });
    const s = supplierAnnualRecapResponseSchema.parse(r.body);
    expect(s.bySupplier).toEqual([]);
    expect(s.totals).toMatchObject({ count: 0, amountTtc: 0, outstandingAsOfToday: 0 });
    expect(s.months.every((m) => m.count === 0)).toBe(true);
  });
});
