import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { assignments, drivers, missions } from "../../shared/schema";
import { apiErrorProblems } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import {
  broadcastDocumentRenewalCreatedFromMission,
  broadcastMissionFuelRecorded,
} from "../../server/api/missions.routes";

/**
 * Cloison (AGENTS.md §11) des trames de mission. `mission_updated`, `mission_fuel_recorded` et
 * `document_renewal_request_created` partaient en broadcast : tout compte connecté, client compris,
 * recevait client, adresses, coûts et plein de n'importe quelle mission.
 * Attendu : trame complète au personnel hors chauffeur ; trame réduite à `missionId` pour le
 * chauffeur affecté ; rien pour un client ni pour un chauffeur non affecté.
 *
 * Les trames sont capturées à `broadcastUpdate`, puis leur portée est résolue comme
 * `server/lib/realtime-scope.ts` (fermée par défaut : portée absente ou invalide = personne).
 */

type Scope = { type: string; userIds?: number[]; roles?: string[] };
type Captured = { eventType: string; scope?: Scope; payload?: Record<string, unknown> };
type Recipient = { userId: number; role: string };

const reaches = (scope: Scope | undefined, recipient: Recipient): boolean => {
  if (!scope) return false;
  if (scope.type === "broadcast") return true;
  if (scope.type === "user") return (scope.userIds ?? []).includes(recipient.userId);
  if (scope.type === "roles") return (scope.roles ?? []).map((r) => r.trim().toLowerCase()).includes(recipient.role);
  return false;
};

type Actor = "logistics" | "assignedDriver" | "otherDriver" | "client";
const ACTORS: Record<Actor, "logistics" | "driver" | "client"> = {
  logistics: "logistics",
  assignedDriver: "driver",
  otherDriver: "driver",
  client: "client",
};

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
const captured: Captured[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let actors: Awaited<ReturnType<typeof startContractActors<Actor>>>;

const who = (actor: Actor): Recipient => ({ userId: actors.userIdOf(actor), role: ACTORS[actor] });
const framesFor = (eventType: string, actor: Actor) =>
  captured.filter((frame) => frame.eventType === eventType && reaches(frame.scope, who(actor)));

async function driverProfile(userId: number) {
  const [existing] = await db.select().from(drivers).where(eq(drivers.userId, userId));
  if (existing) return existing;
  const [created] = await db
    .insert(drivers)
    .values({ userId, firstName: "TEST", lastName: uniqueTestToken("drv") } as any)
    .returning();
  driverIds.push(created.id);
  return created;
}

async function assignedMission() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("RTS"), pickupAddress: "TEST A", deliveryAddress: "TEST B", status: "planned" } as any)
    .returning();
  missionIds.push(mission.id);
  const driver = await driverProfile(actors.userIdOf("assignedDriver"));
  await db.insert(assignments).values({ missionId: mission.id, vehicleId: vehicle.id, driverId: driver.id, status: "accepted" } as any);
  return { missionId: mission.id, vehicleId: vehicle.id };
}

/** Le chauffeur affecté ne reçoit qu'une trame réduite à l'identifiant ; client et autre chauffeur, rien. */
function expectMissionCloison(eventType: string, missionId: number) {
  const staff = framesFor(eventType, "logistics");
  expect(staff.length).toBeGreaterThan(0);
  const driverFrames = framesFor(eventType, "assignedDriver");
  expect(driverFrames).toHaveLength(1);
  expect(driverFrames[0].payload).toEqual({ missionId });
  expect(framesFor(eventType, "otherDriver")).toEqual([]);
  expect(framesFor(eventType, "client")).toEqual([]);
  expect(captured.filter((frame) => frame.scope?.type === "broadcast")).toEqual([]);
}

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: { scope?: Scope; payload?: Record<string, unknown> }) => {
    captured.push({ eventType, scope: data?.scope, payload: data?.payload });
  });
  actors = await startContractActors<Actor>(ACTORS, ids.userIds);
  // Le chauffeur non affecté a lui aussi une fiche : seule l'affectation le distingue.
  await driverProfile(actors.userIdOf("otherDriver"));
}, 180000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await actors?.close();
}, 120000);

describe("Missions : portée des trames temps réel (§11)", { timeout: 180000 }, () => {
  it("mission_updated (PATCH) : personnel en entier, chauffeur affecté réduit, client et autre chauffeur rien", async () => {
    const { missionId } = await assignedMission();
    captured.length = 0;
    const res = await actors.call("PATCH", `/api/missions/${missionId}`, {
      actor: "logistics",
      body: { specialInstructions: "TEST portée temps réel" },
    });
    expect(res.status).toBe(200);
    expectMissionCloison("mission_updated", missionId);
    expect(framesFor("mission_updated", "logistics")[0].payload).toHaveProperty("mission");
  });

  it("mission_fuel_recorded : le plein (carte, montant) ne part qu'au personnel", async () => {
    const { missionId, vehicleId } = await assignedMission();
    captured.length = 0;
    await broadcastMissionFuelRecorded({
      missionId,
      fuelRecord: { vehicleId, quantity: 40, totalCost: 34000, fuelCardId: 7 },
      actorUserId: actors.userIdOf("logistics"),
      actorRole: "logistics",
    });
    expectMissionCloison("mission_fuel_recorded", missionId);
    expect(framesFor("mission_fuel_recorded", "logistics")[0].payload).toHaveProperty("record");
  });

  it("document_renewal_request_created depuis une mission : rôles qui lisent les demandes, ni client ni chauffeur", () => {
    captured.length = 0;
    broadcastDocumentRenewalCreatedFromMission({ id: 1, vehicleId: 1 }, { userId: null, role: "logistics" }, { missionId: 1 });
    expect(framesFor("document_renewal_request_created", "logistics")).toHaveLength(1);
    expect(framesFor("document_renewal_request_created", "client")).toEqual([]);
    expect(framesFor("document_renewal_request_created", "assignedDriver")).toEqual([]);
    expect(captured.filter((frame) => frame.scope?.type === "broadcast")).toEqual([]);
  });
});

describe("Missions : refus de rôle au contrat d'erreur (§10)", { timeout: 180000 }, () => {
  it("régularisation d'un plein par le chauffeur affecté : 403 lisible", async () => {
    const { missionId, vehicleId } = await assignedMission();
    const res = await actors.call("POST", `/api/missions/${missionId}/fuel-records/regularize`, {
      actor: "assignedDriver",
      body: { vehicleId, quantity: 10, unitPrice: 800, regularizationReason: "Ticket retrouvé après livraison" },
    });
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    expect(res.body.message).toBe("Seuls admin, logistique ou secrétariat peuvent régulariser un plein mission.");
  });

  it("demande de renouvellement par le chauffeur affecté : 403 lisible", async () => {
    const { missionId } = await assignedMission();
    const res = await actors.call("POST", `/api/missions/${missionId}/document-renewal-requests`, {
      actor: "assignedDriver",
      body: {},
    });
    expect(apiErrorProblems(res.status, res.body, 403)).toEqual([]);
    expect(res.body.message).toMatch(/^Accès refusé: seuls Admin/);
  });
});
