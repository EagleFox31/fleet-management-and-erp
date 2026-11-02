import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workOrders } from "../../shared/schema";
import { createTestUser, createTestVehicle } from "../support/factories";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * DIR2 : rapport de performance des techniciens
 * (`GET /api/reports/technician-performance`) filtre par periode.
 *
 * Fenetre propre au test (juin 2019). Deux techniciens crees ici : les totaux
 * de la fenetre sont ceux des ordres de travail inseres, bornes incluses.
 */
type Actor = "admin" | "client" | "driver";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
let techA = 0;
let techB = 0;
const woIds: number[] = [];

const START = "2019-06-10T00:00:00.000Z";
const END = "2019-06-20T00:00:00.000Z";
const q = (start: string, end: string) => `/api/reports/technician-performance?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;

let vehicleId = 0;
async function wo(technicianId: number, status: "completed" | "in_progress" | "pending", createdAt: string) {
  const [row] = await db
    .insert(workOrders)
    .values({ vehicleId, technicianId, title: uniqueTestToken("dir2"), status, createdAt: new Date(createdAt), updatedAt: new Date(createdAt) })
    .returning();
  woIds.push(row.id);
}

const tech = (body: any, id: number) => (body.technicians as any[]).find((t) => t.id === id);

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin", client: "client", driver: "driver" });
  const a = await createTestUser({ role: "technician" });
  const b = await createTestUser({ role: "technician" });
  session.ids.userIds.push(a.id, b.id);
  techA = a.id;
  techB = b.id;
  const vehicle = await createTestVehicle();
  session.ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  await wo(techA, "completed", START); // borne basse
  await wo(techA, "in_progress", "2019-06-12T09:00:00.000Z");
  await wo(techA, "pending", "2019-06-14T09:00:00.000Z");
  await wo(techA, "completed", END); // borne haute
  await wo(techA, "completed", "2019-07-01T09:00:00.000Z"); // apres
  await wo(techA, "completed", "2019-06-09T23:59:59.999Z"); // 1 ms avant
  await wo(techB, "completed", "2019-06-11T09:00:00.000Z");
}, 60000);

afterAll(async () => {
  if (woIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, woIds));
  await session.stop();
});

describe("DIR2 : rapport performance techniciens par periode", { timeout: 60000 }, () => {
  it("compte par technicien les OT de la fenetre, bornes incluses, taux arrondi", async () => {
    const res = await session.call("GET", q(START, END), { actor: "admin" });
    expect(res.status).toBe(200);
    const a = tech(res.body, techA);
    expect(a).toMatchObject({ totalWorkOrders: 4, completedWorkOrders: 2, inProgressWorkOrders: 1, completionRate: 50 });
    expect(a.workOrders).toHaveLength(4);
    expect(tech(res.body, techB)).toMatchObject({ totalWorkOrders: 1, completedWorkOrders: 1, inProgressWorkOrders: 0, completionRate: 100 });
  });

  it("les totaux globaux de la fenetre sont la somme des OT inseres", async () => {
    const res = await session.call("GET", q(START, END), { actor: "admin" });
    expect(res.body.statistics).toMatchObject({ totalWorkOrders: 5, totalCompletedWorkOrders: 3, globalCompletionRate: 60 });
    expect(res.body.workOrders).toHaveLength(5);
    expect(res.body.statistics.totalActiveTechnicians).toBe(res.body.technicians.length);
  });

  it("fenetre vide : zero partout, taux 0 sans division par zero, technicien toujours liste", async () => {
    const res = await session.call("GET", q("2019-01-01T00:00:00.000Z", "2019-01-02T00:00:00.000Z"), { actor: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.statistics).toMatchObject({ totalWorkOrders: 0, totalCompletedWorkOrders: 0, globalCompletionRate: 0 });
    expect(tech(res.body, techA)).toMatchObject({ totalWorkOrders: 0, completionRate: 0 });
  });

  it("une fenetre plus etroite exclut les OT hors periode", async () => {
    const res = await session.call("GET", q("2019-06-11T00:00:00.000Z", "2019-06-13T00:00:00.000Z"), { actor: "admin" });
    expect(tech(res.body, techA)).toMatchObject({ totalWorkOrders: 1, inProgressWorkOrders: 1, completedWorkOrders: 0, completionRate: 0 });
    expect(tech(res.body, techB).totalWorkOrders).toBe(1);
  });

  it("sans session : 401", async () => {
    expect((await session.call("GET", q(START, END), { actor: null })).status).toBe(401);
  });

  // DEFAUT server/routes.ts:2894 : `authenticate` seul, un client lit la charge et les noms des techniciens.
  it.fails("un client est refuse (403) sur le rapport techniciens", async () => {
    const res = await session.call("GET", q(START, END), { actor: "client" });
    expect(res.status).toBe(403);
  });

  it.fails("un chauffeur est refuse (403) sur le rapport techniciens", async () => {
    const res = await session.call("GET", q(START, END), { actor: "driver" });
    expect(res.status).toBe(403);
  });

  // DEFAUT server/routes.ts:2896 : date invalide = Invalid Date transmis a la requete SQL, pas de 400.
  it.fails("une date invalide renvoie 400", async () => {
    const res = await session.call("GET", q("pas-une-date", END), { actor: "admin" });
    expect(res.status).toBe(400);
  });
});
