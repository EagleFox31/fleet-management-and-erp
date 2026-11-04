import { inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { normalizeScope, resolveRecipients, type ConnectionIndex } from "../../server/lib/realtime-scope";
import { relayDatabaseEvent } from "../../server/lib/db-event-relay";
import { createIncident } from "../../server/services/incident-service";
import { preventiveMaintenanceService } from "../../server/services/preventive-maintenance-service";
import { procurementService } from "../../server/services/procurement-service";
import {
  alerts,
  incidents,
  maintenanceSchedules,
  partRequirements,
  purchaseOrderLines,
  purchaseOrders,
  workOrders,
} from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestPart, createTestSupplier, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Cloison (AGENTS.md §11) des événements d'ordre de travail. Ils partaient en broadcast : tout
 * compte connecté, client compris, recevait l'OT (titre, coûts, pièces) de n'importe quel véhicule.
 * Attendu : le personnel hors chauffeur reçoit la trame complète ; un client ne reçoit aucune
 * trame d'OT, ni pour le véhicule d'un autre client ni pour le sien (aucun écran client ne les
 * écoute) ; le chauffeur ne reçoit aucune trame qui porte l'OT.
 * Seule exception voulue : le pont LISTEN/NOTIFY envoie au propriétaire d'un véhicule la trame
 * réduite `{ vehicleId, status }` de `vehicle_status_changed`, sans acteur, et à lui seul.
 *
 * Les trames sont capturées à `broadcastUpdate`, puis leurs destinataires sont résolus par le vrai
 * `normalizeScope` + `resolveRecipients` (`server/lib/realtime-scope.ts`, fermé par défaut), sur un
 * index de connexions où chaque acteur du test est un « socket ».
 */

type Scope = { type: string; userIds?: number[]; roles?: string[] };
type Captured = { eventType: string; scope?: Scope; data: Record<string, unknown> };

type Actor = "admin" | "manager" | "technician" | "warehouse" | "clientA" | "clientB" | "driver";
const ROLE: Record<Actor, "admin" | "workshop_manager" | "technician" | "warehouse" | "client" | "driver"> = {
  admin: "admin",
  manager: "workshop_manager",
  technician: "technician",
  warehouse: "warehouse",
  clientA: "client",
  clientB: "client",
  driver: "driver",
};
const ACTORS = Object.keys(ROLE) as Actor[];

const ids = createIdBag();
const workOrderIds: number[] = [];
const requirementIds: number[] = [];
const purchaseOrderIds: number[] = [];
const scheduleIds: number[] = [];
const partNames: string[] = [];
const captured: Captured[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let actors: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let index: ConnectionIndex<Actor>;
let vehicleA: number;
let vehicleB: number;

function buildIndex(): ConnectionIndex<Actor> {
  const byUser = new Map<number, Set<Actor>>();
  const byRole = new Map<string, Set<Actor>>();
  for (const actor of ACTORS) {
    byUser.set(actors.userIdOf(actor), new Set([actor]));
    const role = ROLE[actor];
    byRole.set(role, (byRole.get(role) ?? new Set<Actor>()).add(actor));
  }
  return { byUser, byRole };
}

/** Trames reçues par un acteur : portée résolue par le vrai `resolveRecipients`. */
const framesFor = (actor: Actor, eventType?: string) =>
  captured.filter(
    (frame) =>
      (!eventType || frame.eventType === eventType) &&
      resolveRecipients(normalizeScope(frame.scope, null), index).has(actor),
  );

async function seedWorkOrder(vehicleId: number, technicianId?: number, status: "pending" | "awaiting_parts" = "pending"): Promise<number> {
  const [row] = await db
    .insert(workOrders)
    .values({ vehicleId, title: uniqueTestToken("OT"), status, technicianId: technicianId ?? null })
    .returning();
  workOrderIds.push(row.id);
  return row.id;
}

/** Aucun client, ni A ni B, ne reçoit de trame d'OT ; le chauffeur non plus ; aucun broadcast. */
function expectClosed(eventType: string, identifiersOnly = false) {
  expect(captured.some((frame) => frame.eventType === eventType)).toBe(true);
  expect(framesFor("clientA", eventType)).toEqual([]);
  expect(framesFor("clientB", eventType)).toEqual([]);
  if (!identifiersOnly) expect(framesFor("driver", eventType)).toEqual([]);
  expect(captured.filter((frame) => frame.scope?.type === "broadcast")).toEqual([]);
}

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: Record<string, unknown>) => {
    captured.push({ eventType, scope: data?.scope as Scope | undefined, data: data ?? {} });
  });
  actors = await startContractActors<Actor>(ROLE, ids.userIds);
  index = buildIndex();
  const vA = await createTestVehicle({ ownerId: actors.userIdOf("clientA") });
  const vB = await createTestVehicle({ ownerId: actors.userIdOf("clientB") });
  ids.vehicleIds.push(vA.id, vB.id);
  vehicleA = vA.id;
  vehicleB = vB.id;
}, 180000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  for (const name of partNames) await db.delete(alerts).where(like(alerts.message, `%${name}%`));
  if (purchaseOrderIds.length > 0) {
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, purchaseOrderIds));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, purchaseOrderIds));
  }
  if (requirementIds.length > 0) await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  if (ids.vehicleIds.length > 0) await db.delete(incidents).where(inArray(incidents.vehicleId, ids.vehicleIds));
  if (ids.vehicleIds.length > 0) {
    const rows = await db.select({ id: workOrders.id }).from(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
    workOrderIds.push(...rows.map((r) => r.id));
  }
  if (workOrderIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (scheduleIds.length > 0) await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.id, scheduleIds));
  await cleanupCreated(ids);
  await actors?.close();
}, 120000);

