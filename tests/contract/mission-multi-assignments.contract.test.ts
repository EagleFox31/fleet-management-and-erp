import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { fuelCardService } from "../../server/services/fuel-card-service";
import { assignments, clientInvoices, drivers, fuelRecords, missions, vehicleDocuments } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { deleteFuelRecordsWhere, deleteClientInvoicesWhere } from "../support/money-override";

/**
 * Plusieurs chauffeurs par mission, côté écriture (suite de #227) :
 *  - POST   /api/missions/:id/assignments                 ajoute un chauffeur et son véhicule ;
 *  - DELETE /api/missions/:id/assignments/:assignmentId   annule une affectation (statut cancelled).
 * Mêmes rôles que l'affectation par PATCH (MISSION_MANAGER_ROLES : admin, logistics, secretary).
 * L'ancien format PATCH { assignment } (une seule affectation) reste inchangé.
 */
const ACTORS = {
  admin: "admin",
  logistics: "logistics",
  secretary: "secretary",
  driver: "driver",
  otherDriver: "driver",
  client: "client",
  technician: "technician",
  management: "management",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const previousBroadcast = (global as any).broadcastUpdate;
const frames: { eventType: string; data: any }[] = [];

const TODAY = new Date().toISOString().slice(0, 10);
const FUTURE = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
const day = (d: number, h = 8) => new Date(Date.UTC(2032, 0, d, h, 0, 0));

async function vehicle() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const { balance } = await fuelCardService.getCurrentBalance();
  await createTestFuelRecord({
    vehicleId: v.id,
    creditAmount: (Math.max(0, -balance) + 10_000).toFixed(2),
    debitAmount: "0",
    cost: "0",
    quantity: 0,
  });
  return v.id;
}

const ficheOf = new Map<Actor, number>();
async function fiche(actor: Actor) {
  const known = ficheOf.get(actor);
  if (known !== undefined) return known;
  const [d] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf(actor), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE } as any)
    .returning();
  driverIds.push(d.id);
  ficheOf.set(actor, d.id);
  return d.id;
}

