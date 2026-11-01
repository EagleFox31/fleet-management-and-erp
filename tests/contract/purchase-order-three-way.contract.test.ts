import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alerts, purchaseOrderLines, purchaseOrders, supplierInvoices } from "../../shared/schema";
import { threeWayMatchingService } from "../../server/services/three-way-matching-service";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, PO2 : rapprochement commande / facture fournisseur.
 * - Facture au montant de la commande : aucun écart, recommandation « approbation auto ».
 * - Écart de 5 % ou plus (en plus comme en moins) : écart enregistré, remonté dans la liste des écarts
 *   à traiter, recommandation « escalade ».
 * - Écart sous le seuil : revue manuelle, pas d'escalade.
 * - Facture sans commande : revue manuelle, jamais d'approbation automatique.
 * - Facture sur une commande inconnue : refus lisible, jamais 500.
 * - Lecture réservée aux profils finance/achats ; le technicien est refusé.
 * Jamais d'appel à `POST /auto-approve` : il approuverait les factures « reçues » de toute la base.
 * Écrit en base ; tout est supprimé.
 */

type Actor = "secretary" | "technician";
const ROLES: Record<Actor, TestUserRole> = { secretary: "secretary", technician: "technician" };

let server: Server;
let baseUrl = "";
let supplierId = 0;
let adminId = 0;
const cookies = new Map<Actor, string>();
const ids = createIdBag();
const orderIds: number[] = [];

async function call(actor: Actor, method: string, path: string, body?: unknown) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { Cookie: cookies.get(actor)!, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => null);
  if (json?.invoice?.id) ids.invoiceIds.push(json.invoice.id);
  return { status: response.status, body: json };
}

async function orderWithTotal(totalTTC: number, quantity = 4) {
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      orderNumber: uniqueTestToken("po"),
      supplierId,
      orderDate: new Date().toISOString().slice(0, 10),
      status: "delivered",
      totalAmountHT: String(totalTTC),
      vatAmount: "0",
      totalAmountTTC: String(totalTTC),
      createdBy: adminId,
    } as any)
    .returning();
  orderIds.push(order.id);
  await db.insert(purchaseOrderLines).values({
    purchaseOrderId: order.id,
    description: "TEST ligne",
    quantityOrdered: quantity,
    unitPrice: String(totalTTC / quantity),
    totalPrice: String(totalTTC),
  } as any);
  return order;
}

const invoiceFor = (purchaseOrderId: number | undefined, totalTTC: number) =>
  call("secretary", "POST", "/api/supplier-invoices", {
    supplierId,
    invoiceNumber: uniqueTestToken("sinv"),
    invoiceDate: "2026-10-30",
    amountHT: totalTTC,
    totalTTC,
    quantity: "4",
    vatAmount: 0,
    ...(purchaseOrderId ? { purchaseOrderId } : {}),
  });

async function rowOf(invoiceId: number) {
  const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoiceId));
  return row;
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

  for (const actor of Object.keys(ROLES) as Actor[]) {
    const user = await createTestUser({ role: ROLES[actor] });
    ids.userIds.push(user.id);
    if (actor === "secretary") adminId = user.id;
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  if (ids.invoiceIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.id, ids.invoiceIds));
  }
  if (orderIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, orderIds));
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("PO2 rapprochement commande / facture", { timeout: 120000 }, () => {
  it("montant identique : aucun écart, recommandation d'approbation automatique", async () => {
    const order = await orderWithTotal(100000);
    const res = await invoiceFor(order.id, 100000);
    expect(res.status).toBe(201);
    expect(res.body.validation).toMatchObject({ hasDiscrepancy: false, recommendation: "auto_approve" });
    const row = await rowOf(res.body.invoice.id);
    expect(row.hasDiscrepancy).toBe(false);
    expect(row.status).toBe("received");
  });

  it.each([
    { label: "facturé 10 % de plus", amount: 110000 },
    { label: "facturé 10 % de moins", amount: 90000 },
  ])("$label : écart enregistré, escalade, facture non approuvée", async ({ amount }) => {
    const order = await orderWithTotal(100000);
    const res = await invoiceFor(order.id, amount);
    expect(res.status).toBe(201);
    expect(res.body.validation).toMatchObject({ hasDiscrepancy: true, recommendation: "escalate" });
    expect(res.body.message).toMatch(/écart/i);

    const row = await rowOf(res.body.invoice.id);
    expect(row.hasDiscrepancy).toBe(true);
    expect(Number(row.priceVariance)).toBe(amount - 100000);
    expect(row.status).toBe("received");
    expect(row.approvedBy).toBeNull();

    const list = await call("secretary", "GET", "/api/supplier-invoices/discrepancies");
    expect(list.status).toBe(200);
    expect(list.body.discrepancies.map((d: { invoiceId: number }) => d.invoiceId)).toContain(row.id);
  });

  // Régression : à 5 % pile l'écart est signalé (>= seuil), la recommandation doit suivre.
  it("exactement 5 % d'écart : écart marqué ET escalade (incohérence seuil >= / <=)", async () => {
    const order = await orderWithTotal(100000);
    const res = await invoiceFor(order.id, 105000);
    expect(res.status).toBe(201);
    expect(res.body.validation).toMatchObject({ hasDiscrepancy: true, recommendation: "escalate" });
  });

  it("écart sous le seuil (2 %) : revue manuelle, pas d'escalade ni de remontée", async () => {
    const order = await orderWithTotal(100000);
    const res = await invoiceFor(order.id, 102000);
    expect(res.status).toBe(201);
    expect(res.body.validation).toMatchObject({ hasDiscrepancy: false, recommendation: "manual_review" });

    const list = await call("secretary", "GET", "/api/supplier-invoices/discrepancies");
    expect(list.body.discrepancies.map((d: { invoiceId: number }) => d.invoiceId)).not.toContain(res.body.invoice.id);
  });

  it("facture sans commande : jamais d'approbation automatique", async () => {
    const res = await invoiceFor(undefined, 50000);
    expect(res.status).toBe(201);
    const verdict = await threeWayMatchingService.validateInvoiceAgainstOrder(res.body.invoice.id);
    expect(verdict.recommendation).toBe("manual_review");
    expect(verdict.isValid).toBe(false);
  });

  // Régression : un purchaseOrderId inexistant donnait une violation de clé étrangère (500).
  it("commande inconnue : refus lisible, aucune facture, jamais 500", async () => {
    const number = uniqueTestToken("sinv");
    const res = await call("secretary", "POST", "/api/supplier-invoices", {
      supplierId,
      invoiceNumber: number,
      invoiceDate: "2026-10-30",
      amountHT: 1000,
      purchaseOrderId: 2147483000,
    });
    expect([400, 404, 409]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toMatch(/violates|SQLSTATE|foreign key|stack/i);
    expect(await db.select().from(supplierInvoices).where(eq(supplierInvoices.invoiceNumber, number))).toHaveLength(0);
  });

  it("technicien : liste des écarts refusée", async () => {
    const res = await call("technician", "GET", "/api/supplier-invoices/discrepancies");
    expect(res.status).toBe(403);
  });
});
