import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { FuelCardService } from "../../server/services/fuel-card-service";
import { assignments, clients, drivers, missions } from "../../shared/schema";
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
  vi.spyOn(FuelCardService.prototype, "getCurrentBalance").mockResolvedValue(MOCK_BALANCE as any);
}, 120000);

afterAll(async () => {
  vi.restoreAllMocks();
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

  it.each(["admin", "logistics", "secretary", "technician", "management"] as const)("%s reçoit toutes les coordonnées", async (actor) => {
    const res = await call("GET", `/api/missions/${missionId}`, { actor });
    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject(CONTACT);
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
