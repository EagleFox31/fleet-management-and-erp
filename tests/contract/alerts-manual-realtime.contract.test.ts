import { createServer, type Server } from "http";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { alerts } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Couche 2 des alertes créées par `server/routes.ts` (AGENTS.md §2 et §3).
 * - POST /api/alerts (chef d'atelier) : trame `alert_created` nominative vers le destinataire.
 * - POST /api/test-date-maintenance (demande documentaire) : une trame par alerte créée,
 *   chacune vers son seul destinataire.
 * Avant : alertes écrites en base sans trame, la cloche attendait le polling.
 */

type Frame = { eventType: string; data: any };

let server: Server;
let baseUrl = "";
let managerCookie = "";
let adminCookie = "";
let technicianId = 0;
const ids = createIdBag();
const frames: Frame[] = [];
const alertIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;

async function login(username: string) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

async function post(path: string, cookie: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const alertFrames = () => frames.filter((f) => f.eventType === "alert_created");

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: unknown) => frames.push({ eventType, data }));
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const manager = await createTestUser({ role: "workshop_manager" });
  const admin = await createTestUser({ role: "admin" });
  const technician = await createTestUser({ role: "technician" });
  ids.userIds.push(manager.id, admin.id, technician.id);
  technicianId = technician.id;
  managerCookie = await login(manager.username);
  adminCookie = await login(admin.username);
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (alertIds.length > 0) await db.delete(alerts).where(inArray(alerts.id, alertIds));
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("Alertes de routes.ts : trame alert_created", { timeout: 120000 }, () => {
  it("POST /api/alerts -> une trame nominative vers le destinataire, charge à plat", async () => {
    frames.length = 0;
    const title = uniqueTestToken("alerte-manuelle");
    const res = await post("/api/alerts", managerCookie, {
      userId: technicianId,
      title,
      message: "TEST alerte manuelle",
      type: "maintenance",
      priority: "high",
      link: "/work-orders",
    });
    expect(res.status).toBe(201);
    alertIds.push(res.body.id);

    const sent = alertFrames().filter((f) => f.data.entityId === res.body.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].data.scope).toEqual({ type: "user", userIds: [technicianId] });
    expect(sent[0].data.payload).toMatchObject({ alertId: res.body.id, title, priority: "high", link: "/work-orders" });
  });

  it("POST /api/test-date-maintenance (assurance) -> une trame par alerte créée, chacune nominative", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    frames.length = 0;
    const res = await post("/api/test-date-maintenance", adminCookie, { vehicleId: vehicle.id, alertType: "insurance" });
    expect(res.status).toBe(200);

    const created = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.link, `/vehicles/${vehicle.id}`), eq(alerts.title, "Demande renouvellement assurance")));
    alertIds.push(...created.map((a) => a.id));
    expect(created.length).toBeGreaterThan(0);

    const sent = alertFrames();
    expect(sent.map((f) => f.data.entityId).sort()).toEqual(created.map((a) => a.id).sort());
    for (const alert of created) {
      const frame = sent.find((f) => f.data.entityId === alert.id)!;
      expect(frame.data.scope).toEqual({ type: "user", userIds: [alert.userId] });
    }
  });
});
