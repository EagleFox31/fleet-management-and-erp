import { createServer, type Server } from "http";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { missions, tariffGrid } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestClient, createTestUser, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/** O3 lot 3 : prix convenu d'une mission, enregistré seulement s'il est envoyé ; tarif d'origine tracé. */
let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<string, string>();
const missionIds: number[] = [];
let tariffId = 0;
const origin = uniqueTestToken("orig");

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
  return user;
}
async function post(role: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies.get(role)! },
    body: JSON.stringify({
      orderNumber: uniqueTestToken("MIS"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      status: "planned",
      ...body,
    }),
  });
  const json = await res.json().catch(() => null);
  if (json?.id) missionIds.push(json.id);
  return { status: res.status, body: json };
}

beforeAll(async () => {
  process.env.FEATURE_FLAGS = "pricing=on";
  server = createServer(await getContractApp());
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const admin = await login("admin");
  await login("logistics");
  await login("technician");
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  const [t] = await db
    .insert(tariffGrid)
    .values({ origin, destination: "x", pricingUnit: "ton", unitPrice: "100", validFrom: "2026-01-01", createdBy: admin.id, updatedBy: admin.id })
    .returning();
  tariffId = t.id;
}, 180000);
afterAll(async () => {
  if (missionIds.length > 0) await db.delete(missions).where(inArray(missions.id, missionIds));
  await db.delete(tariffGrid).where(eq(tariffGrid.origin, origin));
  await cleanupCreated(ids);
  await new Promise<void>((r) => server.close(() => r()));
});

describe("prix convenu d'une mission", { timeout: 120000 }, () => {
  it("sans prix : la mission se crée comme avant, colonnes à NULL (jamais de prix appliqué seul)", async () => {
    const res = await post("logistics", {});
    expect(res.status).toBe(201);
    const [row] = await db.select().from(missions).where(eq(missions.id, res.body.id));
    expect(row.agreedPrice).toBeNull();
    expect(row.tariffGridId).toBeNull();
  });

  it("prix saisi avec son tarif d'origine : enregistré en XAF entier et tracé", async () => {
    const res = await post("admin", { agreedPrice: 125000, tariffGridId: tariffId });
    expect(res.status).toBe(201);
    const [row] = await db.select().from(missions).where(eq(missions.id, res.body.id));
    expect(row.agreedPrice).toBe("125000");
    expect(row.tariffGridId).toBe(tariffId);
  });

  it("prix libre sans tarif : accepté ; prix décimal, négatif ou tarif sans prix : 400 ; tarif inconnu : 400", async () => {
    expect((await post("logistics", { agreedPrice: 90000 })).status).toBe(201);
    for (const bad of [{ agreedPrice: 10.5 }, { agreedPrice: -1 }, { agreedPrice: "abc" }, { tariffGridId: tariffId }, { agreedPrice: 1, tariffGridId: 2147483000 }]) {
      expect((await post("logistics", bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("rôle hors gestion des missions : 403 (rôles inchangés)", async () => {
    expect((await post("technician", { agreedPrice: 1 })).status).toBe(403);
  });

  it("tarif supprimé : la mission garde son prix, le lien passe à NULL", async () => {
    const [t] = await db
      .insert(tariffGrid)
      .values({ origin, destination: "y", pricingUnit: "trip", unitPrice: "5", validFrom: "2026-01-01" })
      .returning();
    const res = await post("admin", { agreedPrice: 5, tariffGridId: t.id });
    expect(res.status).toBe(201);
    await db.delete(tariffGrid).where(eq(tariffGrid.id, t.id));
    const [row] = await db.select().from(missions).where(eq(missions.id, res.body.id));
    expect(row.agreedPrice).toBe("5");
    expect(row.tariffGridId).toBeNull();
  });
});
