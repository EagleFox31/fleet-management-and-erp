import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { alerts, workOrders } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { waitForBlockedWriter } from "../support/row-lock";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/**
 * `PATCH /api/work-orders/:id` (fiche OT, tableau, modale d'édition) : seules
 * les transitions de statut prévues passent. Un OT terminé ne revient en cours
 * que par le contrôle qualité ; un OT annulé ne se rouvre pas. Le technicien
 * n'a que ses gestes (démarrer, terminer, reprendre) ; annuler ou remettre en
 * attente revient au chef d'atelier. Refus : rien n'est écrit. Garder le même
 * statut (modale d'édition) reste permis. Écrit en base ; tout est supprimé.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const workOrderIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
const sessions = new Map<TestUserRole, { id: number; cookie: string }>();

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function session(role: TestUserRole) {
  const existing = sessions.get(role);
  if (existing) return existing;
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(baseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  const created = { id: user.id, cookie: res.headers.get("set-cookie")!.split(";")[0] };
  sessions.set(role, created);
  return created;
}

let vehicleId = 0;
async function workOrderIn(status: (typeof workOrders.$inferSelect)["status"], technicianId: number | null = null) {
  if (!vehicleId) {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    vehicleId = vehicle.id;
  }
  const [row] = await db
    .insert(workOrders)
    .values({ vehicleId, title: "TEST transitions OT", status, technicianId })
    .returning();
  workOrderIds.push(row.id);
  return row;
}

async function statusOf(id: number) {
  const [row] = await db.select({ status: workOrders.status, title: workOrders.title }).from(workOrders).where(eq(workOrders.id, id));
  return row;
}

beforeAll(async () => {
  (global as any).broadcastUpdate = () => {};
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (workOrderIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("PATCH /api/work-orders/:id : transitions de statut", { timeout: 120000 }, () => {
  it("chef d'atelier : un OT terminé ne revient pas en cours ici (409), rien n'est écrit", async () => {
    const chef = await session("workshop_manager");
    const wo = await workOrderIn("completed");

    for (const status of ["in_progress", "pending", "awaiting_parts"]) {
      const res = await call("PATCH", `/api/work-orders/${wo.id}`, {
        cookie: chef.cookie,
        body: { status, title: "TEST modifié" },
      });
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/contrôle qualité/);
    }
    expect(await statusOf(wo.id)).toEqual({ status: "completed", title: "TEST transitions OT" });
  });

  it("chef d'atelier : un OT annulé ne se rouvre pas (409)", async () => {
    const chef = await session("workshop_manager");
    const wo = await workOrderIn("cancelled");

    const res = await call("PATCH", `/api/work-orders/${wo.id}`, { cookie: chef.cookie, body: { status: "pending" } });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/annulé/);
    expect((await statusOf(wo.id)).status).toBe("cancelled");
  });

  it("chef d'atelier : transitions prévues acceptées, même statut permis (modale d'édition)", async () => {
    const chef = await session("workshop_manager");
    const wo = await workOrderIn("pending");

    for (const status of ["in_progress", "awaiting_parts", "in_progress", "completed"]) {
      const res = await call("PATCH", `/api/work-orders/${wo.id}`, { cookie: chef.cookie, body: { status } });
      expect(res.status, status).toBe(200);
      expect((await statusOf(wo.id)).status).toBe(status);
    }

    // Modale d'édition sur un OT terminé : statut inchangé, titre modifié.
    const same = await call("PATCH", `/api/work-orders/${wo.id}`, {
      cookie: chef.cookie,
      body: { status: "completed", title: "TEST titre corrigé" },
    });
    expect(same.status).toBe(200);
    expect(await statusOf(wo.id)).toEqual({ status: "completed", title: "TEST titre corrigé" });

    const toCancel = await workOrderIn("in_progress");
    const cancel = await call("PATCH", `/api/work-orders/${toCancel.id}`, { cookie: chef.cookie, body: { status: "cancelled" } });
    expect(cancel.status).toBe(200);
  });

  it("technicien : démarrer et terminer oui ; annuler ou remettre en attente non (403)", async () => {
    const tech = await session("technician");
    const wo = await workOrderIn("pending", tech.id);

    const start = await call("PATCH", `/api/work-orders/${wo.id}`, { cookie: tech.cookie, body: { status: "in_progress" } });
    expect(start.status).toBe(200);

    for (const status of ["cancelled", "pending"]) {
      const res = await call("PATCH", `/api/work-orders/${wo.id}`, { cookie: tech.cookie, body: { status } });
      expect(res.status, status).toBe(403);
      expect(res.body.message).toMatch(/chef d'atelier/);
    }
    expect((await statusOf(wo.id)).status).toBe("in_progress");

    const done = await call("PATCH", `/api/work-orders/${wo.id}`, { cookie: tech.cookie, body: { status: "completed" } });
    expect(done.status).toBe(200);

    const back = await call("PATCH", `/api/work-orders/${wo.id}`, { cookie: tech.cookie, body: { status: "in_progress" } });
    expect(back.status).toBe(409);
    expect((await statusOf(wo.id)).status).toBe("completed");
  });

  // La route lit l'OT, vérifie la transition, puis écrit : un OT annulé entre les deux ne doit pas
  // être écrasé. Déterministe : une connexion tient le verrou de ligne, la requête s'y bloque après
  // sa lecture, l'OT est annulé, puis le verrou est libéré.
  it("OT annulé pendant la modification : 409 lisible, ni statut ni autres champs écrits", async () => {
    const chef = await session("workshop_manager");
    const wo = await workOrderIn("in_progress");
    const client = await pool.connect();
    let res: Awaited<ReturnType<typeof call>>;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM work_orders WHERE id = $1 FOR UPDATE", [wo.id]);
      const holderPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const pending = call("PATCH", `/api/work-orders/${wo.id}`, {
        cookie: chef.cookie,
        body: { status: "completed", title: "TEST écrit trop tard" },
      });
      await waitForBlockedWriter(holderPid, "l'OT");
      await client.query("UPDATE work_orders SET status = 'cancelled' WHERE id = $1", [wo.id]);
      await client.query("COMMIT");
      res = await pending;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toContain("vient de changer");
    expect(await statusOf(wo.id)).toEqual({ status: "cancelled", title: "TEST transitions OT" });
  });

  it("statut inconnu : 400 lisible", async () => {
    const chef = await session("workshop_manager");
    const wo = await workOrderIn("pending");

    const res = await call("PATCH", `/api/work-orders/${wo.id}`, { cookie: chef.cookie, body: { status: "n_importe_quoi" } });
    expect(res.status).toBe(400);
    expect((await statusOf(wo.id)).status).toBe("pending");
  });
});
