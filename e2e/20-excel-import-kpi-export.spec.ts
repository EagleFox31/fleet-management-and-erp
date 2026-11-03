import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "../server/db";
import { supplierInvoices } from "../shared/schema";
import { cleanupCreated, createIdBag } from "../tests/support/cleanup";
import { createTestSupplier } from "../tests/support/factories";
import { uniqueTestToken } from "../tests/support/ids";
import { loginWithSession, type E2ECredentials } from "./helpers/auth";
import { createE2EUser } from "./helpers/test-data";

/**
 * Bout en bout de la PR #98 (SheetJS 0.20.3) et du rapport d'indicateurs (CDC #7).
 *
 * - Import Excel des factures fournisseur depuis l'écran : modèle téléchargé, classeur
 *   écrit par la même bibliothèque, une ligne acceptée et une refusée avec un message
 *   lisible ; la facture est relue en base.
 * - Fichier qui n'est pas un classeur : refus lisible, sans détail technique.
 * - Export `kpi-report` en xlsx et pdf pour la direction, refusé à la secrétaire.
 *
 * Les règles fines (bombe zip, plafonds, formats de cellule) sont couvertes aux niveaux
 * unitaire et contrat ; ici on vérifie que le vrai serveur et l'écran tiennent ensemble.
 * Le rapport exige `FEATURE_FLAGS=kpi-reports=on` dans l'environnement du serveur.
 */

const ids = createIdBag();
let secretary: E2ECredentials;
let management: E2ECredentials;
let supplierName: string;

test.beforeAll(async () => {
  secretary = await createE2EUser("secretary", ids);
  management = await createE2EUser("management", ids);
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierName = supplier.name;
});

test.afterAll(async () => {
  await cleanupCreated(ids);
});

function workbookBuffer(rows: Record<string, string>[]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Factures");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function invoiceRow(invoiceNumber: string, supplier: string): Record<string, string> {
  return {
    "Numéro Facture": invoiceNumber,
    Fournisseur: supplier,
    "Date Facture": "15/01/2026",
    "Date Échéance": "15/02/2026",
    "Montant HT": "100000",
    "TVA (%)": "19.25",
    "Montant TTC": "119250",
  };
}

const TECHNICAL_DETAIL = /stack|at \w+ \(|SQL|ZodError|TypeError|\{"/;

test.describe("Import Excel des factures fournisseur (#98)", () => {
  test("modèle téléchargé, une ligne importée, une refusée avec un message lisible", async ({ page }) => {
    await loginWithSession(page, secretary);
    await page.goto("/procurement/invoices");
    await page.getByTestId("button-import-excel").click();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("button-download-template").click(),
    ]);
    expect(download.suggestedFilename()).toBe("template_factures_fournisseurs.xlsx");
    const template = XLSX.read(await download.createReadStream().then(streamToBuffer), { type: "buffer" });
    const [header] = XLSX.utils.sheet_to_json<string[]>(template.Sheets[template.SheetNames[0]], { header: 1 });
    expect(header).toEqual(expect.arrayContaining(Object.keys(invoiceRow("x", "y"))));

    const accepted = uniqueTestToken("xlsx-ok");
    const unknownSupplier = uniqueTestToken("absent");
    const file = workbookBuffer([invoiceRow(accepted, supplierName), invoiceRow(uniqueTestToken("xlsx-ko"), unknownSupplier)]);

    await page.getByTestId("input-excel-file").setInputFiles({
      name: "factures.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: file,
    });
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/supplier-invoices/import") && r.request().method() === "POST"),
      page.getByTestId("button-start-import").click(),
    ]);
    expect(response.status()).toBe(200);
    const result = await response.json();

    const [stored] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.invoiceNumber, accepted));
    if (stored) ids.invoiceIds.push(stored.id);

    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([{ row: 3, message: `Fournisseur « ${unknownSupplier} » introuvable.` }]);
    await expect(page.getByText(`Fournisseur « ${unknownSupplier} » introuvable.`)).toBeVisible();

    expect(stored, "facture importée relue en base").toBeTruthy();
    expect(stored.supplierId).toBe(ids.supplierIds[0]);
    expect(Number(stored.amountHT)).toBe(100000);
    expect(Number(stored.totalTTC)).toBe(119250);
    expect(stored.invoiceDate).toBe("2026-01-15");
  });

  test("un fichier qui n'est pas un classeur est refusé sans détail technique", async ({ page }) => {
    await loginWithSession(page, secretary);
    const response = await page.request.post("/api/supplier-invoices/import", {
      multipart: {
        file: {
          name: "faux.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: Buffer.from("ceci n'est pas un classeur"),
        },
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
    const body = await response.json();
    expect(typeof body.message).toBe("string");
    expect(body.message).not.toMatch(TECHNICAL_DETAIL);
  });
});

test.describe("Export du rapport d'indicateurs (CDC #7)", () => {
  test("xlsx et pdf pour la direction, refusé à la secrétaire", async ({ page, browser }) => {
    await loginWithSession(page, management);
    const xlsx = await page.request.get("/api/exports/kpi-report?period=month&format=xlsx");
    test.skip(xlsx.status() === 404, "Drapeau kpi-reports coupé : lancer le serveur avec FEATURE_FLAGS=kpi-reports=on.");

    expect(xlsx.status()).toBe(200);
    expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
    expect(xlsx.headers()["content-disposition"]).toMatch(/^attachment; filename=".+\.xlsx"$/);
    const workbook = XLSX.read(await xlsx.body(), { type: "buffer" });
    expect(workbook.SheetNames.length).toBeGreaterThan(0);

    const pdf = await page.request.get("/api/exports/kpi-report?period=month&format=pdf");
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const other = await browser.newPage();
    try {
      await loginWithSession(other, secretary);
      const refused = await other.request.get("/api/exports/kpi-report?period=month&format=xlsx");
      expect(refused.status()).toBe(403);
      expect((await refused.json()).message).not.toMatch(TECHNICAL_DETAIL);
    } finally {
      await other.close();
    }
  });
});

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
