import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, createTestClientInvoice, createTestSupplier, createTestSupplierInvoice } from "../support/factories";
import { startContractSession } from "../support/contract-session";

/**
 * DIR3 : contenu exact des exports Excel de factures
 * (`/api/exports/supplier-invoices`, `/api/exports/client-invoices`).
 * Les droits sont dans `lot-exports-roles`. Donnees au jeton unique.
 */
type Actor = "admin";
type Row = Record<string, string | number>;
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
let supplierName = "";
let clientA = { id: 0, name: "", number: "" };
let clientB = { id: 0, name: "", number: "" };
const numbers: { unpaid: string; paid: string } = { unpaid: "", paid: "" };

async function sheet(path: string, name: string): Promise<{ status: number; rows: Row[]; disposition: string }> {
  const res = await session.raw("GET", path, "admin");
  if (res.status !== 200) return { status: res.status, rows: [], disposition: "" };
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer" });
  expect(wb.SheetNames).toEqual([name]);
  return { status: 200, rows: XLSX.utils.sheet_to_json<Row>(wb.Sheets[name]), disposition: res.headers.get("content-disposition") ?? "" };
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin" });
  const supplier = await createTestSupplier();
  session.ids.supplierIds.push(supplier.id);
  supplierName = supplier.name;
  const unpaid = await createTestSupplierInvoice({ supplierId: supplier.id, invoiceDate: "2026-01-15", amountHT: "100000.00", vatAmount: "19250.00", totalTTC: "119250.00", balance: "19250.00" });
  const paid = await createTestSupplierInvoice({ supplierId: supplier.id, invoiceDate: "2026-03-02", family: "PNEUS", amountHT: "40000.00", vatAmount: "7700.00", totalTTC: "47700.00", balance: "0.00" });
  session.ids.invoiceIds.push(unpaid.id, paid.id);
  numbers.unpaid = unpaid.invoiceNumber;
  numbers.paid = paid.invoiceNumber;
  const a = await createTestClient();
  const b = await createTestClient();
  session.ids.clientIds.push(a.id, b.id);
  const ia = await createTestClientInvoice({ clientId: a.id, invoiceDate: "2026-02-10", dueDate: "2099-03-12", amountHT: "200000.00", vatAmount: "38500.00", amountTTC: "238500.00", balance: "138500.00", status: "partial" });
  const ib = await createTestClientInvoice({ clientId: b.id, amountHT: "1000.00", vatAmount: "192.50", amountTTC: "1192.50" });
  session.ids.clientInvoiceIds.push(ia.id, ib.id);
  clientA = { id: a.id, name: a.name, number: ia.invoiceNumber };
  clientB = { id: b.id, name: b.name, number: ib.invoiceNumber };
}, 60000);

afterAll(async () => {
  await session.stop();
});

describe("DIR3 : export factures fournisseurs", { timeout: 60000 }, () => {
  it("facture impayee : montants, paiements = TTC - solde, statut IMPAYE, date au format fr-FR", async () => {
    const { rows } = await sheet("/api/exports/supplier-invoices", "Factures Fournisseurs");
    const row = rows.find((r) => r["N° Facture"] === numbers.unpaid)!;
    expect(row).toMatchObject({
      Fournisseur: supplierName,
      Date: "15/01/2026",
      Famille: "TEST",
      "Montant HT": 100000,
      "TVA 19.25%": 19250,
      "Montant TTC": 119250,
      Paiements: 100000,
      Solde: 19250,
      Statut: "IMPAYÉ",
    });
  });

  it("facture soldee : solde 0, paiements = TTC, statut PAYE", async () => {
    const { rows } = await sheet("/api/exports/supplier-invoices", "Factures Fournisseurs");
    expect(rows.find((r) => r["N° Facture"] === numbers.paid)).toMatchObject({
      Date: "02/03/2026",
      Famille: "PNEUS",
      "Montant TTC": 47700,
      Paiements: 47700,
      Solde: 0,
      Statut: "PAYÉ",
    });
  });
});

describe("DIR3 : export factures clients", { timeout: 60000 }, () => {
  it("cellules exactes d'une facture partiellement payee", async () => {
    const { rows } = await sheet("/api/exports/client-invoices", "Factures Clients");
    expect(rows.find((r) => r["N° Facture"] === clientA.number)).toMatchObject({
      Client: clientA.name,
      Date: "10/02/2026",
      Échéance: "12/03/2099",
      Mission: "N/A",
      "Montant HT": 200000,
      "TVA 19.25%": 38500,
      "Montant TTC": 238500,
      Solde: 138500,
      Statut: "partial",
    });
  });

  it("le filtre par nom de client ne renvoie que ce client (cloison entre clients)", async () => {
    const { rows, disposition } = await sheet(`/api/exports/client-invoices?clientName=${encodeURIComponent(clientA.name)}`, "Factures Clients");
    expect(rows.map((r) => r["N° Facture"])).toEqual([clientA.number]);
    expect(rows.some((r) => r.Client === clientB.name)).toBe(false);
    expect(disposition).toMatch(/^attachment; filename="factures_[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}\.xlsx"$/);
  });

  it("un nom de client inconnu : classeur valide sans ligne de donnees", async () => {
    const res = await sheet("/api/exports/client-invoices?clientName=TEST-aucun-client-dir3", "Factures Clients");
    expect(res.status).toBe(200);
    expect(res.rows).toHaveLength(0);
  });

  it("un nom de client trop long : 400, jamais 500", async () => {
    const res = await session.raw("GET", `/api/exports/client-invoices?clientName=${"a".repeat(121)}`, "admin");
    expect(res.status).toBe(400);
  });
});
