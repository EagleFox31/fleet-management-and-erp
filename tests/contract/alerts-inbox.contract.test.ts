import { createServer, type Server } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { alerts } from "../../shared/schema";
import { ALERT_READ_ALL_PATH, alertPath } from "../../shared/contracts/alerts";
import { REALTIME_EVENTS } from "../../shared/contracts/realtime-events";
import { db } from "../../server/db";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, TEST_USER_PASSWORD } from "../support/factories";

/**
 * ALR2 : marquer lu / tout marquer lu, compteur, et cloison entre comptes.
 * Avant ce lot, PATCH /:id/read et DELETE /:id ne vérifiaient pas le propriétaire.
 */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies: Record<"owner" | "other", string> = { owner: "", other: "" };
let ownerId = 0;
let otherId = 0;
const spy = vi.fn();
const previous = (global as any).broadcastUpdate;

async function call(who: "owner" | "other" | null, method: string, path: string) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: { ...(who ? { Cookie: cookies[who] } : {}), "Content-Type": "application/json" },
    body: method === "GET" || method === "DELETE" ? undefined : "{}",
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function seed(userId: number, count: number): Promise<number[]> {
  const rows = await db
    .insert(alerts)
    .values(
      Array.from({ length: count }, (_, i) => ({
        userId,
        title: `TEST alerte ${i}`,
        message: "TEST boîte d'alertes",
        type: "maintenance" as const,
        priority: "medium" as const,
      })),
    )
    .returning({ id: alerts.id });
  return rows.map((row) => row.id);
}

async function unreadCount(who: "owner" | "other"): Promise<number> {
  const res = await call(who, "GET", "/api/alerts/count");
  expect(res.status).toBe(200);
  return res.body.unread;
}

async function login(role: "admin" | "technician") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
  });
  return { id: user.id, cookie: res.headers.get("set-cookie")!.split(";")[0] };
}

beforeAll(async () => {
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const owner = await login("technician");
  const other = await login("admin");
  [ownerId, cookies.owner, otherId, cookies.other] = [owner.id, owner.cookie, other.id, other.cookie];
  (global as any).broadcastUpdate = spy;
}, 120000);

beforeEach(async () => {
  spy.mockClear();
  await db.delete(alerts).where(inArray(alerts.userId, [ownerId, otherId]));
});

afterAll(async () => {
  (global as any).broadcastUpdate = previous;
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("ALR2 boîte d'alertes", { timeout: 120000 }, () => {
  it("marquer lu : compteur décrémenté, rejeu sans effet, événement nominatif", async () => {
    const [first] = await seed(ownerId, 2);
    expect(await unreadCount("owner")).toBe(2);

    const res = await call("owner", "PATCH", `${alertPath(first)}/read`);
    expect(res.status).toBe(200);
    expect(res.body.isRead).toBe(true);
    expect(await unreadCount("owner")).toBe(1);

    expect((await call("owner", "PATCH", `${alertPath(first)}/read`)).status).toBe(200);
    expect(await unreadCount("owner")).toBe(1);

    const [event, data] = spy.mock.calls.find(([name]) => name === "alerts_read")!;
    expect(event).toBe("alerts_read");
    expect(data.payload).toEqual({ alertIds: [first] });
    expect(data.scope).toEqual({ type: "user", userIds: [ownerId] });
  });

  it("tout marquer lu : seul le compte appelant, autre compte intact, second appel = 0, pas d'événement vide", async () => {
    await seed(ownerId, 3);
    await seed(otherId, 2);

    const res = await call("owner", "POST", ALERT_READ_ALL_PATH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 3 });
    expect(await unreadCount("owner")).toBe(0);
    expect(await unreadCount("other")).toBe(2);

    const readEvents = () => spy.mock.calls.filter(([name]) => name === "alerts_read");
    expect(readEvents()).toHaveLength(1);
    expect(readEvents()[0][1].payload.alertIds).toHaveLength(3);
    expect(readEvents()[0][1].scope).toEqual({ type: "user", userIds: [ownerId] });

    const again = await call("owner", "POST", ALERT_READ_ALL_PATH);
    expect(again.body).toEqual({ updated: 0 });
    expect(readEvents()).toHaveLength(1);
  });

  it("alerte d'un autre compte : 404 en lecture comme en suppression, rien ne change", async () => {
    const [foreign] = await seed(otherId, 1);

    const read = await call("owner", "PATCH", `${alertPath(foreign)}/read`);
    expect(read.status).toBe(404);
    expect(read.body.message).toBe("Alerte introuvable.");
    expect((await call("owner", "DELETE", alertPath(foreign))).status).toBe(404);

    const [row] = await db.select().from(alerts).where(eq(alerts.id, foreign));
    expect(row.isRead).toBe(false);
    expect(spy.mock.calls.filter(([name]) => name === "alerts_read")).toHaveLength(0);
  });

  it("suppression de sa propre alerte : 204, compteur à jour, seconde suppression 404", async () => {
    const [mine] = await seed(ownerId, 1);
    expect((await call("owner", "DELETE", alertPath(mine))).status).toBe(204);
    expect(await unreadCount("owner")).toBe(0);
    expect((await call("owner", "DELETE", alertPath(mine))).status).toBe(404);
  });

  it("identifiant invalide 400, sans session 401", async () => {
    expect((await call("owner", "PATCH", `${alertPath("abc")}/read`)).status).toBe(400);
    expect((await call(null, "POST", ALERT_READ_ALL_PATH)).status).toBe(401);
  });

  it("l'événement est déclaré au contrat, portée nominative", () => {
    expect(REALTIME_EVENTS.alerts_read.scope).toBe("user");
    expect(REALTIME_EVENTS.alerts_read.invalidates).toContain("/api/alerts/count");
  });
});
