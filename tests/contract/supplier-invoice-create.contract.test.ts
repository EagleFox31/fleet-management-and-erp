import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestUser, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { leakText } from "../support/api-error";

/**
 * Niveau C, saisie d'une facture fournisseur (`POST /api/supplier-invoices`).
 * - T3 : montant négatif, non numérique, nul ou hors bornes -> 400 lisible, aucune facture.
 * - T4 : statut, validation, approbation, paiement, solde et écarts envoyés par le client ignorés ;
 *   TVA et TTC calculés, solde initial = TTC (sinon la facture ne peut recevoir aucun règlement).
 * - Numéro déjà saisi -> 409 lisible, jamais de détail SQL.
 */

let server: Server;
let baseUrl = "";
let cookie = "";
let supplierId = 0;
let userId = 0;
const ids = createIdBag();

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
  expect(leakText(res.body)).not.toMatch(/stack|at \S+:\d+|SQLSTATE|TypeError|violates|NaN|duplicate key/);
}

async function create(body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}/api/supplier-invoices`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ supplierId, invoiceDate: "2026-10-30", ...body }),
  });
  const json = await response.json().catch(() => null);
  if (json?.invoice?.id) ids.invoiceIds.push(json.invoice.id);
  return { status: response.status, body: json, headers: response.headers };
}

async function rowsFor(invoiceNumber: string) {
  return db.select().from(supplierInvoices).where(eq(supplierInvoices.invoiceNumber, invoiceNumber));
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;

  const user = await createTestUser({ role: "secretary" });
  ids.userIds.push(user.id);
  userId = user.id;
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

describe("Saisie d'une facture fournisseur : contrat", { timeout: 120000 }, () => {
  it.each([
    { label: "HT négatif", body: { amountHT: -5000 } },
    { label: "HT non numérique", body: { amountHT: "abc" } },
    { label: "HT nul sans TTC", body: { amountHT: 0 } },
    { label: "HT hors bornes", body: { amountHT: 1e15 } },
    { label: "TVA négative", body: { amountHT: 1000, vatAmount: -10 } },
    { label: "TTC inférieur au HT", body: { amountHT: 1000, totalTTC: 500 } },
  ])("T3 : $label -> 400 lisible, aucune facture", async ({ body }) => {
    const invoiceNumber = uniqueTestToken("sinv");
    const res = await create({ invoiceNumber, ...body });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    expect(await rowsFor(invoiceNumber)).toHaveLength(0);
  });

  it("T4 : champs serveur ignorés, TVA et TTC calculés, solde initial = TTC", async () => {
    const invoiceNumber = uniqueTestToken("sinv");
    const res = await create({
      invoiceNumber,
      amountHT: 100000,
      status: "paid",
      validatedBy: userId,
      validatedAt: "2026-10-30T10:00:00Z",
      approvedBy: userId,
      approvedAt: "2026-10-30T10:00:00Z",
      paidBy: userId,
      paidDate: "2026-10-30",
      paymentDate: "2026-10-30",
      isPaymentComplete: true,
      balance: 0,
      priceVariance: 999,
      variancePercentage: 50,
      hasDiscrepancy: true,
    });
    expect(res.status).toBe(201);
    const [row] = await rowsFor(invoiceNumber);
    expect(row).toMatchObject({
      status: "received",
      validatedBy: null,
      validatedAt: null,
      approvedBy: null,
      approvedAt: null,
      paidBy: null,
      paidDate: null,
      paymentDate: null,
      isPaymentComplete: false,
      hasDiscrepancy: false,
      amountHT: "100000.00",
      vatAmount: "19250.00",
      totalTTC: "119250.00",
      balance: "119250.00",
    });
    expect(Number(row.priceVariance)).toBe(0);
  });

  it("numéro déjà saisi -> 409 lisible, une seule facture", async () => {
    const invoiceNumber = uniqueTestToken("sinv");
    const first = await create({ invoiceNumber, amountHT: 1000 });
    expect(first.status).toBe(201);
    const second = await create({ invoiceNumber, amountHT: 1000 });
    expect(second.status).toBe(409);
    expectErrorContract(second, "CONFLICT");
    expect(await rowsFor(invoiceNumber)).toHaveLength(1);
  });
});
