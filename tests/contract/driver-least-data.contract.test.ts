import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { FuelCardService } from "../../server/services/fuel-card-service";
import { MISSION_EVENT_ROLES, TREASURY_FUEL_CARD_READ_ROLES } from "../../shared/constants/roles";
import { broadcastMissionFuelRecorded } from "../../server/api/missions.routes";
import { assignments, clients, drivers, fuelRecords, missions } from "../../shared/schema";
import { deleteFuelRecordsWhere } from "../support/money-override";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Moindre donnée pour le chauffeur : (1) le détail d'une mission ne lui donne ni contact, ni e-mail, ni téléphone
 * du client (le personnel les reçoit) ; (2) le solde de la carte carburant ne montre ni montant ni litres au
 * chauffeur et au technicien, seulement le prix moyen au litre et sa source. Chaque montant est une sentinelle
 * cherchée dans le JSON entier de la réponse.
 */
const ACTORS = {
  admin: "admin",
  logistics: "logistics",
  secretary: "secretary",
  accountant: "accountant",
  management: "management",
  technician: "technician",
  driver: "driver",
  warehouse: "warehouse",
} as const;
type Actor = keyof typeof ACTORS;

const TOKEN = uniqueTestToken("LDC");
const CONTACT = { contactPerson: `Contact ${TOKEN}`, email: `${TOKEN.toLowerCase()}@example.test`, phone: "+237600112233" };
const AMOUNTS = { balance: 73519481, totalCredits: 91827364, totalDebits: 18307883, totalLiters: 22915.5, fuelBalance: 88142 };
const MOCK_BALANCE = {
  ...AMOUNTS,
  lastCredit: { id: 1, creditAmount: "50271939" },
  lastDebit: { id: 2, debitAmount: "40819273" },
  averagePricePerLiter: 801,
  averagePricePerLiterUsed: 801,
  averagePricePerLiterReal: 801,
  averagePricePerLiterFallback: 828,
  priceSource: "real",
};
const AMOUNT_SENTINELS = ["73519481", "91827364", "18307883", "22915.5", "88142", "50271939", "40819273"];
const PRICE_KEYS = ["averagePricePerLiter", "averagePricePerLiterUsed", "averagePricePerLiterReal", "averagePricePerLiterFallback", "priceSource"];

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);
const FRAME_DATE = "2037-02-02";
const previousBroadcast = (global as any).broadcastUpdate;
type Frame = { eventType: string; scope?: { type: string; roles?: string[] }; payload?: any };
const frames: Frame[] = [];
const reachesRole = (frame: Frame, role: string) =>
  frame.scope?.type === "broadcast" || (frame.scope?.type === "roles" && (frame.scope.roles ?? []).includes(role));
let fuelRecordId = 0;
let vehicleIdOfRecord = 0;
let clientId = 0;
let missionId = 0;
const driverIds: number[] = [];

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const [c] = await db.insert(clients).values({ name: `TEST ${TOKEN}`, ...CONTACT } as any).returning();
  clientId = c.id;
  ids.clientIds.push(c.id);
  const [d] = await db
    .insert(drivers)
    .values({ userId: session.userIdOf("driver"), firstName: "TEST", lastName: uniqueTestToken("drv"), cpcStatus: "FORME" } as any)
    .returning();
  driverIds.push(d.id);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [m] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("LDC"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "assigned", clientId } as any)
    .returning();
  missionId = m.id;
  await db.insert(assignments).values({ missionId, vehicleId: vehicle.id, driverId: d.id, status: "accepted" } as any);
  const [fr] = await db
    .insert(fuelRecords)
    .values({ vehicleId: vehicle.id, missionId, quantity: 40, cost: "34000", debitAmount: "34000", date: "2037-01-01", balance: "73519481", fuelBalance: "88142", createdBy: session.userIdOf("logistics") } as any)
    .returning();
  fuelRecordId = fr.id;
  vehicleIdOfRecord = vehicle.id;
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: any) => {
    frames.push({ eventType, scope: data?.scope, payload: data?.payload });
  });
  vi.spyOn(FuelCardService.prototype, "getCurrentBalance").mockResolvedValue(MOCK_BALANCE as any);
}, 120000);

