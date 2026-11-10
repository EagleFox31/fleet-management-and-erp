import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { purchaseOrderLines, purchaseOrders, supplierInvoices } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { uniqueTestToken } from "../support/ids";
import { createTestPart, createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Approbation d'une facture fournisseur (`PATCH /api/supplier-invoices/:id/approve`) : réservée à
 * l'administrateur et à la secrétaire. Elle passe la facture à `approved` et l'attribue à l'acteur,
 * sans toucher au montant ni au solde.
 */

let server: Server;
let baseUrl = "";
let supplierId = 0;
const ids = createIdBag();
const purchaseOrderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;

async function sessionOf(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return { user, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

async function invoice(status: (typeof supplierInvoices.$inferInsert)["status"] = "received") {
  const row = await createTestSupplierInvoice({ supplierId, status });
  ids.invoiceIds.push(row.id);
  return row;
}

const validate = (id: number | string, cookie?: string) =>
  fetch(`${baseUrl}/api/supplier-invoices/${id}/validate`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) } });

const approve = (id: number | string, cookie?: string) =>
  fetch(`${baseUrl}/api/supplier-invoices/${id}/approve`, { method: "PATCH", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) } });

async function rowOf(id: number) {
  const [row] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, id));
  return row;
}

beforeAll(async () => {
  (global as any).broadcastUpdate = () => {};
  server = createServer(await getContractApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  // La facture référence la commande : elle part d'abord.
  if (ids.invoiceIds.length > 0) await db.delete(supplierInvoices).where(inArray(supplierInvoices.id, ids.invoiceIds));
  if (purchaseOrderIds.length > 0) {
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, purchaseOrderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, purchaseOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("PATCH /api/supplier-invoices/:id/approve", { timeout: 120000 }, () => {
  it("la secrétaire approuve une facture reçue : statut approved, approbateur et date, montant et solde intacts", async () => {
    const secretary = await sessionOf("secretary");
    const target = await invoice("received");
    const before = Date.now();

    const res = await approve(target.id, secretary.cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invoice).toMatchObject({ id: target.id, status: "approved", approvedBy: secretary.user.id });

    const row = await rowOf(target.id);
    expect(row).toMatchObject({ status: "approved", approvedBy: secretary.user.id, totalTTC: target.totalTTC, balance: target.balance });
    expect(row.approvedAt!.getTime()).toBeGreaterThanOrEqual(before - 5000);
  });

  it("l'administrateur approuve une facture validée", async () => {
    const admin = await sessionOf("admin");
    const target = await invoice("validated");
    expect((await approve(target.id, admin.cookie)).status).toBe(200);
    expect(await rowOf(target.id)).toMatchObject({ status: "approved", approvedBy: admin.user.id });
  });

  it("hors administration et secrétariat : 401 sans session, 403 pour le magasin et le technicien, facture intacte", async () => {
    const target = await invoice("received");
    expect((await approve(target.id)).status).toBe(401);
    for (const role of ["warehouse", "technician", "workshop_manager"] as const) {
      const { cookie } = await sessionOf(role);
      expect((await approve(target.id, cookie)).status, role).toBe(403);
    }
    expect(await rowOf(target.id)).toMatchObject({ status: "received", approvedBy: null, approvedAt: null });
  });

  it("identifiant mal formé : 400", async () => {
    const { cookie } = await sessionOf("secretary");
    expect((await approve("abc", cookie)).status).toBe(400);
  });
});

describe("garde de statut : approbation et validation", { timeout: 120000 }, () => {
  it("facture inconnue : 404", async () => {
    const { cookie } = await sessionOf("secretary");
    expect((await approve(2147483000, cookie)).status).toBe(404);
    expect((await validate(2147483000, cookie)).status).toBe(404);
  });

  it("facture payée : approbation refusée (409), reste payée, solde intact", async () => {
    const { cookie } = await sessionOf("secretary");
    const paid = await createTestSupplierInvoice({ supplierId, status: "paid", balance: "0.00" });
    ids.invoiceIds.push(paid.id);
    expect((await approve(paid.id, cookie)).status).toBe(409);
    expect(await rowOf(paid.id)).toMatchObject({ status: "paid", balance: "0.00" });
  });

  it("seconde approbation : 200, l'approbateur et la date d'origine sont conservés", async () => {
    const first = await sessionOf("secretary");
    const second = await sessionOf("admin");
    const target = await invoice("received");
    expect((await approve(target.id, first.cookie)).status).toBe(200);
    const once = await rowOf(target.id);
    expect((await approve(target.id, second.cookie)).status).toBe(200);
    expect(await rowOf(target.id)).toMatchObject({ approvedBy: first.user.id, approvedAt: once.approvedAt });
  });

  it("facture en litige : approbation refusée (409), reste en litige", async () => {
    const { cookie } = await sessionOf("secretary");
    const target = await invoice("disputed");
    const res = await approve(target.id, cookie);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("litige");
    expect((await rowOf(target.id)).status).toBe("disputed");
  });

  it("deux approbations simultanées : une seule écriture", async () => {
    const a = await sessionOf("secretary");
    const b = await sessionOf("admin");
    const target = await invoice("received");
    const [ra, rb] = await Promise.all([approve(target.id, a.cookie), approve(target.id, b.cookie)]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const row = await rowOf(target.id);
    expect(row.status).toBe("approved");
    expect([a.user.id, b.user.id]).toContain(row.approvedBy);
    await approve(target.id, (row.approvedBy === a.user.id ? b : a).cookie);
    expect(await rowOf(target.id)).toMatchObject({ approvedBy: row.approvedBy, approvedAt: row.approvedAt });
  });

  it("auto-approve ne touche ni une facture payée ni une facture en litige", async () => {
    const { cookie } = await sessionOf("admin");
    const paid = await invoice("paid");
    const disputed = await invoice("disputed");
    const res = await fetch(`${baseUrl}/api/supplier-invoices/auto-approve`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await rowOf(paid.id)).status).toBe("paid");
    expect((await rowOf(disputed.id)).status).toBe("disputed");
  });

  it("E1 facture payée : validation 409 et approbation 409, statut paid inchangé", async () => {
    const { cookie } = await sessionOf("secretary");
    const paid = await invoice("paid");
    expect((await validate(paid.id, cookie)).status).toBe(409);
    expect((await approve(paid.id, cookie)).status).toBe(409);
    expect(await rowOf(paid.id)).toMatchObject({ status: "paid", validatedBy: null, approvedBy: null });
  });

  it("E2 facture approuvée : validation 409 puis approbation 200, approbateur et date inchangés", async () => {
    const first = await sessionOf("secretary");
    const other = await sessionOf("admin");
    const target = await invoice("received");
    expect((await approve(target.id, first.cookie)).status).toBe(200);
    const once = await rowOf(target.id);
    expect((await validate(target.id, other.cookie)).status).toBe(409);
    expect((await approve(target.id, other.cookie)).status).toBe(200);
    expect(await rowOf(target.id)).toMatchObject({ status: "approved", approvedBy: first.user.id, approvedAt: once.approvedAt });
  });

  it("E3 le magasinier qui valide une facture de pièces payée : 409, reste payée", async () => {
    const { cookie } = await sessionOf("warehouse");
    const part = await createTestPart();
    ids.partIds.push(part.id);
    const [order] = await db
      .insert(purchaseOrders)
      .values({ orderNumber: uniqueTestToken("PO"), supplierId, orderDate: new Date().toISOString().slice(0, 10) })
      .returning();
    purchaseOrderIds.push(order.id);
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: order.id,
      partId: part.id,
      quantityOrdered: 1,
      unitPrice: "10.00",
      totalPrice: "10.00",
    } as any);
    const paid = await createTestSupplierInvoice({ supplierId, status: "paid", balance: "0.00" });
    ids.invoiceIds.push(paid.id);
    await db.update(supplierInvoices).set({ purchaseOrderId: order.id }).where(eq(supplierInvoices.id, paid.id));
    expect((await validate(paid.id, cookie)).status).toBe(409);
    expect(await rowOf(paid.id)).toMatchObject({ status: "paid", validatedBy: null });
  });

  it("validation : reçue puis validée (200), rejeu 200 sans écriture", async () => {
    const first = await sessionOf("secretary");
    const second = await sessionOf("admin");
    const target = await invoice("received");
    expect((await validate(target.id, first.cookie)).status).toBe(200);
    const once = await rowOf(target.id);
    expect(once).toMatchObject({ status: "validated", validatedBy: first.user.id });
    expect((await validate(target.id, second.cookie)).status).toBe(200);
    expect(await rowOf(target.id)).toMatchObject({ validatedBy: first.user.id, validatedAt: once.validatedAt });
  });

  it("rejeu sans écriture : aucun nouvel événement supplier_invoice_updated, première écriture diffusée", async () => {
    const { cookie } = await sessionOf("admin");
    const frames: string[] = [];
    (global as any).broadcastUpdate = (type: string, data: { entityId?: number | null }) => {
      frames.push(`${type}:${data?.entityId ?? ""}`);
    };
    try {
      const target = await invoice("received");
      const countFor = (id: number) => frames.filter((f) => f === `supplier_invoice_updated:${id}`).length;
      expect((await approve(target.id, cookie)).status).toBe(200);
      const afterFirst = countFor(target.id);
      expect(afterFirst).toBeGreaterThan(0);
      expect((await approve(target.id, cookie)).status).toBe(200);
      expect(countFor(target.id)).toBe(afterFirst);

      const other = await invoice("received");
      expect((await validate(other.id, cookie)).status).toBe(200);
      const afterOther = countFor(other.id);
      expect(afterOther).toBeGreaterThan(0);
      expect((await validate(other.id, cookie)).status).toBe(200);
      expect(countFor(other.id)).toBe(afterOther);
    } finally {
      (global as any).broadcastUpdate = () => {};
    }
  });
});