describe("Ordres de travail : portée des trames temps réel (§11)", { timeout: 180000 }, () => {
  it("work_order_created (POST) : personnel en entier, aucun client, ni propriétaire ni autre", async () => {
    for (const vehicleId of [vehicleB, vehicleA]) {
      captured.length = 0;
      const res = await actors.call("POST", "/api/work-orders", {
        actor: "manager",
        body: { vehicleId, title: uniqueTestToken("OT"), description: "TEST portée", priority: "medium", status: "pending" },
      });
      expect(res.status).toBe(201);
      workOrderIds.push(res.body.id);
      expectClosed("work_order_created");
      const staff = framesFor("manager", "work_order_created");
      expect(staff).toHaveLength(1);
      expect(staff[0].data.workOrder).toBeTruthy();
      expect(framesFor("admin", "work_order_created")).toHaveLength(1);
    }
  });

  it("work_order_updated (PATCH) : le client A ne voit rien de l'OT du véhicule de B", async () => {
    const workOrderId = await seedWorkOrder(vehicleB);
    captured.length = 0;
    const res = await actors.call("PATCH", `/api/work-orders/${workOrderId}`, {
      actor: "admin",
      body: { description: "TEST portée modifiée" },
    });
    expect(res.status).toBe(200);
    expectClosed("work_order_updated");
    expect(framesFor("admin", "work_order_updated")).toHaveLength(1);
  });

  it("work_order_updated (technicien) : aucune trame vers un client", async () => {
    const workOrderId = await seedWorkOrder(vehicleB, actors.userIdOf("technician"));
    captured.length = 0;
    const res = await actors.call("PATCH", `/api/technician/work-orders/${workOrderId}/status`, {
      actor: "technician",
      body: { status: "in_progress" },
    });
    expect(res.status).toBe(200);
    expectClosed("work_order_updated");
    expect(framesFor("manager", "work_order_updated")[0].data.workOrder).toBeTruthy();
  });

  it("part_requirement_created : la demande (pièce, coût) ne part qu'au personnel hors chauffeur", async () => {
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    const workOrderId = await seedWorkOrder(vehicleA);
    captured.length = 0;
    const res = await actors.call("POST", "/api/part-requirements", {
      actor: "technician",
      body: { partId: part.id, workOrderId, quantityNeeded: 1, reason: "TEST portée" },
    });
    expect(res.status).toBe(201);
    requirementIds.push(res.body.id);
    expectClosed("part_requirement_created");
    expect(framesFor("warehouse", "part_requirement_created")).toHaveLength(1);
  });

  it("work_order_deleted : aucun client ne l'apprend, le personnel oui", async () => {
    const workOrderId = await seedWorkOrder(vehicleB);
    captured.length = 0;
    const res = await actors.call("DELETE", `/api/work-orders/${workOrderId}`, { actor: "manager" });
    expect([200, 204]).toContain(res.status);
    expect(framesFor("clientA")).toEqual([]);
    expect(framesFor("clientB")).toEqual([]);
    expect(framesFor("manager", "work_order_deleted")).toHaveLength(1);
    expect(captured.filter((frame) => frame.scope?.type === "broadcast")).toEqual([]);
  });

  it("work-order-items (POST) : la trame de ligne de travail ne part pas aux clients", async () => {
    const workOrderId = await seedWorkOrder(vehicleA, actors.userIdOf("technician"));
    captured.length = 0;
    const res = await actors.call("POST", `/api/work-orders/${workOrderId}/items`, {
      actor: "technician",
      body: { customLabel: "TEST ligne portée", estimatedHours: 1 },
    });
    expect(res.status).toBe(201);
    expectClosed("work_order_item_changed", true);
    expect(framesFor("manager", "work_order_item_changed")).toHaveLength(1);
  });

  it("awaiting-parts : l'OT mise à jour ne part pas aux clients, le personnel la reçoit", async () => {
    const workOrderId = await seedWorkOrder(vehicleA, actors.userIdOf("technician"));
    captured.length = 0;
    const res = await actors.call("POST", `/api/work-orders/${workOrderId}/awaiting-parts`, {
      actor: "technician",
      body: {},
    });
    expect(res.status).toBe(200);
    expectClosed("work_order_updated");
    expect(framesFor("manager", "work_order_updated")[0].data.workOrder).toBeTruthy();
  });

  it("incident-service : l'OT ouverte par une panne n'est reçue par aucun client", async () => {
    captured.length = 0;
    const incident = await createIncident(
      { id: actors.userIdOf("admin"), role: "admin" } as any,
      { vehicleId: vehicleA, description: uniqueTestToken("panne"), severity: "medium" } as any,
      {
        db,
        assignedVehicleIds: async () => [],
        notifyRoles: async () => {},
        broadcast: (event, data) => captured.push({ eventType: event, scope: data.scope as Scope, data }),
      },
      { openWorkOrder: true },
    );
    expect(incident.workOrderId).toBeTruthy();
    expectClosed("work_order_created");
    expect(framesFor("manager", "work_order_created")[0].data.workOrder).toBeTruthy();
  });

  it("préventif : l'OT générée n'est reçue par aucun client", async () => {
    const [schedule] = await db
      .insert(maintenanceSchedules)
      .values({
        vehicleId: vehicleA,
        title: uniqueTestToken("Vidange"),
        frequency: "monthly",
        frequencyValue: 1,
        scheduledDate: new Date().toISOString().slice(0, 10),
      })
      .returning();
    scheduleIds.push(schedule.id);
    captured.length = 0;
    const order = await preventiveMaintenanceService.generateWorkOrderFromSchedule(schedule);
    workOrderIds.push(order.id);
    expectClosed("work_order_created");
    expect(framesFor("manager", "work_order_created")[0].data.workOrder).toBeTruthy();
  });

  it("procurement : part_received et parts_delivered (identifiants d'OT) restent au personnel", async () => {
    const part = await createTestPart({ quantity: 5 });
    ids.partIds.push(part.id);
    partNames.push(part.name);
    const workOrderId = await seedWorkOrder(vehicleA, actors.userIdOf("technician"), "awaiting_parts");
    const [requirement] = await db
      .insert(partRequirements)
      .values({ partId: part.id, workOrderId, quantityNeeded: 1, reason: "TEST portée", status: "ordered" })
      .returning();
    requirementIds.push(requirement.id);

    captured.length = 0;
    await (procurementService as any).notifyPartReceived(0, part.id, 2);
    expectClosed("part_received", true);
    expect(framesFor("manager", "part_received")).toHaveLength(1);

    const supplier = await createTestSupplier();
    ids.supplierIds.push(supplier.id);
    const [order] = await db
      .insert(purchaseOrders)
      .values({ orderNumber: uniqueTestToken("PO"), supplierId: supplier.id, orderDate: new Date().toISOString().slice(0, 10) })
      .returning();
    purchaseOrderIds.push(order.id);
    await db.insert(purchaseOrderLines).values({
      purchaseOrderId: order.id,
      partId: part.id,
      quantityOrdered: 2,
      quantityReceived: 2,
      deliveryStatus: "delivered",
      unitPrice: "10.00",
      totalPrice: "20.00",
    } as any);
    captured.length = 0;
    await (procurementService as any).notifyDeliveryReceived(order.id);
    expectClosed("parts_delivered", true);
    expect(framesFor("manager", "parts_delivered")).toHaveLength(1);
  });
});

