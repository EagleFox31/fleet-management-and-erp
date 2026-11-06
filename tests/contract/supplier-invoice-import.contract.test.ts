import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, import Excel de factures fournisseur (`POST /api/supplier-invoices/import`).
 * - Une ligne conforme au modèle téléchargeable crée la facture : HT, TVA, TTC, solde = TTC.
 * - Ligne invalide (date, montant, fournisseur, commande inconnue, doublon) : message lisible
 *   par ligne, jamais de JSON Zod ni de détail SQL ; les autres lignes passent.
 * - Fichier refusé : 400 au contrat d'erreur commun.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
let supplierName = "";
const ids = createIdBag();

type Row = Record<string, string | number>;

function workbook(rows: Row[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Factures");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function importFile(content: Buffer, filename = "factures.xlsx") {
  const form = new FormData();
  form.append(
    "file",
    new Blob([content], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
  const response = await fetch(`${baseUrl}/api/supplier-invoices/import`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, body: json, headers: response.headers };
}

async function rowsFor(invoiceNumber: string) {
  const rows = await db.select().from(supplierInvoices).where(eq(supplierInvoices.invoiceNumber, invoiceNumber));
  ids.invoiceIds.push(...rows.map((r) => r.id));
  return rows;
}

function row(overrides: Row = {}): Row {
  return {
    "Numéro Facture": `${uniqueTestToken("imp")}`,
    Fournisseur: supplierName,
    "Date Facture": "15/10/2026",
    "Date Échéance": "15/11/2026",
    "Montant HT": "100000",
    "TVA (%)": "19.25",
    "Montant TTC": "119250",
    ...overrides,
  };
}

const UNREADABLE = /\[\s*\{|"code"|invalid_type|Required|SQLSTATE|violates|syntax|NaN|undefined/;

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierName = supplier.name;

  const user = await createTestUser({ role: "secretary" });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.get("set-cookie")!.split(";")[0];
}, 120000);

afterAll(async () => {
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Import Excel de factures fournisseur : contrat", { timeout: 120000 }, () => {
  it("une ligne au format du modèle crée la facture, solde initial = TTC", async () => {
    const line = row();
    const res = await importFile(workbook([line]));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: 1, failed: 0, total: 1, errors: [] });
    const [stored] = await rowsFor(String(line["Numéro Facture"]));
    expect(stored).toBeDefined();
    expect(Number(stored.amountHT)).toBe(100000);
    expect(Number(stored.vatAmount)).toBe(19250);
    expect(Number(stored.totalTTC)).toBe(119250);
    expect(Number(stored.balance)).toBe(119250);
    expect(stored.status).toBe("received");
    expect(stored.invoiceDate).toBe("2026-10-15");
    expect(stored.dueDate).toBe("2026-11-15");
  });

  it("montants numériques Excel et ligne sans TVA (%) acceptés", async () => {
    const line = row({ "Montant HT": 5000, "Montant TTC": 5962.5 });
    delete line["TVA (%)"];
    const res = await importFile(workbook([line]));

    expect(res.body).toMatchObject({ success: 1, failed: 0 });
    const [stored] = await rowsFor(String(line["Numéro Facture"]));
    expect(Number(stored.totalTTC)).toBe(5962.5);
  });

  it.each<{ label: string; overrides: Row }>([
    { label: "date impossible", overrides: { "Date Facture": "31/02/2026" } },
    { label: "date illisible", overrides: { "Date Échéance": "abc/de/fghi" } },
    { label: "HT négatif", overrides: { "Montant HT": "-100" } },
    { label: "HT non numérique", overrides: { "Montant HT": "beaucoup" } },
    { label: "TTC inférieur au HT", overrides: { "Montant TTC": "50000" } },
    { label: "TVA incohérente", overrides: { "TVA (%)": "5" } },
    { label: "fournisseur inconnu", overrides: { Fournisseur: `Inconnu ${uniqueTestToken("sup")}` } },
    { label: "commande inconnue", overrides: { "N° Commande": `${uniqueTestToken("po")}` } },
  ])("$label -> ligne refusée avec un message lisible, rien n'est créé", async ({ overrides }) => {
    const line = row(overrides);
    const res = await importFile(workbook([line]));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: 0, failed: 1, total: 1 });
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0].row).toBe(2);
    expect(res.body.errors[0].message).not.toMatch(UNREADABLE);
    expect(await rowsFor(String(line["Numéro Facture"]))).toHaveLength(0);
  });

  it("une ligne en échec n'empêche pas les autres ; doublon dans le fichier refusé", async () => {
    const good = row();
    const res = await importFile(workbook([good, row({ "Montant HT": "-1" }), { ...good }]));

    expect(res.body).toMatchObject({ success: 1, failed: 2, total: 3 });
    expect(res.body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
    for (const e of res.body.errors) expect(e.message).not.toMatch(UNREADABLE);
    expect(await rowsFor(String(good["Numéro Facture"]))).toHaveLength(1);
  });

  it("fichier qui n'est pas un .xlsx -> 400 au contrat d'erreur", async () => {
    const res = await importFile(Buffer.from("a;b\n1;2"), "factures.csv");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: expect.any(String) });
    expect(typeof res.body.message).toBe("string");
    expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  });
});