afterAll(async () => {
  vi.restoreAllMocks();
  (global as any).broadcastUpdate = previousBroadcast;
  await deleteFuelRecordsWhere(sql`${fuelRecords.date} = ${FRAME_DATE} OR ${fuelRecords.id} = ${fuelRecordId || 0}`);
  if (missionId) {
    await db.delete(assignments).where(inArray(assignments.missionId, [missionId]));
    await db.delete(missions).where(inArray(missions.id, [missionId]));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("GET /api/missions/:id, coordonnées du client", { timeout: 120000 }, () => {
  it("le chauffeur reçoit le nom du client, ni contact, ni e-mail, ni téléphone", async () => {
    const res = await call("GET", `/api/missions/${missionId}`, { actor: "driver" });
    expect(res.status).toBe(200);
    expect(res.body.client.name).toBe(`TEST ${TOKEN}`);
    expect(Object.keys(res.body.client).sort()).toEqual(["id", "name"]);
    const sent = JSON.stringify(res.body);
    for (const value of Object.values(CONTACT)) expect(sent).not.toContain(value);
  });

  it.each(["admin", "logistics", "secretary", "management"] as const)("%s reçoit toutes les coordonnées", async (actor) => {
    const res = await call("GET", `/api/missions/${missionId}`, { actor });
    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject(CONTACT);
  });

  it("le technicien est refusé sur la liste et la fiche (aucun écran mission)", async () => {
    for (const path of ["/api/missions", `/api/missions/${missionId}`]) {
      const res = await call("GET", path, { actor: "technician" });
      expect(res.status, path).toBe(403);
      const sent = JSON.stringify(res.body);
      for (const value of [...Object.values(CONTACT), "TEST A", "TEST B"]) expect(sent, path).not.toContain(value);
    }
  });
});

describe("GET /api/operations/missions, coordonnées du client", { timeout: 120000 }, () => {
  it("le chauffeur reçoit id et nom du client, jamais contact, e-mail ni téléphone", async () => {
    const res = await call("GET", "/api/operations/missions", { actor: "driver" });
    expect(res.status).toBe(200);
    const mine = (res.body as any[]).find((m) => m.id === missionId || m.mission?.id === missionId);
    expect(mine).toBeTruthy();
    const sent = JSON.stringify(res.body);
    for (const value of Object.values(CONTACT)) expect(sent).not.toContain(value);
  });

  it("le technicien est refusé : ni contact, ni e-mail, ni téléphone", async () => {
    const res = await call("GET", "/api/operations/missions", { actor: "technician" });
    // Listes d'exploitation fermées au technicien (MISSION_READ_ROLES) : 403, aucune coordonnée dans le refus.
    expect(res.status).toBe(403);
    const sent = JSON.stringify(res.body);
    for (const value of Object.values(CONTACT)) expect(sent).not.toContain(value);
  });

  it("la logistique reçoit les coordonnées", async () => {
    const res = await call("GET", "/api/operations/missions", { actor: "logistics" });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(CONTACT.email);
  });
});

describe("GET /api/fuel-card/balance, montants", { timeout: 120000 }, () => {
  it.each(["driver", "technician", "warehouse"] as const)("%s ne reçoit aucun montant, seulement le prix au litre", async (actor) => {
    const res = await call("GET", "/api/fuel-card/balance", { actor });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual([...PRICE_KEYS].sort());
    expect(res.body.priceSource).toBe("real");
    expect(res.body.averagePricePerLiterUsed).toBe(801);
    const sent = JSON.stringify(res.body);
    for (const s of AMOUNT_SENTINELS) expect(sent).not.toContain(s);
  });

  it.each(["admin", "logistics", "secretary", "accountant", "management"] as const)("%s reçoit le solde complet", async (actor) => {
    const res = await call("GET", "/api/fuel-card/balance", { actor });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(AMOUNTS);
    expect(res.body.lastCredit).toEqual(MOCK_BALANCE.lastCredit);
    expect(res.body.priceSource).toBe("real");
  });

  it("sans session : 401", async () => {
    const res = await call("GET", "/api/fuel-card/balance", {});
    expect(res.status).toBe(401);
  });
});

const NO_DRIVER_NOTE = "ni le chauffeur ni le technicien n'ont d'écran sur ces routes";

describe("/api/clients : fiches client fermées au chauffeur et au technicien", { timeout: 120000 }, () => {
  it.each(["driver", "technician"] as const)(`%s reçoit 403 sur la liste, la fiche et /all (${NO_DRIVER_NOTE})`, async (actor) => {
    for (const path of ["/api/clients", `/api/clients/${clientId}`, "/api/clients/all"]) {
      const res = await call("GET", path, { actor });
      expect(res.status, path).toBe(403);
      const sent = JSON.stringify(res.body);
      for (const value of Object.values(CONTACT)) expect(sent).not.toContain(value);
    }
  });

  it.each(["admin", "logistics", "secretary"] as const)("%s lit la fiche avec les coordonnées", async (actor) => {
    const res = await call("GET", `/api/clients/${clientId}`, { actor });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(CONTACT);
  });

  it("la trame client_created ne vise ni chauffeur ni technicien", async () => {
    frames.length = 0;
    const res = await call("POST", "/api/clients", {
      actor: "admin",
      body: { name: `TEST ${uniqueTestToken("LDF")}`, email: `${uniqueTestToken("ldf").toLowerCase()}@example.test` },
    });
    expect(res.status).toBe(201);
    ids.clientIds.push(res.body.id);
    const sent = frames.filter((f) => f.eventType === "client_created");
    expect(sent.length).toBeGreaterThan(0);
    for (const frame of sent) {
      expect(reachesRole(frame, "driver")).toBe(false);
      expect(reachesRole(frame, "technician")).toBe(false);
      expect(reachesRole(frame, "logistics")).toBe(true);
    }
  });
});

describe("/api/fuel-card : historique et statistiques réservés aux lecteurs de la carte", { timeout: 120000 }, () => {
  const PATHS = [
    "/api/fuel-card/history",
    "/api/fuel-card/monthly-stats",
    "/api/fuel-card/stats-by-client",
    "/api/fuel-card/vehicle/1/stats",
    "/api/fuel-card/vehicle/1/anomalies",
  ];

  it.each(PATHS)("%s : refusé au chauffeur, au technicien et au magasinier", async (path) => {
    for (const actor of ["driver", "technician", "warehouse"] as const) {
      const res = await call("GET", path, { actor });
      expect(res.status, `${actor} ${path}`).toBe(403);
    }
  });

  it.each(PATHS)("%s : pas refusé aux lecteurs de la carte", async (path) => {
    for (const actor of ["admin", "logistics", "accountant"] as const) {
      const res = await call("GET", path, { actor });
      expect(res.status, `${actor} ${path}`).not.toBe(403);
      expect(res.status, `${actor} ${path}`).not.toBe(401);
    }
  });

  it("fuel_card_recharged : la trame ne vise que les lecteurs de la carte", async () => {
    frames.length = 0;
    const res = await call("POST", "/api/fuel-card/recharge", {
      actor: "admin",
      body: { amount: 1000, unitPrice: 800, date: FRAME_DATE, paymentMode: "virement", orderNumber: uniqueTestToken("ldr") },
    });
    expect(res.status).toBe(201);
    const sent = frames.filter((f) => f.eventType === "fuel_card_recharged");
    expect(sent.length).toBeGreaterThan(0);
    for (const frame of sent) {
      for (const role of ["driver", "technician", "warehouse", "workshop_manager"]) expect(reachesRole(frame, role), role).toBe(false);
      for (const role of ["admin", "logistics", "accountant", "management", "secretary"]) expect(reachesRole(frame, role), role).toBe(true);
    }
  });
});

describe("pleins de mission : solde courant de la carte", { timeout: 120000 }, () => {
  const hasBalance = (body: unknown) => /"(balance|fuelBalance)"/.test(JSON.stringify(body));

  it("le chauffeur affecté lit les pleins de sa mission sans solde ni débit de carte", async () => {
    const res = await call("GET", `/api/missions/${missionId}/fuel-records`, { actor: "driver" });
    expect(res.status).toBe(200);
    expect(res.body.records.length).toBeGreaterThan(0);
    expect(hasBalance(res.body.records)).toBe(false);
    for (const s of ["73519481", "88142"]) expect(JSON.stringify(res.body)).not.toContain(s);
  });

  it.each(["technician", "warehouse"] as const)("GET /api/missions/:id/fuel-records : %s refusé (aucun écran)", async (actor) => {
    const res = await call("GET", `/api/missions/${missionId}/fuel-records`, { actor });
    expect(res.status).toBe(403);
    for (const s of ["73519481", "88142"]) expect(JSON.stringify(res.body)).not.toContain(s);
  });

  it.each(["admin", "logistics", "accountant"] as const)("GET /api/missions/:id/fuel-records : %s garde le solde", async (actor) => {
    const res = await call("GET", `/api/missions/${missionId}/fuel-records`, { actor });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.records)).toContain("73519481");
  });

  it("GET /api/fuel-records/vehicle/:id : le chauffeur ne reçoit pas le solde, la logistique oui", async () => {
    const res = await call("GET", `/api/fuel-records/vehicle/${vehicleIdOfRecord}`, { actor: "driver" });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(hasBalance(res.body)).toBe(false);
    const staff = await call("GET", `/api/fuel-records/vehicle/${vehicleIdOfRecord}`, { actor: "logistics" });
    expect(staff.status).toBe(200);
    expect(JSON.stringify(staff.body)).toContain("73519481");
  });

  it("mission_fuel_recorded : la trame n'emporte ni balance ni fuelBalance", async () => {
    frames.length = 0;
    await broadcastMissionFuelRecorded({
      missionId,
      fuelRecord: { id: fuelRecordId, vehicleId: vehicleIdOfRecord, quantity: 40, totalCost: 34000, unitPrice: "801", debitAmount: "34000", balance: "73519481", fuelBalance: "88142" },
      actorUserId: session.userIdOf("logistics"),
    } as any);
    const sent = frames.filter((f) => f.eventType === "mission_fuel_recorded");
    expect(sent.length).toBeGreaterThan(0);
    for (const frame of sent) {
      expect(JSON.stringify(frame.payload)).not.toContain("73519481");
      expect(JSON.stringify(frame.payload)).not.toContain("88142");
    }
    // Hors lecteurs de la carte : identifiants seulement, ni prix, ni débit, ni crédit.
    const others = (MISSION_EVENT_ROLES as readonly string[]).filter((r) => !(TREASURY_FUEL_CARD_READ_ROLES as readonly string[]).includes(r));
    expect(others.length).toBeGreaterThan(0);
    for (const role of others) {
      const forRole = sent.filter((f) => reachesRole(f, role));
      expect(forRole, role).toHaveLength(1);
      expect(Object.keys(forRole[0].payload).sort(), role).toEqual(["fuelRecordId", "missionId"]);
    }
    const forLogistics = sent.filter((f) => reachesRole(f, "logistics"));
    expect(forLogistics).toHaveLength(1);
    expect(forLogistics[0].payload).toHaveProperty("record");
    expect(sent.filter((f) => reachesRole(f, "client"))).toEqual([]);
  });
});
