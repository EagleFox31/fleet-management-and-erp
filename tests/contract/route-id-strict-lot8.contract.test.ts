import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  partRequirements,
  parts,
  partsStockMovements,
  partsUsed,
  supplierInvoiceSettlements,
  supplierInvoices,
  workOrders,
} from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import {
  createTestPart,
  createTestSupplier,
  createTestSupplierInvoice,
  createTestUser,
  createTestVehicle,
  TEST_USER_PASSWORD,
} from "../support/factories";

/**
 * Lot 8 de #360 : validation stricte des identifiants sur les écritures de
 * `supplier-invoices`, `work-order-parts` et `part-requirements` (server/api, `parseRouteId`).
 * Chaque appel vise `<id>abc` où `<id>` existe : la réponse est 400 avec le message existant,
 * et l'objet `<id>` reste tel quel (statut, quantité en stock, aucune ligne créée).
 */

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const requirementIds: number[] = [];

async function call(method: string, path: string, body: unknown = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: method === "DELETE" ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as { message?: string } | null;
  return { status: response.status, message: json?.message };
}

async function invoiceStatus(id: number) {
  const [row] = await db.select({ status: supplierInvoices.status }).from(supplierInvoices).where(eq(supplierInvoices.id, id));
  return row.status;
}

async function createWorkOrder(technicianId: number, title: string) {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId: vehicle.id, title, status: "in_progress", technicianId })
    .returning();
  workOrderIds.push(workOrder.id);
  return workOrder;
}

async function createRequirement(values: { partId: number; workOrderId?: number; status: "pending" | "received"; requestedBy: number }) {
  const [row] = await db
    .insert(partRequirements)
    .values({ ...values, quantityNeeded: 2, reason: "TEST lot 8" })
    .returning();
  requirementIds.push(row.id);
  return row;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: admin.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
  }
  if (ids.partIds.length > 0) {
    // Inclut une demande qu'aurait créée l'ancien code (rouge).
    await db.delete(partRequirements).where(inArray(partRequirements.partId, ids.partIds));
  }
  if (requirementIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  }
  if (workOrderIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("ids de route (lot 8) : écritures strictes, objet <id> intact", { timeout: 120000 }, () => {
  it.each([
    ["PATCH", "validate", "received"],
    ["PATCH", "approve", "validated"],
    ["POST", "payment", "approved"],
  ] as const)("%s /api/supplier-invoices/<id>abc/%s : 400, statut inchangé", async (method, action, status) => {
    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);
    const invoice = await createTestSupplierInvoice({ supplierId: supplier.id, status });
    ids.invoiceIds.push(invoice.id);

    const res = await call(method, `/api/supplier-invoices/${invoice.id}abc/${action}`, {
      paymentDate: "2026-11-05",
      paymentMethod: "virement",
      proofReference: "TEST-lot8",
    });
    expect(res.status).toBe(400);
    expect(res.message).toBe("Identifiant de facture invalide.");
    expect(await invoiceStatus(invoice.id)).toBe(status);
    const settlements = await db
      .select({ id: supplierInvoiceSettlements.id })
      .from(supplierInvoiceSettlements)
      .where(eq(supplierInvoiceSettlements.supplierInvoiceId, invoice.id));
    expect(settlements).toHaveLength(0);
  });

  it.each([
    ["l'OT", (wo: number, rq: number) => `/api/work-orders/${wo}abc/part-requirements/${rq}/issue`],
    ["la demande", (wo: number, rq: number) => `/api/work-orders/${wo}/part-requirements/${rq}abc/issue`],
  ])("POST .../issue, <id>abc sur %s : 400, stock et demande inchangés", async (_label, path) => {
    const technician = await createTestUser({ role: "technician" });
    ids.userIds.push(technician.id);
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    const workOrder = await createWorkOrder(technician.id, "TEST lot 8 sortie");
    const requirement = await createRequirement({ partId: part.id, workOrderId: workOrder.id, status: "received", requestedBy: technician.id });

    const res = await call("POST", path(workOrder.id, requirement.id));
    expect(res.status).toBe(400);
    expect(res.message).toBe("ID invalide");

    const [stock] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(5);
    const [stored] = await db.select({ status: partRequirements.status }).from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(stored.status).toBe("received");
    expect(await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, part.id))).toHaveLength(0);
    expect(await db.select().from(partsUsed).where(eq(partsUsed.workOrderId, workOrder.id))).toHaveLength(0);
  });

  it("POST /api/work-orders/<id>abc/parts : 400, aucune demande créée", async () => {
    const technician = await createTestUser({ role: "technician" });
    ids.userIds.push(technician.id);
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    const workOrder = await createWorkOrder(technician.id, "TEST lot 8 demande");

    const res = await call("POST", `/api/work-orders/${workOrder.id}abc/parts`, { partId: part.id, quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.message).toBe("ID d'ordre de travail invalide");
    expect(await db.select().from(partRequirements).where(eq(partRequirements.partId, part.id))).toHaveLength(0);
    const [stock] = await db.select({ quantity: parts.quantity }).from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(5);
  });

  it("POST /api/work-orders/<id>abc/awaiting-parts : 400, statut d'OT inchangé", async () => {
    const technician = await createTestUser({ role: "technician" });
    ids.userIds.push(technician.id);
    const workOrder = await createWorkOrder(technician.id, "TEST lot 8 attente");

    const res = await call("POST", `/api/work-orders/${workOrder.id}abc/awaiting-parts`, { reason: "TEST lot 8" });
    expect(res.status).toBe(400);
    expect(res.message).toBe("ID d'ordre de travail invalide");
    const [stored] = await db.select({ status: workOrders.status }).from(workOrders).where(eq(workOrders.id, workOrder.id));
    expect(stored.status).toBe("in_progress");
  });

  it.each([
    ["PATCH", { status: "approved", notes: "TEST lot 8" }],
    ["DELETE", undefined],
  ] as const)("%s /api/part-requirements/<id>abc : 400, demande inchangée", async (method, body) => {
    const technician = await createTestUser({ role: "technician" });
    ids.userIds.push(technician.id);
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    const requirement = await createRequirement({ partId: part.id, status: "pending", requestedBy: technician.id });

    const res = await call(method, `/api/part-requirements/${requirement.id}abc`, body);
    expect(res.status).toBe(400);
    expect(res.message).toBe("ID de demande invalide");
    const rows = await db
      .select({ status: partRequirements.status, notes: partRequirements.notes })
      .from(partRequirements)
      .where(eq(partRequirements.id, requirement.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].notes).toBeNull();
  });
});