/** Chauffeur sans compte : pour les cas qui n'ont pas besoin de se connecter. */
async function freeDriver(extra: Record<string, unknown> = {}) {
  const [d] = await db
    .insert(drivers)
    .values({ firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME", licenseExpiry: FUTURE, ...extra } as any)
    .returning();
  driverIds.push(d.id);
  return d.id;
}

async function mission(opts: { status?: string; pickup?: Date; delivery?: Date } = {}) {
  const [m] = await db
    .insert(missions)
    .values({
      orderNumber: uniqueTestToken("MAS"),
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      status: opts.status ?? "in_progress",
      pickupDate: opts.pickup ?? null,
      deliveryDate: opts.delivery ?? null,
    } as any)
    .returning();
  missionIds.push(m.id);
  return m.id;
}

/** Mission avec le chauffeur `driver` déjà affecté (1re ligne). */
async function missionOfDriverA(opts: { status?: string; pickup?: Date; delivery?: Date } = {}) {
  const missionId = await mission(opts);
  const vehicleA = await vehicle();
  const [a] = await db
    .insert(assignments)
    .values({ missionId, vehicleId: vehicleA, driverId: await fiche("driver"), status: "accepted" } as any)
    .returning();
  return { missionId, vehicleA, assignmentA: a.id };
}

const fill = (vehicleId: number) => ({ vehicleId, quantity: 2, unitPrice: 1, date: TODAY, requestKey: uniqueTestToken("mas-key") });
const add = (actor: Actor, missionId: number | string, body: unknown) =>
  session.call("POST", `/api/missions/${missionId}/assignments`, { actor, body });
const cancel = (actor: Actor, missionId: number | string, assignmentId: number | string) =>
  session.call("DELETE", `/api/missions/${missionId}/assignments/${assignmentId}`, { actor });
const rowsOf = async (missionId: number) =>
  (await db.select().from(assignments).where(eq(assignments.missionId, missionId))).sort((a, b) => a.id - b.id);

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: any) => {
    frames.push({ eventType, data });
  });
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (ids.vehicleIds.length > 0) await deleteFuelRecordsWhere(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("POST /api/missions/:id/assignments : ajouter un chauffeur", { timeout: 180000 }, () => {
  it.each(["admin", "logistics", "secretary"] as const)("%s ajoute un 2e chauffeur : 201, et les deux saisissent leur carburant", async (actor) => {
    const { missionId, vehicleA } = await missionOfDriverA();
    const vehicleB = await vehicle();
    const res = await add(actor, missionId, { driverId: await fiche("otherDriver"), vehicleId: vehicleB });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ missionId, vehicleId: vehicleB, status: "pending" });
    expect((await rowsOf(missionId)).map((r) => r.vehicleId)).toEqual([vehicleA, vehicleB]);

    const resA = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: fill(vehicleA) });
    expect(resA.status, JSON.stringify(resA.body)).toBe(201);
    const resB = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "otherDriver", body: fill(vehicleB) });
    expect(resB.status, JSON.stringify(resB.body)).toBe(201);
  });

  it("mission planifiée sans chauffeur : le premier ajout la passe à assigned", async () => {
    const missionId = await mission({ status: "planned" });
    const res = await add("logistics", missionId, { driverId: await freeDriver(), vehicleId: await vehicle() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [m] = await db.select().from(missions).where(eq(missions.id, missionId));
    expect(m.status).toBe("assigned");
  });

  it("le même chauffeur deux fois : 409, une seule ligne ajoutée", async () => {
    const { missionId } = await missionOfDriverA();
    const driverId = await freeDriver();
    expect((await add("admin", missionId, { driverId, vehicleId: await vehicle() })).status).toBe(201);
    const second = await add("admin", missionId, { driverId, vehicleId: await vehicle() });
    expect(apiErrorProblems(second.status, second.body, 409, undefined, second.headers.get("x-request-id"))).toEqual([]);
    expect(await rowsOf(missionId)).toHaveLength(2);
  });

  it("deux ajouts simultanés du même chauffeur : un 201, un 409 (verrou de la ligne mission)", async () => {
    const { missionId } = await missionOfDriverA();
    const driverId = await freeDriver();
    const [v1, v2] = [await vehicle(), await vehicle()];
    const results = await Promise.all([add("admin", missionId, { driverId, vehicleId: v1 }), add("logistics", missionId, { driverId, vehicleId: v2 })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rowsOf(missionId)).toHaveLength(2);
  });

  it("le chauffeur de la 1re ligne, ajouté une seconde fois : 409", async () => {
    const { missionId } = await missionOfDriverA();
    const res = await add("admin", missionId, { driverId: await fiche("driver"), vehicleId: await vehicle() });
    expect(res.status).toBe(409);
  });

  it("conflit de planning, chauffeur : 409, rien d'écrit", async () => {
    const driverId = await freeDriver();
    const other = await mission({ status: "assigned", pickup: day(10), delivery: day(12) });
    await db.insert(assignments).values({ missionId: other, vehicleId: await vehicle(), driverId, status: "pending" } as any);
    const { missionId } = await missionOfDriverA({ pickup: day(11), delivery: day(13) });
    const res = await add("admin", missionId, { driverId, vehicleId: await vehicle() });
    expect(apiErrorProblems(res.status, res.body, 409, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await rowsOf(missionId)).toHaveLength(1);
  });

  it("conflit de planning, véhicule : 409 ; créneau disjoint : 201", async () => {
    const sharedVehicle = await vehicle();
    const other = await mission({ status: "in_progress", pickup: day(20), delivery: day(22) });
    await db.insert(assignments).values({ missionId: other, vehicleId: sharedVehicle, driverId: await freeDriver(), status: "accepted" } as any);
    const clash = await missionOfDriverA({ pickup: day(21), delivery: day(23) });
    expect((await add("admin", clash.missionId, { driverId: await freeDriver(), vehicleId: sharedVehicle })).status).toBe(409);
    const apart = await missionOfDriverA({ pickup: day(25), delivery: day(26) });
    expect((await add("admin", apart.missionId, { driverId: await freeDriver(), vehicleId: sharedVehicle })).status).toBe(201);
  });

  it("une affectation annulée d'une autre mission ne bloque pas le planning", async () => {
    const driverId = await freeDriver();
    const other = await mission({ status: "assigned", pickup: day(5), delivery: day(7) });
    await db.insert(assignments).values({ missionId: other, vehicleId: await vehicle(), driverId, status: "cancelled" } as any);
    const { missionId } = await missionOfDriverA({ pickup: day(6), delivery: day(8) });
    expect((await add("admin", missionId, { driverId, vehicleId: await vehicle() })).status).toBe(201);
  });

  it.each(["driver", "otherDriver", "client", "technician"] as const)("%s : 403, aucune affectation ajoutée", async (actor) => {
    const { missionId } = await missionOfDriverA();
    const res = await add(actor, missionId, { driverId: await freeDriver(), vehicleId: await vehicle() });
    expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(await rowsOf(missionId)).toHaveLength(1);
  });

  it("corps invalide, ids invalides, mission, véhicule, chauffeur inconnus : refus lisibles", async () => {
    const { missionId } = await missionOfDriverA();
    const driverId = await freeDriver();
    const ok = await vehicle();
    for (const body of [{}, { driverId, vehicleId: "abc" }, { driverId: 0, vehicleId: ok }, { driverId, vehicleId: 2147483648 }]) {
      const res = await add("admin", missionId, body);
      expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    }
    expect((await add("admin", "abc", { driverId, vehicleId: ok })).status).toBe(400);
    expect((await add("admin", 2147483647, { driverId, vehicleId: ok })).status).toBe(404);
    expect((await add("admin", missionId, { driverId: 2147483647, vehicleId: ok })).status).toBe(400);
    expect((await add("admin", missionId, { driverId, vehicleId: 2147483647 })).status).toBe(400);
    const inactive = await freeDriver({ isActive: false });
    expect((await add("admin", missionId, { driverId: inactive, vehicleId: ok })).status).toBe(400);
    expect(await rowsOf(missionId)).toHaveLength(1);
  });

  it("mission terminée : 400", async () => {
    const { missionId } = await missionOfDriverA({ status: "completed" });
    expect((await add("admin", missionId, { driverId: await freeDriver(), vehicleId: await vehicle() })).status).toBe(400);
  });

  it("trame temps réel : personnel hors chauffeur (complète) puis chauffeurs affectés seulement (réduite), jamais en broadcast", async () => {
    const { missionId } = await missionOfDriverA();
    const driverB = await fiche("otherDriver");
    frames.length = 0;
    expect((await add("admin", missionId, { driverId: driverB, vehicleId: await vehicle() })).status).toBe(201);
    const mine = frames.filter((f) => f.eventType === "mission_updated" && f.data?.entityId === missionId);
    expect(mine.length).toBe(2);
    expect(mine.some((f) => f.data.scope?.type === "broadcast")).toBe(false);
    const staff = mine.find((f) => f.data.scope?.type === "roles");
    expect(staff?.data.scope.roles).not.toContain("driver");
    expect(staff?.data.payload.source).toBe("mission_assignment_added");
    const nominative = mine.find((f) => f.data.scope?.type === "user");
    expect([...nominative!.data.scope.userIds].sort()).toEqual([session.userIdOf("driver"), session.userIdOf("otherDriver")].sort());
    expect(nominative!.data.payload).toEqual({ missionId });
  });
});

describe("DELETE /api/missions/:id/assignments/:assignmentId : annuler une affectation", { timeout: 180000 }, () => {
  async function twoDrivers() {
    const a = await missionOfDriverA();
    const vehicleB = await vehicle();
    const [b] = await db
      .insert(assignments)
      .values({ missionId: a.missionId, vehicleId: vehicleB, driverId: await fiche("otherDriver"), status: "accepted" } as any)
      .returning();
    return { ...a, vehicleB, assignmentB: b.id };
  }

  it("annule B : ligne conservée en cancelled, B perd la saisie (403), A saisit toujours (201)", async () => {
    const { missionId, vehicleA, vehicleB, assignmentB } = await twoDrivers();
    const res = await cancel("admin", missionId, assignmentB);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect((await rowsOf(missionId)).map((r) => r.status)).toEqual(["accepted", "cancelled"]);

    const asB = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "otherDriver", body: fill(vehicleB) });
    expect(apiErrorProblems(asB.status, asB.body, 403, undefined, asB.headers.get("x-request-id"))).toEqual([]);
    const asA = await session.call("POST", `/api/missions/${missionId}/fuel-records`, { actor: "driver", body: fill(vehicleA) });
    expect(asA.status, JSON.stringify(asA.body)).toBe(201);
  });

  it("rejouable : une seconde annulation répond 200 sans nouvelle trame", async () => {
    const { missionId, assignmentB } = await twoDrivers();
    expect((await cancel("logistics", missionId, assignmentB)).status).toBe(200);
    frames.length = 0;
    expect((await cancel("logistics", missionId, assignmentB)).status).toBe(200);
    expect(frames.filter((f) => f.data?.entityId === missionId)).toEqual([]);
  });

  it("annuler la dernière affectation d'une mission assigned la remet à planned ; un chauffeur annulé peut être ré-ajouté", async () => {
    const missionId = await mission({ status: "planned" });
    const driverId = await freeDriver();
    const created = await add("admin", missionId, { driverId, vehicleId: await vehicle() });
    expect(created.status).toBe(201);
    expect((await cancel("admin", missionId, created.body.id)).status).toBe(200);
    const [m] = await db.select().from(missions).where(eq(missions.id, missionId));
    expect(m.status).toBe("planned");
    expect((await add("admin", missionId, { driverId, vehicleId: await vehicle() })).status).toBe(201);
  });

  it.each(["driver", "otherDriver", "client", "technician"] as const)("%s : 403, rien n'est annulé", async (actor) => {
    const { missionId, assignmentB } = await twoDrivers();
    const res = await cancel(actor, missionId, assignmentB);
    expect(apiErrorProblems(res.status, res.body, 403, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect((await rowsOf(missionId)).map((r) => r.status)).toEqual(["accepted", "accepted"]);
  });

  it("affectation d'une autre mission : 404 ; ids invalides : 400 ; affectation démarrée : 409", async () => {
    const { missionId, assignmentA } = await twoDrivers();
    const foreign = await twoDrivers();
    expect((await cancel("admin", missionId, foreign.assignmentB)).status).toBe(404);
    expect((await cancel("admin", missionId, "abc")).status).toBe(400);
    expect((await cancel("admin", "abc", assignmentA)).status).toBe(400);
    await db.update(assignments).set({ status: "in_progress" } as any).where(eq(assignments.id, assignmentA));
    const started = await cancel("admin", missionId, assignmentA);
    expect(apiErrorProblems(started.status, started.body, 409, undefined, started.headers.get("x-request-id"))).toEqual([]);
  });
});

describe("PATCH /api/missions/:id : ancien format à une seule affectation, inchangé", { timeout: 180000 }, () => {
  it("remplace la seule affectation (une ligne avant, une ligne après) ; null la supprime", async () => {
    const missionId = await mission({ status: "planned" });
    const first = await freeDriver();
    const second = await freeDriver();
    const v1 = await vehicle();
    const v2 = await vehicle();
    const set1 = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "logistics", body: { assignment: { driverId: first, vehicleId: v1 } } });
    expect(set1.status, JSON.stringify(set1.body)).toBe(200);
    expect(set1.body.status).toBe("assigned");
    const set2 = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "logistics", body: { assignment: { driverId: second, vehicleId: v2 } } });
    expect(set2.status, JSON.stringify(set2.body)).toBe(200);
    const rows = await rowsOf(missionId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ driverId: second, vehicleId: v2, status: "pending" });
    const cleared = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "logistics", body: { assignment: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.status).toBe("planned");
    expect(await rowsOf(missionId)).toHaveLength(0);
  });
});