describe("Pont LISTEN/NOTIFY : trames d'ordre de travail et trame réduite au propriétaire (§11)", { timeout: 120000 }, () => {
  const relay = async (message: Record<string, unknown>, readOwnerId?: (vehicleId: number) => Promise<number | null>) => {
    captured.length = 0;
    await relayDatabaseEvent(message as any, {
      broadcast: (event, data) => captured.push({ eventType: event, scope: data.scope as Scope, data }),
      inferEntity: () => "work_order",
      readOwnerId,
    });
  };

  it("work_order_status_changed : personnel hors chauffeur seulement, jamais un client", async () => {
    await relay({ eventType: "work_order_status_changed", payload: { workOrderId: 1, vehicleId: vehicleA, status: "in_progress" } });
    expect(captured).toHaveLength(1);
    expectClosed("work_order_status_changed");
    expect(framesFor("manager", "work_order_status_changed")).toHaveLength(1);
  });

  it("vehicle_status_changed : le personnel reçoit la trame entière, le propriétaire A seul la trame réduite", async () => {
    await relay({ eventType: "vehicle_status_changed", payload: { vehicleId: vehicleA, status: "maintenance", workOrderId: 9, title: "TEST" } });
    expect(captured.filter((frame) => frame.scope?.type === "broadcast")).toEqual([]);
    expect(framesFor("manager", "vehicle_status_changed")).toHaveLength(1);
    expect(framesFor("clientB")).toEqual([]);
    const owned = framesFor("clientA", "vehicle_status_changed");
    expect(owned).toHaveLength(1);
    expect(owned[0].data.payload).toEqual({ vehicleId: vehicleA, status: "maintenance" });
    expect(owned[0].data.actor).toBeNull();
    expect(owned[0].scope).toEqual({ type: "user", userIds: [actors.userIdOf("clientA")] });
  });

  it("vehicle_status_changed du véhicule de B : A ne reçoit rien, B reçoit la trame réduite", async () => {
    await relay({ eventType: "vehicle_status_changed", payload: { vehicleId: vehicleB, status: "active" } });
    expect(framesFor("clientA")).toEqual([]);
    expect(framesFor("clientB", "vehicle_status_changed")).toHaveLength(1);
  });

  it("événement inconnu : rejeté, aucun envoi ; statut non texte : trame réduite avec status nul", async () => {
    await relay({ eventType: "alert_created", payload: { vehicleId: vehicleA } });
    expect(captured).toEqual([]);
    await relay({ eventType: "vehicle_status_changed", payload: { vehicleId: vehicleA, status: { x: 1 } } });
    expect(framesFor("clientA", "vehicle_status_changed")[0].data.payload).toEqual({ vehicleId: vehicleA, status: null });
  });

  it("propriétaire nul ou lecture en échec : rien pour les clients, aucune exception", async () => {
    await relay({ eventType: "vehicle_status_changed", payload: { vehicleId: vehicleA, status: "active" } }, async () => null);
    expect(framesFor("clientA")).toEqual([]);
    expect(framesFor("clientB")).toEqual([]);
    expect(framesFor("manager", "vehicle_status_changed")).toHaveLength(1);

    await expect(
      relay({ eventType: "vehicle_status_changed", payload: { vehicleId: vehicleA, status: "active" } }, async () => {
        throw new Error("échec simulé");
      }),
    ).resolves.toBeUndefined();
    expect(framesFor("clientA")).toEqual([]);
    expect(framesFor("manager", "vehicle_status_changed")).toHaveLength(1);
  });
});
