import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../server/db";
import { supplierInvoices } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { createTestSupplier, createTestSupplierInvoice } from "../support/factories";

/**
 * GET /api/supplier-invoices/overdue et GET /api/supplier-invoices/statistics.
 * - Rôles : garde du montage (achats : admin, secretary, logistics, warehouse) puis `INVOICE_READ_ROLES`.
 *   `workshop_manager` figure dans `INVOICE_READ_ROLES` mais reste refusé par le montage.
 * - Retard : échéance passée et statut autre que `paid`, trié par échéance.
 * - Statistiques : agrégat de toutes les factures, montants en chaînes à deux décimales.
 * Écrit en base ; fournisseur et factures supprimés en fin de fichier.
 */
const OVERDUE = "/api/supplier-invoices/overdue";
const STATISTICS = "/api/supplier-invoices/statistics";

let session: Awaited<ReturnType<typeof startContractSession<"admin" | "secretary" | "logistics" | "warehouse" | "workshop" | "technician" | "driver" | "client">>>;
let supplierName = "";
const created: Record<"late" | "older" | "paid" | "future" | "noDue", number> = { late: 0, older: 0, paid: 0, future: 0, noDue: 0 };

const money = z.string().regex(/^-?\d+\.\d{2}$/);
const overdueRowSchema = z.object({
  id: z.number().int(),
  invoiceNumber: z.string(),
  supplierId: z.number().int(),
  supplierName: z.string(),
  invoiceDate: z.string(),
  dueDate: z.string(),
  daysOverdue: z.number().int().positive(),
  totalAmount: money,
  balance: money,
  status: z.string(),
});
const statisticsSchema = z.object({
  totalInvoices: z.number().int().nonnegative(),
  totalAmountHT: money,
  totalAmountTTC: money,
  totalPaid: money,
  totalBalance: money,
  byStatus: z.array(z.object({ status: z.string(), label: z.string(), count: z.number().int().positive(), totalAmount: money, totalBalance: money })),
  discrepancies: z.object({ total: z.number().int().nonnegative(), averageVariance: z.string(), percentage: z.string() }),
  topSuppliers: z.array(z.object({ supplierName: z.string(), totalInvoices: z.number().int().positive(), totalAmount: money })).max(5),
});

async function invoiceDue(supplierId: number, dueDate: string | null, status: "received" | "paid" = "received", balance = "119250.00") {
  const row = await createTestSupplierInvoice({ supplierId, status, balance });
  await db.update(supplierInvoices).set({ dueDate }).where(eq(supplierInvoices.id, row.id));
  return row.id;
}

beforeAll(async () => {
  session = await startContractSession({
    admin: "admin",
    secretary: "secretary",
    logistics: "logistics",
    warehouse: "warehouse",
    workshop: "workshop_manager",
    technician: "technician",
    driver: "driver",
    client: "client",
  });
  const supplier = await createTestSupplier();
  session.ids.supplierIds.push(supplier.id);
  supplierName = supplier.name;
  created.late = await invoiceDue(supplier.id, "2001-03-10", "received", "50000.00");
  created.older = await invoiceDue(supplier.id, "2001-03-01");
  created.paid = await invoiceDue(supplier.id, "2001-03-05", "paid", "0.00");
  created.future = await invoiceDue(supplier.id, "2099-12-31");
  created.noDue = await invoiceDue(supplier.id, null);
}, 180000);

afterAll(async () => {
  await session.stop();
});

describe.each([OVERDUE, STATISTICS])("%s : droits", (path) => {
  it("sans session : 401", async () => {
    expect((await session.call("GET", path, { actor: null })).status).toBe(401);
  });

  it.each(["workshop", "technician", "driver", "client"] as const)("%s : 403", async (actor) => {
    expect((await session.call("GET", path, { actor })).status).toBe(403);
  });

  it.each(["admin", "secretary", "logistics", "warehouse"] as const)("%s : 200", async (actor) => {
    expect((await session.call("GET", path, { actor })).status).toBe(200);
  });
});

describe("factures en retard", () => {
  it("échéance passée et non payée seulement, triées par échéance, montants à deux décimales", async () => {
    const r = await session.call("GET", OVERDUE, { actor: "secretary" });
    const rows = z.array(overdueRowSchema).parse(r.body);
    const mine = rows.filter((row) => Object.values(created).includes(row.id));
    expect(mine.map((row) => row.id)).toEqual([created.older, created.late]);
    expect(mine[1]).toMatchObject({ supplierName, dueDate: "2001-03-10", balance: "50000.00", totalAmount: "119250.00", status: "received" });
    expect(mine[0].daysOverdue).toBeGreaterThan(mine[1].daysOverdue);
  });
});

describe("statistiques", () => {
  it("corps au contrat, factures du test comptées", async () => {
    const r = await session.call("GET", STATISTICS, { actor: "warehouse" });
    const stats = statisticsSchema.parse(r.body);
    expect(stats.totalInvoices).toBeGreaterThanOrEqual(Object.keys(created).length);
    const statuses = stats.byStatus.map((s) => s.status);
    expect(statuses).toEqual(expect.arrayContaining(["received", "paid"]));
    expect(Number(stats.totalPaid)).toBeGreaterThanOrEqual(119250);
  });
});
