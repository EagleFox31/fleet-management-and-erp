import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { unzipSync, zipSync } from "fflate";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import {
  SUPPLIER_INVOICE_IMPORT_MAX_ROWS,
} from "../../shared/contracts/supplier-invoice-import";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, durcissement de l'import Excel (SheetJS 0.20.3) :
 * taille, nombre de lignes, zip corrompu, décompression excessive,
 * formule lue comme valeur, en-têtes `__proto__` sans effet.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
let supplierName = "";
const ids = createIdBag();

const HEADERS = ["Numéro Facture", "Fournisseur", "Date Facture", "Date Échéance", "Montant HT", "TVA (%)", "Montant TTC"];

function validValues(invoiceNumber: string): Array<string | number> {
  return [invoiceNumber, supplierName, "15/10/2026", "15/11/2026", "100000", "19.25", "119250"];
}

function toBuffer(sheet: XLSX.WorkSheet): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Factures");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function importFile(content: Buffer | Uint8Array, filename = "factures.xlsx") {
  const form = new FormData();
  form.append(
    "file",
    new Blob([content as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    filename,
  );
  const response = await fetch(`${baseUrl}/api/supplier-invoices/import`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, body: json };
}

async function rowsFor(invoiceNumber: string) {
  const rows = await db.select().from(supplierInvoices).where(eq(supplierInvoices.invoiceNumber, invoiceNumber));
  ids.invoiceIds.push(...rows.map((r) => r.id));
  return rows;
}

const TECHNICAL = /SQLSTATE|violates|at .*\.ts|node_modules|ZipError|Cannot read|undefined|Unexpected/;

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

describe("Import Excel de factures : durcissement", { timeout: 120000 }, () => {
  it("fichier valide : la facture est créée", async () => {
    const number = uniqueTestToken("hard");
    const { status, body } = await importFile(toBuffer(XLSX.utils.aoa_to_sheet([HEADERS, validValues(number)])));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: 1, failed: 0, total: 1 });
    expect((await rowsFor(number)).length).toBe(1);
  });

  it("fichier de plus de 5 Mo : 400 lisible", async () => {
    const { status, body } = await importFile(Buffer.alloc(5 * 1024 * 1024 + 1024, 7));
    expect(status).toBe(400);
    expect(body.message).toMatch(/5 Mo/);
    expect(JSON.stringify(body)).not.toMatch(TECHNICAL);
  });

  it("plus de lignes que le maximum : 400 lisible, aucune facture créée", async () => {
    const number = uniqueTestToken("many");
    const rows: Array<Array<string | number>> = [HEADERS];
    for (let i = 0; i <= SUPPLIER_INVOICE_IMPORT_MAX_ROWS; i++) rows.push(validValues(`${number}-${i}`));
    const { status, body } = await importFile(toBuffer(XLSX.utils.aoa_to_sheet(rows)));
    expect(status).toBe(400);
    expect(body.message).toMatch(new RegExp(String(SUPPLIER_INVOICE_IMPORT_MAX_ROWS)));
    expect(JSON.stringify(body)).not.toMatch(TECHNICAL);
    expect((await rowsFor(`${number}-0`)).length).toBe(0);
  }, 120000);

  it("zip corrompu : 400 lisible", async () => {
    const good = toBuffer(XLSX.utils.aoa_to_sheet([HEADERS, validValues("x")]));
    const corrupted = Buffer.concat([good.subarray(0, Math.floor(good.length / 2)), Buffer.alloc(200, 0x41)]);
    const { status, body } = await importFile(corrupted);
    expect(status).toBe(400);
    expect(body.message).toMatch(/illisible/);
    expect(JSON.stringify(body)).not.toMatch(TECHNICAL);
  });

  it("décompression excessive (zip bomb sous 5 Mo) : 400 lisible", async () => {
    const bomb = Buffer.from(zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(60 * 1024 * 1024) }));
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    const { status, body } = await importFile(bomb);
    expect(status).toBe(400);
    expect(body.message).toMatch(/décompressé/);
    expect(JSON.stringify(body)).not.toMatch(TECHNICAL);
  });

  it("taille décompressée sous-déclarée (central = 1, local = 0) : 400 lisible, pas de décompression sans limite", async () => {
    const files = unzipSync(toBuffer(XLSX.utils.aoa_to_sheet([HEADERS, validValues("x")])));
    const z = Buffer.from(zipSync({ ...files, "xl/media/big.bin": new Uint8Array(60 * 1024 * 1024) }));
    expect(z.length).toBeLessThan(5 * 1024 * 1024);
    const eocd = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    let cursor = z.readUInt32LE(eocd + 16);
    for (let i = 0; i < z.readUInt16LE(eocd + 10); i++) {
      const nameLength = z.readUInt16LE(cursor + 28);
      if (z.subarray(cursor + 46, cursor + 46 + nameLength).toString() === "xl/media/big.bin") {
        z.writeUInt32LE(1, cursor + 24);
        z.writeUInt32LE(0, z.readUInt32LE(cursor + 42) + 22);
      }
      cursor += 46 + nameLength + z.readUInt16LE(cursor + 30) + z.readUInt16LE(cursor + 32);
    }
    const { status, body } = await importFile(z);
    expect(status).toBe(400);
    expect(body.message).toMatch(/illisible|décompressé/);
    expect(JSON.stringify(body)).not.toMatch(TECHNICAL);
  });

  it("exactement le maximum de lignes : accepté (lu en entier)", async () => {
    const rows: Array<Array<string | number>> = [HEADERS];
    for (let i = 0; i < SUPPLIER_INVOICE_IMPORT_MAX_ROWS; i++) {
      rows.push([`${uniqueTestToken("lim")}-${i}`, "TESTFOURNISSEURINCONNU", "15/10/2026", "15/11/2026", "1", "19.25", "1"]);
    }
    const { status, body } = await importFile(toBuffer(XLSX.utils.aoa_to_sheet(rows)));
    expect(status).toBe(200);
    expect(body).toMatchObject({ total: SUPPLIER_INVOICE_IMPORT_MAX_ROWS, success: 0 });
  });

  it("lignes vides intercalées qui cachent des lignes au-delà de la fenêtre : 400, rien de perdu en silence", async () => {
    const number = uniqueTestToken("hole");
    const rows: Array<Array<string | number>> = [HEADERS];
    for (let i = 0; i < SUPPLIER_INVOICE_IMPORT_MAX_ROWS - 1; i++) {
      rows.push(["", "TESTFOURNISSEURINCONNU", "", "", "", "", ""]);
    }
    rows.push([], []);
    for (let i = 0; i < 10; i++) rows.push(validValues(`${number}-${i}`));
    const { status, body } = await importFile(toBuffer(XLSX.utils.aoa_to_sheet(rows)));
    expect(status).toBe(400);
    expect(body.message).toMatch(new RegExp(String(SUPPLIER_INVOICE_IMPORT_MAX_ROWS)));
    expect(JSON.stringify(body)).not.toMatch(TECHNICAL);
    expect((await rowsFor(`${number}-0`)).length).toBe(0);
  });

  it("une formule est lue comme sa valeur calculée, jamais évaluée", async () => {
    const number = uniqueTestToken("form");
    const sheet = XLSX.utils.aoa_to_sheet([HEADERS, validValues(number)]);
    sheet["E2"] = { t: "n", v: 100000, f: "SUM(1,2)+9999999" };
    sheet["G2"] = { t: "n", v: 119250, f: "E2*1.1925" };
    const { status, body } = await importFile(toBuffer(sheet));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: 1, failed: 0 });
    const [invoice] = await rowsFor(number);
    expect(Number(invoice.amountHT)).toBe(100000);
    expect(Number(invoice.totalTTC)).toBe(119250);
  });

  it("en-têtes __proto__ / constructor : aucun effet sur Object.prototype, import normal", async () => {
    const number = uniqueTestToken("proto");
    const sheet = XLSX.utils.aoa_to_sheet([
      [...HEADERS, "__proto__", "constructor", "polluted"],
      [...validValues(number), "x", "y", "z"],
    ]);
    const { status, body } = await importFile(toBuffer(sheet));
    expect(status).toBe(200);
    expect(body).toMatchObject({ success: 1, failed: 0 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect((await rowsFor(number)).length).toBe(1);
  });
});
