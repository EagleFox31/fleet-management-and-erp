import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { inArray } from "drizzle-orm";
import { fuelRecords, purchaseOrderLines, purchaseOrders } from "../../shared/schema";
import { PROCUREMENT_ROLES, STAFF_ROLES } from "../../shared/constants/roles";
import { normalizeScope, resolveRecipients } from "../../server/lib/realtime-scope";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestSupplier } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Portée des trames temps réel des écrans d'argent : factures fournisseur, commandes fournisseur,
 * carte carburant. Les trames sont capturées à `broadcastUpdate` et leur portée est résolue comme
 * `server/lib/realtime-scope.ts` (fermée par défaut). Attendu : les rôles de lecture les reçoivent,
 * ni un client, ni un chauffeur, ni un technicien.
 */
type Scope = unknown;
type Captured = { eventType: string; scope?: Scope; payload?: any };

const ROLES = ["admin","secretary","warehouse","logistics","workshop_manager","technician","driver","client","management"];
const reaches = (scope: Scope | undefined, role: string, userId: number): boolean => {
  const index = {
    byUser: new Map([[userId, new Set(["s"])]]),
    byRole: new Map(ROLES.filter((r) => r === role).map((r) => [r, new Set(["s"])])),
  };
  return resolveRecipients(normalizeScope(scope, null), index).size > 0;
};

const ACTORS = {
  admin: "admin",
  secretary: "secretary",
  warehouse: "warehouse",
  logistics: "logistics",
  workshop_manager: "workshop_manager",
  technician: "technician",
  driver: "driver",
  client: "client",
  management: "management",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const captured: Captured[] = [];
const orderIds: number[] = [];
const fuelIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let supplierId = 0;

const recipients = (prefix: string): Actor[] => {
  const frames = captured.filter((f) => f.eventType.startsWith(prefix));
  expect(frames.length, `trame ${prefix}* émise`).toBeGreaterThan(0);
  return (Object.keys(ACTORS) as Actor[]).filter((a) =>
    frames.some((f) => reaches(f.scope, ACTORS[a], session.userIdOf(a))),
  );
};

beforeAll(async () => {
  (global as any).broadcastUpdate = (eventType: string, data: any) => {
    captured.push({ eventType, scope: data?.scope, payload: data?.payload });
  };
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const supplier = await createTestSupplier();
  ids.supplierIds.push(supplier.id);
  supplierId = supplier.id;
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (fuelIds.length > 0) await db.delete(fuelRecords).where(inArray(fuelRecords.id, fuelIds));
  if (orderIds.length > 0) {
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, orderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
  }
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("portée des trames d'argent", { timeout: 120000 }, () => {
  it("facture fournisseur : lecteurs de la facture seulement", async () => {
    const res = await session.call("POST", "/api/supplier-invoices", {
      actor: "secretary",
      body: { supplierId, invoiceNumber: uniqueTestToken("rts"), invoiceDate: "2032-02-01", amountHT: 10000 },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    if (res.body?.invoice?.id) ids.invoiceIds.push(res.body.invoice.id);
    expect(recipients("supplier_invoice_").sort()).toEqual(["admin", "logistics", "management", "secretary", "warehouse"]);
    // La direction ne reçoit que la trame réduite aux identifiants (son tableau de bord se rafraîchit, sans la facture).
    const mgmt = captured.filter(
      (f) => f.eventType.startsWith("supplier_invoice_") && reaches(f.scope, "management", session.userIdOf("management")),
    );
    expect(mgmt.length).toBeGreaterThan(0);
    for (const frame of mgmt) expect(Object.keys(frame.payload).sort()).toEqual(["invoiceId", "purchaseOrderId"]);
  });

  it("commande fournisseur : rôles d'approvisionnement seulement", async () => {
    const res = await session.call("POST", "/api/purchase-orders", {
      actor: "admin",
      body: { supplierId, manualLines: [{ description: "TEST ligne", quantityOrdered: 1, unitPrice: 1000 }] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    orderIds.push(res.body.id);
    expect(recipients("purchase_order_").sort()).toEqual([...PROCUREMENT_ROLES].sort());
  });

  it("carte carburant : personnel seulement, ni client", async () => {
    const res = await session.call("POST", "/api/fuel-card/recharge", {
      actor: "admin",
      body: { amount: 100000, unitPrice: 800, date: "2032-02-01", paymentMode: "virement", orderNumber: uniqueTestToken("cmd") },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body?.recharge?.id ?? res.body?.id;
    if (typeof id === "number") fuelIds.push(id);
    const got = recipients("fuel_card_");
    expect(got).not.toContain("client");
    expect(got.sort()).toEqual((STAFF_ROLES as readonly string[]).filter((r) => r in ACTORS).sort());
  });
});