/**
 * Passage de 1 à N affectations (NO-GO sécurité de #240) : toute écriture qui visait « la » ligne
 * d'affectation doit viser les lignes vivantes, et jamais ressusciter une ligne annulée ou refusée.
 */
describe("plusieurs affectations : statut, annulation et modification n'écrivent que sur les lignes vivantes", { timeout: 240000 }, () => {
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  const BUDGET = { budgetPlan: { fuelBudget: 1, roadExpensesBudget: 0, contingencyBudget: 0 } };

  async function papers(vehicleId: number) {
    for (const type of ["carte_grise", "assurance", "visite_technique"] as const) {
      await db.insert(vehicleDocuments).values({
        vehicleId,
        name: `TEST ${type}`,
        type,
        filename: "x.pdf",
        filesize: 1,
        fileType: "application/pdf",
        filePath: "uploads/x.pdf",
        expiryDate: inDays(300),
      } as any);
    }
  }

  /** Mission prête au lancement : A1 (driver) et A2 (otherDriver), chacun sur son véhicule en règle. */
  async function launchable(opts: { paperless?: "A2" } = {}) {
    const [m] = await db
      .insert(missions)
      .values({
        orderNumber: uniqueTestToken("MAS"),
        pickupAddress: "TEST A",
        deliveryAddress: "TEST B",
        status: "assigned",
        deliveryDate: new Date(),
        workflowData: BUDGET,
      } as any)
      .returning();
    missionIds.push(m.id);
    const [vehicleA1, vehicleA2] = [await vehicle(), await vehicle()];
    await papers(vehicleA1);
    if (opts.paperless !== "A2") await papers(vehicleA2);
    const [a1] = await db
      .insert(assignments)
      .values({ missionId: m.id, vehicleId: vehicleA1, driverId: await fiche("driver"), status: "accepted" } as any)
      .returning();
    const [a2] = await db
      .insert(assignments)
      .values({ missionId: m.id, vehicleId: vehicleA2, driverId: await fiche("otherDriver"), status: "accepted" } as any)
      .returning();
    return { missionId: m.id as number, vehicleA1, vehicleA2, a1: a1.id as number, a2: a2.id as number };
  }

  const setStatus = (actor: Actor, missionId: number, status: string, extra: Record<string, unknown> = {}) =>
    session.call("PUT", `/api/missions/${missionId}/status`, { actor, body: { status, ...extra } });
  const statuses = async (missionId: number) => (await rowsOf(missionId)).map((r) => r.status);

  it("A1 annulée : le chauffeur A ne lance plus (403), A1 reste cancelled ; B lance, seule A2 passe in_progress", async () => {
    const { missionId, a1 } = await launchable();
    expect((await cancel("admin", missionId, a1)).status).toBe(200);

    const asA = await setStatus("driver", missionId, "in_progress");
    expect(apiErrorProblems(asA.status, asA.body, 403, undefined, asA.headers.get("x-request-id"))).toEqual([]);
    expect(await statuses(missionId)).toEqual(["cancelled", "accepted"]);

    const asB = await setStatus("otherDriver", missionId, "in_progress");
    expect(asB.status, JSON.stringify(asB.body)).toBe(200);
    expect(await statuses(missionId)).toEqual(["cancelled", "in_progress"]);
  });

  it("A1 annulée puis mission menée à terme par le personnel : A1 reste cancelled, le CA va tout entier au véhicule de A2", async () => {
    const { missionId, a1, vehicleA1, vehicleA2 } = await launchable();
    expect((await cancel("admin", missionId, a1)).status).toBe(200);
    const steps: Array<[string, Record<string, unknown>]> = [["in_progress", {}], ["delivered", {}], ["completed", { actualFdrCost: 0 }]];
    for (const [status, extra] of steps) {
      const res = await setStatus("logistics", missionId, status, extra);
      expect(res.status, `${status} ${JSON.stringify(res.body)}`).toBe(200);
      expect((await statuses(missionId))[0]).toBe("cancelled");
    }

    const amountHT = 4_100_000_000_000;
    const [invoice] = await db
      .insert(clientInvoices)
      .values({
        missionId,
        invoiceNumber: uniqueTestToken("inv-mas"),
        invoiceDate: TODAY,
        dueDate: TODAY,
        amountHT: String(amountHT),
        amountTTC: String(amountHT),
        balance: String(amountHT),
      } as any)
      .returning({ id: clientInvoices.id });
    try {
      const res = await session.call("GET", "/api/management/dashboard?period=month", { actor: "management" });
      expect(res.status).toBe(200);
      const tco = res.body.vehicleTco;
      const items = [...tco.topByMargin, ...tco.worstByMargin] as Array<{ vehicleId: number; revenueHT: number }>;
      expect(items.find((i) => i.vehicleId === vehicleA1)).toBeUndefined();
      expect(items.find((i) => i.vehicleId === vehicleA2)).toMatchObject({ revenueHT: amountHT });
    } finally {
      await deleteClientInvoicesWhere(eq(clientInvoices.id, invoice.id));
    }
  });

  it("personnel : lance toutes les lignes actives, jamais une ligne refusée", async () => {
    const { missionId, a2 } = await launchable();
    await db.update(assignments).set({ status: "rejected" } as any).where(eq(assignments.id, a2));
    const res = await setStatus("logistics", missionId, "in_progress");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statuses(missionId)).toEqual(["in_progress", "rejected"]);
  });

  it("contrôles de lancement sur chaque affectation active : le second véhicule sans papiers bloque (400), rien n'est écrit", async () => {
    const { missionId } = await launchable({ paperless: "A2" });
    const res = await setStatus("logistics", missionId, "in_progress");
    expect(apiErrorProblems(res.status, res.body, 400, undefined, res.headers.get("x-request-id"))).toEqual([]);
    expect(res.body.message).toMatch(/Véhicule .* : Carte grise manquante/);
    expect(await statuses(missionId)).toEqual(["accepted", "accepted"]);
    const [m] = await db.select().from(missions).where(eq(missions.id, missionId));
    expect(m.status).toBe("assigned");
  });

  it("chauffeur annulé : perd l'accès à la mission (403) et la voit disparaître de ses listes, l'autre chauffeur la garde", async () => {
    const { missionId, a2 } = await launchable();
    const LISTS = [
      "/api/missions",
      "/api/operations/missions",
      "/api/operations/missions/upcoming",
      "/api/drivers/me",
      "/api/drivers/:own/missions",
    ];
    const listed = async (actor: Actor) => {
      const seen: Record<string, boolean> = {};
      for (const path of LISTS) {
        const url = path.replace(":own", String(await fiche(actor)));
        const res = await session.call("GET", url, { actor });
        expect(res.status, `${actor} ${url}`).toBe(200);
        const rows = (path === "/api/drivers/me" ? res.body.missions : res.body) as Array<{ id: number }>;
        seen[path] = rows.some((m) => m.id === missionId);
      }
      return seen;
    };
    const everywhere = Object.fromEntries(LISTS.map((p) => [p, true]));
    expect((await session.call("GET", `/api/missions/${missionId}`, { actor: "otherDriver" })).status).toBe(200);
    expect(await listed("otherDriver")).toEqual(everywhere);

    expect((await cancel("admin", missionId, a2)).status).toBe(200);
    const lost = await session.call("GET", `/api/missions/${missionId}`, { actor: "otherDriver" });
    expect(apiErrorProblems(lost.status, lost.body, 403, undefined, lost.headers.get("x-request-id"))).toEqual([]);
    expect(await listed("otherDriver")).toEqual(Object.fromEntries(LISTS.map((p) => [p, false])));

    expect((await session.call("GET", `/api/missions/${missionId}`, { actor: "driver" })).status).toBe(200);
    expect(await listed("driver")).toEqual(everywhere);
  });

  it("DELETE d'une affectation refusée : 200 sans réécriture (reste rejected), sans trame", async () => {
    const { missionId, a2 } = await launchable();
    await db.update(assignments).set({ status: "rejected" } as any).where(eq(assignments.id, a2));
    frames.length = 0;
    const res = await cancel("admin", missionId, a2);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await statuses(missionId)).toEqual(["accepted", "rejected"]);
    expect(frames.filter((f) => f.data?.entityId === missionId)).toEqual([]);
  });

  it("PATCH { assignment } sur une mission à deux chauffeurs : 409, lignes inchangées", async () => {
    const { missionId } = await launchable();
    const before = await rowsOf(missionId);
    for (const assignment of [{ driverId: await freeDriver(), vehicleId: await vehicle() }, null]) {
      const res = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "logistics", body: { assignment } });
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(apiErrorProblems(res.status, res.body, 409, undefined, res.headers.get("x-request-id"))).toEqual([]);
    }
    expect(await rowsOf(missionId)).toEqual(before);
  });

  it("PATCH { assignment } avec une ligne vivante et une annulée : remplace la vivante, l'annulée reste cancelled", async () => {
    const { missionId, a1 } = await launchable();
    expect((await cancel("admin", missionId, a1)).status).toBe(200);
    const driverId = await freeDriver();
    const vehicleId = await vehicle();
    const res = await session.call("PATCH", `/api/missions/${missionId}`, { actor: "logistics", body: { assignment: { driverId, vehicleId } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = await rowsOf(missionId);
    expect(rows[0].status).toBe("cancelled");
    expect(rows.filter((r) => r.status !== "cancelled")).toMatchObject([{ driverId, vehicleId }]);
  });
});
