import { createServer, type Server } from "http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TIME_TRACKING_MONTHLY_STATS_PATH,
  TIME_TRACKING_PATH,
  timeTrackingMonthlyStatsResponseSchema,
  timeTrackingResponseSchema,
} from "../../shared/contracts/time-tracking";
import { drivers, timeTracking } from "../../shared/schema";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";

/** Niveau C, T-45 : pointage (saisie rejouable, totaux calcules, evenement). */
process.env.FEATURE_FLAGS = "time-tracking=on";

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const events: { event: string; data: any }[] = [];
let personId = 0;
let inactiveDriverUserId = 0;
let inactiveDriverId = 0;

async function login(role: TestUserRole) {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  return user.id;
}
async function call(method: string, path: string, role?: string, body?: unknown) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(role ? { Cookie: cookies.get(role)! } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeAll(async () => {
  (global as any).broadcastUpdate = (event: string, data: unknown) => events.push({ event, data });
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  for (const role of ["logistics", "secretary", "management", "technician", "client"] as const) await login(role);
  personId = await login("driver");
  const inactive = await createTestUser({ role: "driver" });
  ids.userIds.push(inactive.id);
  inactiveDriverUserId = inactive.id;
  const [row] = await db
    .insert(drivers)
    .values({ userId: inactive.id, firstName: "TEST", lastName: "desactive", isActive: false })
    .returning({ id: drivers.id });
  inactiveDriverId = row.id;
}, 180000);
afterAll(async () => {
  if (personId) await db.delete(timeTracking).where(eq(timeTracking.userId, personId));
  if (inactiveDriverId) await db.delete(drivers).where(eq(drivers.id, inactiveDriverId));
  delete (global as any).broadcastUpdate;
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("/api/time-tracking", { timeout: 120000 }, () => {
  const MONTH = "?month=3&year=2031";

  it("refuse sans session, technicien et client ; secrétariat et direction lisent sans saisir ; la logistique lit", async () => {
    const body = { userId: 1, date: "2031-03-04", status: "JT" };
    expect((await call("GET", TIME_TRACKING_PATH + MONTH)).status).toBe(401);
    expect((await call("GET", TIME_TRACKING_PATH + MONTH, "technician")).status).toBe(403);
    expect((await call("PUT", TIME_TRACKING_PATH, "client", body)).status).toBe(403);
    expect((await call("PUT", TIME_TRACKING_PATH, "management", body)).status).toBe(403);
    expect((await call("GET", TIME_TRACKING_PATH + MONTH, "management")).status).toBe(200);
    expect((await call("PUT", TIME_TRACKING_PATH, "secretary", body)).status).toBe(403);
    expect((await call("GET", TIME_TRACKING_PATH + MONTH, "secretary")).status).toBe(200);
    expect((await call("GET", TIME_TRACKING_PATH + MONTH, "logistics")).status).toBe(200);
  });

  it("saisie rejouable : la seconde remplace la premiere, evenement emis, totaux calcules", async () => {
    const put1 = await call("PUT", TIME_TRACKING_PATH, "logistics", { userId: personId, date: "2031-03-04", status: "JT" });
    expect(put1.status).toBe(200);
    const put2 = await call("PUT", TIME_TRACKING_PATH, "logistics", { userId: personId, date: "2031-03-04", status: "M", notes: "certificat" });
    expect(put2.body).toMatchObject({ userId: personId, date: "2031-03-04", status: "M", notes: "certificat" });
    await call("PUT", TIME_TRACKING_PATH, "logistics", { userId: personId, date: "2031-03-05", status: "JT" });
    expect(events.filter((e) => e.event === "time_tracking_updated").length).toBe(3);
    expect(events[0].data).toMatchObject({ userId: personId, date: "2031-03-04", scope: { type: "roles" } });

    const list = await call("GET", `${TIME_TRACKING_PATH}${MONTH}&userId=${personId}`, "secretary");
    expect(list.status).toBe(200);
    expect(timeTrackingResponseSchema.safeParse(list.body).success).toBe(true);
    expect(list.body).toHaveLength(2);

    const stats = await call("GET", TIME_TRACKING_MONTHLY_STATS_PATH + MONTH, "management");
    expect(stats.status).toBe(200);
    expect(timeTrackingMonthlyStatsResponseSchema.safeParse(stats.body).success).toBe(true);
    const mine = (stats.body as { userId: number; counts: Record<string, number> }[]).find((s) => s.userId === personId);
    expect(mine?.counts).toMatchObject({ JT: 1, M: 1 });
  });

  it("valide code, date, mois et personne", async () => {
    expect((await call("PUT", TIME_TRACKING_PATH, "logistics", { userId: personId, date: "2031-03-04", status: "XX" })).status).toBe(400);
    expect((await call("PUT", TIME_TRACKING_PATH, "logistics", { userId: personId, date: "04/03/2031", status: "JT" })).status).toBe(400);
    expect((await call("PUT", TIME_TRACKING_PATH, "logistics", { userId: 999999999, date: "2031-03-04", status: "JT" })).status).toBe(404);
    expect((await call("GET", TIME_TRACKING_PATH + "?month=13&year=2031", "secretary")).status).toBe(400);
  });

  it("totaux : un chauffeur desactive (fiche drivers is_active = false) sans saisie n'apparait pas", async () => {
    const stats = await call("GET", TIME_TRACKING_MONTHLY_STATS_PATH + "?month=4&year=2031", "logistics");
    expect(stats.status).toBe(200);
    const rows = stats.body as { userId: number }[];
    expect(rows.some((s) => s.userId === personId)).toBe(true);
    expect(rows.some((s) => s.userId === inactiveDriverUserId)).toBe(false);
  });

  it("totaux : un chauffeur actif sans saisie du mois figure avec des compteurs a zero", async () => {
    const stats = await call("GET", TIME_TRACKING_MONTHLY_STATS_PATH + "?month=4&year=2031", "logistics");
    expect(stats.status).toBe(200);
    expect(timeTrackingMonthlyStatsResponseSchema.safeParse(stats.body).success).toBe(true);
    const rows = stats.body as { userId: number; counts: Record<string, number> }[];
    const mine = rows.find((s) => s.userId === personId);
    expect(mine).toBeDefined();
    expect(Object.values(mine!.counts).every((n) => n === 0)).toBe(true);
    expect(rows.filter((s) => s.userId === personId)).toHaveLength(1);
  });
});
