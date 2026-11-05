import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * Approbation d'une facture fournisseur (`PATCH /api/supplier-invoices/:id/approve`) : réservée à
 * l'administrateur et à la secrétaire. Elle passe la facture à `approved` et l'attribue à l'acteur,
 * sans toucher au montant ni au solde.
 */

let server: Server;
let baseUrl = "";
let supplierId = 0;
const ids = createIdBag();
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

const approve = (id: number | string, cookie?: string) =>
  fetch(`${baseUrl}/api/supplier-invoices/${id}/approve`, { method: "PATCH", headers: cookie ? { Cookie: cookie } : {} });

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
