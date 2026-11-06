import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { WORK_ORDER_ASSIGNEE_ERROR } from "../../server/services/work-order-assignee";
import { users, workOrderItems, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Lignes de travail d'un OT: deux techniciens, des heures, aucun montant.
 * Écrit en base; tout ce qui est créé est supprimé.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];

async function call(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string } = {},
) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

async function login(username: string): Promise<string> {
  const res = await call("POST", "/api/auth/login", {
    body: { username, password: TEST_USER_PASSWORD },
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  // Les lignes partent avec l'OT (cascade), mais on ne compte pas dessus.
  if (workOrderIds.length > 0) {
    await db.delete(workOrderItems).where(inArray(workOrderItems.workOrderId, workOrderIds));
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

// Trois comptes, véhicule, OT, trois sessions puis une dizaine d'appels: nombreux allers-retours Neon.
describe("lignes de travail d'un OT", { timeout: 180000 }, () => {
  it("saisit, totalise, garde les droits et ne touche pas au coût", async () => {
    const manager = await createTestUser({ role: "workshop_manager" });
    const techA = await createTestUser({ role: "technician" });
    const techB = await createTestUser({ role: "technician" });
    ids.userIds.push(manager.id, techA.id, techB.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const [workOrder] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST travaux OT", status: "in_progress", technicianId: techA.id })
      .returning();
    workOrderIds.push(workOrder.id);
    const [managerCookie, cookieA, cookieB] = await Promise.all([
      login(manager.username),
      login(techA.username),
      login(techB.username),
    ]);

    // Une ligne sans libellé ni poste catalogue est illisible: refusée.
    const invalid = await call("POST", `/api/work-orders/${workOrder.id}/items`, {
      cookie: managerCookie,
      body: { customLabel: "  ", actualHours: "1" },
    });
    expect(invalid.status).toBe(400);
    expect(typeof invalid.body?.message).toBe("string");

    const first = await call("POST", `/api/work-orders/${workOrder.id}/items`, {
      cookie: managerCookie,
      body: { customLabel: "Vidange moteur", technicianId: techA.id, actualHours: "1.5", status: "done" },
    });
    expect(first.status).toBe(201);

    // Seconde ligne, autre technicien, pas encore mesurée.
    const second = await call("POST", `/api/work-orders/${workOrder.id}/items`, {
      cookie: managerCookie,
      body: { customLabel: "Contrôle freins", technicianId: techB.id, estimatedHours: 2, status: "pending" },
    });
    expect(second.status).toBe(201);
    expect(second.body.items).toHaveLength(2);
    // Une ligne sans heures réelles est exclue du total, pas comptée à zéro.
    expect(second.body.totals.actualHours).toBe(1.5);
    expect(second.body.totals.unmeasuredLineCount).toBe(1);

    // Le technicien B n'est pas celui de l'OT.
    const refused = await call("POST", `/api/work-orders/${workOrder.id}/items`, {
      cookie: cookieB,
      body: { customLabel: "Tentative", actualHours: 1 },
    });
    expect(refused.status).toBe(403);

    const list = await call("GET", `/api/work-orders/${workOrder.id}/items`, { cookie: cookieA });
    expect(list.status).toBe(200);
    const freins = list.body.items.find((item: { label: string }) => item.label === "Contrôle freins");
    expect(freins.technicianName).toBeTruthy();

    const patched = await call("PATCH", `/api/work-order-items/${freins.id}`, {
      cookie: cookieA,
      body: { actualHours: 2.5, status: "done" },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.workOrderId).toBe(workOrder.id);
    expect(patched.body.totals.actualHours).toBe(4);
    expect(patched.body.totals.unmeasuredLineCount).toBe(0);

    const removed = await call("DELETE", `/api/work-order-items/${freins.id}`, { cookie: managerCookie });
    expect(removed.status).toBe(200);
    expect(removed.body.items).toHaveLength(1);

    // Des heures, jamais un montant: le coût de l'OT reste intact.
    const [after] = await db.select().from(workOrders).where(eq(workOrders.id, workOrder.id));
    expect(after.cost).toEqual(workOrder.cost);
  });
  it("refuse toute écriture sur un OT clos et un technicien ou un poste inconnu", async () => {
    const manager = await createTestUser({ role: "workshop_manager" });
    ids.userIds.push(manager.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const [open, completed, cancelled] = await db
      .insert(workOrders)
      .values([
        { vehicleId: vehicle.id, title: "TEST lignes OT ouvert", status: "in_progress" },
        { vehicleId: vehicle.id, title: "TEST lignes OT terminé", status: "in_progress" },
        { vehicleId: vehicle.id, title: "TEST lignes OT annulé", status: "in_progress" },
      ])
      .returning();
    workOrderIds.push(open.id, completed.id, cancelled.id);
    const cookie = await login(manager.username);

    // Lignes posées tant que l'OT est ouvert, puis l'OT est clos.
    const ligne: Record<number, number> = {};
    for (const wo of [completed, cancelled]) {
      const created = await call("POST", `/api/work-orders/${wo.id}/items`, {
        cookie,
        body: { customLabel: "Ligne avant clôture", actualHours: 1, status: "done" },
      });
      expect(created.status).toBe(201);
      ligne[wo.id] = created.body.items[0].id;
    }
    await db.update(workOrders).set({ status: "completed" }).where(eq(workOrders.id, completed.id));
    await db.update(workOrders).set({ status: "cancelled" }).where(eq(workOrders.id, cancelled.id));

    for (const wo of [completed, cancelled]) {
      const add = await call("POST", `/api/work-orders/${wo.id}/items`, {
        cookie,
        body: { customLabel: "Ajout tardif", actualHours: 2 },
      });
      expect(add.status).toBe(409);
      expect(typeof add.body?.message).toBe("string");

      const patch = await call("PATCH", `/api/work-order-items/${ligne[wo.id]}`, {
        cookie,
        body: { actualHours: 9 },
      });
      expect(patch.status).toBe(409);

      const remove = await call("DELETE", `/api/work-order-items/${ligne[wo.id]}`, { cookie });
      expect(remove.status).toBe(409);
    }
    const [kept] = await db.select().from(workOrderItems).where(eq(workOrderItems.id, ligne[completed.id]));
    expect(Number(kept.actualHours)).toBe(1);

    // Technicien ou poste inexistant : 400 lisible, pas une erreur de clé étrangère en 500.
    const ghostTech = await call("POST", `/api/work-orders/${open.id}/items`, {
      cookie,
      body: { customLabel: "Fantôme", technicianId: 2147483000, actualHours: 1 },
    });
    expect(ghostTech.status).toBe(400);
    expect(ghostTech.body?.message).not.toMatch(/foreign key|violates|constraint/i);

    const ok = await call("POST", `/api/work-orders/${open.id}/items`, {
      cookie,
      body: { customLabel: "Ligne valide", actualHours: 1 },
    });
    expect(ok.status).toBe(201);
    const itemId = ok.body.items[0].id;

    const ghostTechPatch = await call("PATCH", `/api/work-order-items/${itemId}`, {
      cookie,
      body: { technicianId: 2147483000 },
    });
    expect(ghostTechPatch.status).toBe(400);

    const ghostPoste = await call("PATCH", `/api/work-order-items/${itemId}`, {
      cookie,
      body: { laborCatalogId: 2147483000 },
    });
    expect(ghostPoste.status).toBe(400);
    expect(ghostPoste.body?.message).not.toMatch(/foreign key|violates|constraint/i);
  });

  it("n'affecte une ligne qu'à un technicien ou un chef d'atelier actif (règle de l'OT)", async () => {
    const manager = await createTestUser({ role: "workshop_manager" });
    const driver = await createTestUser({ role: "driver" });
    const removed = await createTestUser({ role: "technician" });
    ids.userIds.push(manager.id, driver.id, removed.id);
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, removed.id));
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const [wo] = await db
      .insert(workOrders)
      .values({ vehicleId: vehicle.id, title: "TEST lignes affectation", status: "in_progress" })
      .returning();
    workOrderIds.push(wo.id);
    const cookie = await login(manager.username);

    for (const technicianId of [driver.id, removed.id]) {
      const add = await call("POST", `/api/work-orders/${wo.id}/items`, {
        cookie,
        body: { customLabel: "Affectation refusée", technicianId, actualHours: 1 },
      });
      expect(add.status).toBe(400);
      expect(add.body?.message).toBe(WORK_ORDER_ASSIGNEE_ERROR);
      expect(add.body?.errors).toContainEqual({ field: "technicianId", message: WORK_ORDER_ASSIGNEE_ERROR });
    }
    const lignes = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, wo.id));
    expect(lignes).toHaveLength(0);

    // Le chef d'atelier peut porter une ligne, comme il peut porter l'OT.
    const ok = await call("POST", `/api/work-orders/${wo.id}/items`, {
      cookie,
      body: { customLabel: "Ligne du chef", technicianId: manager.id, actualHours: 1 },
    });
    expect(ok.status).toBe(201);
    const itemId = ok.body.items[0].id;

    const patch = await call("PATCH", `/api/work-order-items/${itemId}`, {
      cookie,
      body: { technicianId: driver.id },
    });
    expect(patch.status).toBe(400);
    expect(patch.body?.errors).toContainEqual({ field: "technicianId", message: WORK_ORDER_ASSIGNEE_ERROR });
    const [kept] = await db.select().from(workOrderItems).where(eq(workOrderItems.id, itemId));
    expect(kept.technicianId).toBe(manager.id);

    // Désaffecter reste possible.
    const unassign = await call("PATCH", `/api/work-order-items/${itemId}`, { cookie, body: { technicianId: null } });
    expect(unassign.status).toBe(200);
  });
});
