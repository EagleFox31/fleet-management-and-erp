import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Prix convenu d'une mission : réservé à ceux qui lisent la grille tarifaire. Les routes qui renvoient
 * la ligne entière de `missions` (operations, PUT status) ne le montrent ni au magasinier ni au chauffeur.
 */
const ACTORS = { admin: "admin", warehouse: "warehouse", driver: "driver" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);
let mission: { id: number };
let upcoming: { id: number };
let driverRowId = 0;
let vehicleRowId = 0;

const rowOf = (body: unknown, id: number) =>
  (body as any[]).map((m) => m.mission ?? m).find((m) => m.id === id);

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const [d] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf("driver"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME" } as any)
    .returning();
  driverIds.push(d.id);
  driverRowId = d.id;
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  vehicleRowId = v.id;
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("PRX"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      status: "in_progress",
      agreedPrice: "125000",
    } as any)
    .returning();
  mission = m;
  missionIds.push(m.id);
  await db.insert(assignments).values({ missionId: m.id, vehicleId: v.id, driverId: d.id, status: "in_progress" } as any);
  const [u] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("PRU"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "assigned", agreedPrice: "98000" } as any)
    .returning();
  upcoming = u;
  missionIds.push(u.id);
  await db.insert(assignments).values({ missionId: u.id, vehicleId: v.id, driverId: d.id, status: "accepted" } as any);
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("prix convenu : lignes de mission entières", { timeout: 180000 }, () => {
  it("GET /api/operations/missions : l'admin les voit, magasinier et chauffeur reçoivent null", async () => {
    const admin = await call("GET", "/api/operations/missions", { actor: "admin" });
    expect(rowOf(admin.body, mission.id)?.agreedPrice).toBe("125000");
    for (const actor of ["warehouse", "driver"] as const) {
      const res = await call("GET", "/api/operations/missions", { actor });
      expect(res.status, actor).toBe(200);
      const row = rowOf(res.body, mission.id);
      if (actor === "driver") expect(row, "chauffeur affecté").toBeDefined();
      if (row) {
        expect(row.agreedPrice, actor).toBeNull();
        expect(row.tariffGridId, actor).toBeNull();
      }
    }
  });

  it("/operations/missions/upcoming et /active : magasinier et chauffeur reçoivent null, l'admin les voit", async () => {
    for (const [path, target] of [["upcoming", upcoming], ["active", mission]] as const) {
      const admin = await call("GET", `/api/operations/missions/${path}`, { actor: "admin" });
      expect(rowOf(admin.body, target.id), `admin ${path}`).toBeDefined();
      for (const actor of ["warehouse", "driver"] as const) {
        const res = await call("GET", `/api/operations/missions/${path}`, { actor });
        expect(res.status, `${actor} ${path}`).toBe(200);
        const row = rowOf(res.body, target.id);
        if (actor === "driver") expect(row, `chauffeur ${path}`).toBeDefined();
        if (row) expect(row.agreedPrice ?? null, `${actor} ${path}`).toBeNull();
      }
    }
  });

  it("trame temps réel de création : jamais de prix, même pour le personnel", async () => {
    const spy = vi.fn();
    (global as any).broadcastUpdate = spy;
    try {
      const res = await call("POST", "/api/missions", {
        actor: "admin",
        body: { orderNumber: uniqueTestToken("PRW"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "planned", agreedPrice: 777000 },
      });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      missionIds.push(res.body.id);
      expect(spy).toHaveBeenCalled();
      expect(JSON.stringify(spy.mock.calls)).not.toContain("777000");
    } finally {
      delete (global as any).broadcastUpdate;
    }
  });

  it("PUT /api/missions/:id/status par le chauffeur : la mission renvoyée n'a pas de prix", async () => {
    const res = await call("PUT", `/api/missions/${mission.id}/status`, { actor: "driver", body: { status: "delivered" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.id).toBe(mission.id);
    expect(res.body.agreedPrice).toBeNull();
    expect(res.body.tariffGridId).toBeNull();
  });
});
