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
 * `PATCH /api/work-orders/:id` : colonnes écrites selon le rôle (`server/lib/work-order-patch-policy.ts`).
 * - admin et chef d'atelier : contenu, planning, affectation ; jamais id, auteur, dates de
 *   création, coût ni véhicule (403, rien n'est écrit) ;
 * - technicien : statut et dates, sur un OT qui lui est assigné, sans toucher à l'affectation ;
 * - `updatedBy` est toujours l'auteur de la requête.
 * Écrit en base ; tout est supprimé.
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
let otherVehicleId = 0;
let creatorId = 0;
async function workOrderIn(status: (typeof workOrders.$inferSelect)["status"], technicianId: number | null = null) {
  if (!vehicleId) {
    for (const target of ["main", "other"] as const) {
      const vehicle = await createTestVehicle();
      ids.vehicleIds.push(vehicle.id);
      if (target === "main") vehicleId = vehicle.id;
      else otherVehicleId = vehicle.id;
    }
    const creator = await createTestUser({ role: "workshop_manager" });
    ids.userIds.push(creator.id);
    creatorId = creator.id;
  }
  const [row] = await db
    .insert(workOrders)
    .values({
      vehicleId,
      title: "TEST colonnes OT",
      status,
      technicianId,
      cost: "100.00",
      createdBy: creatorId,
      updatedBy: creatorId,
      vehicleRegistration: "TEST-REG",
    })
    .returning();
  workOrderIds.push(row.id);
  return row;
}

async function rowOf(id: number) {
  const [row] = await db.select().from(workOrders).where(eq(workOrders.id, id));
  return row;
}

/** Colonnes que la politique protège : identiques avant et après un refus. */
function protectedColumns(row: typeof workOrders.$inferSelect) {
  return {
    id: row.id,
    vehicleId: row.vehicleId,
    vehicleRegistration: row.vehicleRegistration,
    technicianId: row.technicianId,
    title: row.title,
    status: row.status,
    cost: row.cost,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedBy: row.updatedBy,
    startDate: row.startDate?.toISOString() ?? null,
  };
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

const SERVER_OWNED: Array<[string, () => unknown]> = [
  ["id", () => 999999],
  ["createdBy", () => sessions.get("admin")?.id ?? 1],
  ["createdAt", () => "2020-01-01T00:00:00.000Z"],
  ["updatedBy", () => creatorId],
  ["updatedAt", () => "2020-01-01T00:00:00.000Z"],
  ["cost", () => "1.00"],
  ["vehicleId", () => otherVehicleId],
  ["champInconnu", () => "x"],
];

describe("PATCH /api/work-orders/:id : colonnes par rôle", { timeout: 120000 }, () => {
  for (const role of ["admin", "workshop_manager"] as const) {
    it(`${role} : colonnes tenues par le serveur refusées (403), rien n'est écrit`, async () => {
      const actor = await session(role);
      const wo = await workOrderIn("pending");
      const before = protectedColumns(await rowOf(wo.id));
      for (const [field, value] of SERVER_OWNED) {
        const res = await call("PATCH", `/api/work-orders/${wo.id}`, {
          cookie: actor.cookie,
          body: { title: `TEST écrit avec ${field}`, [field]: value() },
        });
        expect(res.status, `${field} : ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.errors?.map((e: { field: string }) => e.field), field).toEqual([field]);
        expect(protectedColumns(await rowOf(wo.id)), field).toEqual(before);
      }
    });

    it(`${role} : contenu et affectation écrits, updatedBy = auteur`, async () => {
      const actor = await session(role);
      const technician = await session("technician");
      const wo = await workOrderIn("pending");
      const res = await call("PATCH", `/api/work-orders/${wo.id}`, {
        cookie: actor.cookie,
        body: { title: "TEST titre modifié", priority: "high", technicianId: technician.id },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const after = await rowOf(wo.id);
      expect(after).toMatchObject({ title: "TEST titre modifié", priority: "high", technicianId: technician.id });
      expect(after.updatedBy).toBe(actor.id);
      expect(after.createdBy).toBe(creatorId);
    });
  }

  it("formulaire d'édition : véhicule inchangé et copies du véhicule ignorés, le reste écrit", async () => {
    const chef = await session("workshop_manager");
    const wo = await workOrderIn("pending");
    const res = await call("PATCH", `/api/work-orders/${wo.id}`, {
      cookie: chef.cookie,
      body: {
        vehicleId: String(vehicleId),
        vehicleRegistration: "AUTRE-REG",
        vehicleBrand: "Autre",
        vehicleModel: "Autre",
        title: "TEST formulaire",
        description: "TEST description",
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await rowOf(wo.id);
    expect(after).toMatchObject({
      vehicleId,
      vehicleRegistration: "TEST-REG",
      title: "TEST formulaire",
      description: "TEST description",
      updatedBy: chef.id,
    });
  });

  it("technicien : statut et dates sur son OT, updatedBy = lui", async () => {
    const tech = await session("technician");
    const wo = await workOrderIn("pending", tech.id);
    const startDate = "2031-05-04T08:00:00.000Z";
    const res = await call("PATCH", `/api/work-orders/${wo.id}`, {
      cookie: tech.cookie,
      body: { status: "in_progress", startDate },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await rowOf(wo.id);
    expect(after.status).toBe("in_progress");
    expect(after.startDate?.toISOString()).toBe(startDate);
    expect(after.updatedBy).toBe(tech.id);
    expect(after.technicianId).toBe(tech.id);
  });

  it("technicien : affectation, contenu et colonnes serveur refusés (403) sur son propre OT", async () => {
    const tech = await session("technician");
    const other = await createTestUser({ role: "technician" });
    ids.userIds.push(other.id);
    const wo = await workOrderIn("in_progress", tech.id);
    const before = protectedColumns(await rowOf(wo.id));
    const attempts: Array<[string, unknown]> = [
      ["technicianId", other.id],
      ["technicianId", tech.id],
      ["title", "TEST titre technicien"],
      ["priority", "critical"],
      ["cost", "1.00"],
      ["vehicleId", otherVehicleId],
      ["updatedBy", creatorId],
    ];
    for (const [field, value] of attempts) {
      const res = await call("PATCH", `/api/work-orders/${wo.id}`, {
        cookie: tech.cookie,
        body: { status: "completed", [field]: value },
      });
      expect(res.status, `${field} : ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.errors?.map((e: { field: string }) => e.field), field).toEqual([field]);
      expect(protectedColumns(await rowOf(wo.id)), field).toEqual(before);
    }
    expect((await rowOf(wo.id)).priority).toBe("medium");
  });

  it("technicien : OT non assigné ou assigné à un autre refusé (403), rien n'est écrit", async () => {
    const tech = await session("technician");
    const other = await createTestUser({ role: "technician" });
    ids.userIds.push(other.id);
    for (const assignee of [null, other.id]) {
      const wo = await workOrderIn("pending", assignee);
      const before = protectedColumns(await rowOf(wo.id));
      const res = await call("PATCH", `/api/work-orders/${wo.id}`, {
        cookie: tech.cookie,
        body: { status: "in_progress" },
      });
      expect(res.status, `${assignee} : ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.message).toMatch(/pas assigné/);
      expect(protectedColumns(await rowOf(wo.id))).toEqual(before);
    }
  });

  it("rôle hors atelier : 403, rien n'est écrit", async () => {
    const magasin = await session("warehouse");
    const wo = await workOrderIn("pending");
    const before = protectedColumns(await rowOf(wo.id));
    const res = await call("PATCH", `/api/work-orders/${wo.id}`, { cookie: magasin.cookie, body: { title: "TEST magasin" } });
    expect(res.status).toBe(403);
    expect(protectedColumns(await rowOf(wo.id))).toEqual(before);
  });

  // L'affectation est lue avant l'écriture : un OT réassigné entre les deux ne doit pas être
  // modifié par l'ancien technicien. Verrou de ligne, réassignation, puis libération.
  it("technicien : OT réassigné pendant la requête, 409 lisible, rien n'est écrit", async () => {
    const tech = await session("technician");
    const other = await createTestUser({ role: "technician" });
    ids.userIds.push(other.id);
    const wo = await workOrderIn("in_progress", tech.id);
    const client = await pool.connect();
    let res: Awaited<ReturnType<typeof call>>;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM work_orders WHERE id = $1 FOR UPDATE", [wo.id]);
      const holderPid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      const pending = call("PATCH", `/api/work-orders/${wo.id}`, {
        cookie: tech.cookie,
        body: { status: "completed", endDate: "2031-05-04T10:00:00.000Z" },
      });
      await waitForBlockedWriter(holderPid, "l'OT");
      await client.query("UPDATE work_orders SET technician_id = $2 WHERE id = $1", [wo.id, other.id]);
      await client.query("COMMIT");
      res = await pending;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.message).toMatch(/réassigné/);
    const after = await rowOf(wo.id);
    expect(after.status).toBe("in_progress");
    expect(after.endDate).toBeNull();
    expect(after.technicianId).toBe(other.id);
  });
});
