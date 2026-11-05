import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestSupplier, createTestSupplierInvoice, createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/** PATCH /api/supplier-invoices/:id/approve et POST /auto-approve : garde de statut, idempotence, course. */

let server: Server;
let baseUrl = "";
let supplierId = 0;
const ids = createIdBag();

async function sessionOf(role: "secretary" | "admin") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  return { user, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}
const approve = (id: number, cookie: string) =>
  fetch(`${baseUrl}/api/supplier-invoices/${id}/approve`, { method: "PATCH", headers: { Cookie: cookie } });
const rowOf = async (id: number) => (await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, id)))[0];

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
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("approbation : défauts", { timeout: 120000 }, () => {
  it("D1 facture inconnue : 404", async () => {
    const { cookie } = await sessionOf("secretary");
    const res = await approve(2147483000, cookie);
    expect(res.status).toBe(404);
  });

  it("D2 facture payée : refus 409, reste payée, solde intact", async () => {
    const { cookie } = await sessionOf("secretary");
    const paid = await createTestSupplierInvoice({ supplierId, status: "paid", balance: "0.00" });
    ids.invoiceIds.push(paid.id);
    const res = await approve(paid.id, cookie);
    expect(res.status).toBe(409);
    expect(await rowOf(paid.id)).toMatchObject({ status: "paid", balance: "0.00" });
  });

  it("D3 seconde approbation : l'approbateur et la date d'origine sont conservés", async () => {
    const first = await sessionOf("secretary");
    const second = await sessionOf("admin");
    const inv = await createTestSupplierInvoice({ supplierId, status: "received" });
    ids.invoiceIds.push(inv.id);
    expect((await approve(inv.id, first.cookie)).status).toBe(200);
    const once = await rowOf(inv.id);
    await approve(inv.id, second.cookie);
    expect(await rowOf(inv.id)).toMatchObject({ approvedBy: first.user.id, approvedAt: once.approvedAt });
  });

  it("D4 facture en litige : refus 409, reste en litige", async () => {
    const { cookie } = await sessionOf("secretary");
    const inv = await createTestSupplierInvoice({ supplierId, status: "disputed" });
    ids.invoiceIds.push(inv.id);
    expect((await approve(inv.id, cookie)).status).toBe(409);
    expect((await rowOf(inv.id)).status).toBe("disputed");
  });

  it("D5 rôle refusé : 403 et facture intacte", async () => {
    const { cookie } = await sessionOf("technician");
    const inv = await createTestSupplierInvoice({ supplierId, status: "received" });
    ids.invoiceIds.push(inv.id);
    expect((await approve(inv.id, cookie)).status).toBe(403);
    expect((await rowOf(inv.id)).status).toBe("received");
  });

  it("D6 statut validated : approuvée", async () => {
    const { cookie, user } = await sessionOf("secretary");
    const inv = await createTestSupplierInvoice({ supplierId, status: "validated" });
    ids.invoiceIds.push(inv.id);
    expect((await approve(inv.id, cookie)).status).toBe(200);
    expect(await rowOf(inv.id)).toMatchObject({ status: "approved", approvedBy: user.id });
  });

  it("D7 deux approbations simultanées : une seule écriture", async () => {
    const a = await sessionOf("secretary");
    const b = await sessionOf("admin");
    const inv = await createTestSupplierInvoice({ supplierId, status: "received" });
    ids.invoiceIds.push(inv.id);
    const [ra, rb] = await Promise.all([approve(inv.id, a.cookie), approve(inv.id, b.cookie)]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const row = await rowOf(inv.id);
    expect(row.status).toBe("approved");
    // Une seule écriture : l'approbateur est l'un des deux, et un troisième appel ne le change pas.
    expect([a.user.id, b.user.id]).toContain(row.approvedBy);
    await approve(inv.id, (row.approvedBy === a.user.id ? b : a).cookie);
    expect(await rowOf(inv.id)).toMatchObject({ approvedBy: row.approvedBy, approvedAt: row.approvedAt });
  });

  it("D8 auto-approve ne touche ni une facture payée ni une facture en litige", async () => {
    const { cookie } = await sessionOf("admin");
    const paid = await createTestSupplierInvoice({ supplierId, status: "paid", balance: "0.00" });
    const disputed = await createTestSupplierInvoice({ supplierId, status: "disputed" });
    ids.invoiceIds.push(paid.id, disputed.id);
    const res = await fetch(`${baseUrl}/api/supplier-invoices/auto-approve`, { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect((await rowOf(paid.id)).status).toBe("paid");
    expect((await rowOf(disputed.id)).status).toBe("disputed");
  });
});
