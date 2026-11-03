import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { assignments, documentRenewalRequests, drivers, missions, vehicleDocuments, vehicles } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestClient, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * P3-2 lot 2b : le récépissé provisoire d'une demande ouverte lève l'échéance dépassée
 * d'un papier aux quatre contrôles de missions.routes.ts — affectation (POST, PATCH),
 * préparation (GET launch-readiness) et lancement (PUT status). Il ne lève jamais un
 * papier manquant, ni un autre papier que le sien.
 */

const ACTORS = { logistics: "logistics", driver: "driver" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const missionIds: number[] = [];
const driverIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let clientId: number;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);

function inDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function driver() {
  const [d] = await db
    .insert(drivers)
    .values({
      firstName: "TEST",
      lastName: uniqueTestToken("drv"),
      employeeNumber: uniqueTestToken("emp"),
      cpcStatus: "FORMÉ",
      isActive: true,
    } as any)
    .returning();
  driverIds.push(d.id);
  return d;
}

async function addDoc(vehicleId: number, type: "carte_grise" | "assurance" | "visite_technique", expiryDate: string | null) {
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId, name: `TEST ${type}`, type, filename: "x.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/x.pdf", expiryDate })
    .returning();
  return doc;
}

async function addReceipt(
  vehicleId: number,
  vehicleDocumentId: number,
  documentType: "carte_grise" | "assurance" | "visite_technique",
  validUntil: string,
) {
  await db.insert(documentRenewalRequests).values({
    vehicleId,
    vehicleDocumentId,
    documentType,
    status: "in_progress",
    receiptValidUntil: validUntil,
    receiptFileName: "recepisse.pdf",
    receiptFilePath: "uploads/document-renewals/receipts/test-inexistant.pdf",
    receiptUploadedAt: new Date(),
  });
}

/** Véhicule dont l'assurance est échue (document et colonne miroir), les autres papiers valides. */
async function vehicleWithExpiredInsurance() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  await addDoc(vehicle.id, "carte_grise", inDays(100));
  const assurance = await addDoc(vehicle.id, "assurance", inDays(-5));
  await addDoc(vehicle.id, "visite_technique", inDays(100));
  await db.update(vehicles).set({ insuranceExpiry: inDays(-5) }).where(eq(vehicles.id, vehicle.id));
  return { vehicle, assurance };
}

async function createMission(assignment?: { vehicleId: number; driverId: number }) {
  const res = await call("POST", "/api/missions", {
    actor: "logistics",
    body: {
      orderNumber: uniqueTestToken("MIS"),
      clientId,
      status: "planned",
      pickupAddress: "TEST A",
      deliveryAddress: "TEST B",
      ...(assignment ? { assignment } : {}),
    },
  });
  if (res.status === 201) missionIds.push(res.body.id);
  return res;
}

/** Mission planifiée affectée au véhicule, sans passer par le contrôle d'affectation. */
async function assignedMission(vehicleId: number) {
  const d = await driver();
  const created = await createMission();
  expect(created.status).toBe(201);
  await db.insert(assignments).values({ missionId: created.body.id, vehicleId, driverId: d.id } as any);
  return created.body.id as number;
}

function launch(missionId: number) {
  return call("PUT", `/api/missions/${missionId}/status`, { actor: "logistics", body: { status: "in_progress" } });
}

async function readinessCheck(missionId: number, key: string) {
  const res = await call("GET", `/api/missions/${missionId}/launch-readiness`, { actor: "logistics" });
  expect(res.status).toBe(200);
  return res.body.checks.find((c: any) => c.key === key);
}

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
}, 120000);

afterAll(async () => {
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (ids.vehicleIds.length > 0) {
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleId, ids.vehicleIds));
    await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, ids.vehicleIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
});

describe("récépissé provisoire : affectation", { timeout: 60000 }, () => {
  it("POST : assurance échue refusée sans récépissé, acceptée avec un récépissé valable", async () => {
    const { vehicle, assurance } = await vehicleWithExpiredInsurance();
    const refused = await createMission({ vehicleId: vehicle.id, driverId: (await driver()).id });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("assurance expirée");

    await addReceipt(vehicle.id, assurance.id, "assurance", inDays(10));
    const accepted = await createMission({ vehicleId: vehicle.id, driverId: (await driver()).id });
    expect(accepted.status).toBe(201);
  });

  it("POST : récépissé échu hier, ou d'un autre papier, ne lève rien", async () => {
    const { vehicle, assurance } = await vehicleWithExpiredInsurance();
    await addReceipt(vehicle.id, assurance.id, "assurance", inDays(-1));
    await addReceipt(vehicle.id, assurance.id, "visite_technique", inDays(10));
    const refused = await createMission({ vehicleId: vehicle.id, driverId: (await driver()).id });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("assurance expirée");
  });

  it("PATCH : l'affectation d'un véhicule couvert par récépissé passe", async () => {
    const { vehicle, assurance } = await vehicleWithExpiredInsurance();
    const created = await createMission();
    expect(created.status).toBe(201);
    const body = { assignment: { vehicleId: vehicle.id, driverId: (await driver()).id } };

    const refused = await call("PATCH", `/api/missions/${created.body.id}`, { actor: "logistics", body });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("assurance expirée");

    await addReceipt(vehicle.id, assurance.id, "assurance", inDays(10));
    const accepted = await call("PATCH", `/api/missions/${created.body.id}`, { actor: "logistics", body });
    expect(accepted.status).toBe(200);
  });
});

describe("récépissé provisoire : préparation et lancement", { timeout: 60000 }, () => {
  it("launch-readiness : le contrôle assurance passe et nomme le récépissé", async () => {
    const { vehicle, assurance } = await vehicleWithExpiredInsurance();
    const missionId = await assignedMission(vehicle.id);
    expect((await readinessCheck(missionId, "doc_assurance")).passed).toBe(false);

    await addReceipt(vehicle.id, assurance.id, "assurance", inDays(10));
    const check = await readinessCheck(missionId, "doc_assurance");
    expect(check.passed).toBe(true);
    expect(check.detail).toContain("récépissé provisoire");
  });

  it("lancement : plus aucun motif de papier avec un récépissé valable", async () => {
    const { vehicle, assurance } = await vehicleWithExpiredInsurance();
    const missionId = await assignedMission(vehicle.id);
    const refused = await launch(missionId);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/ssurance/);

    await addReceipt(vehicle.id, assurance.id, "assurance", inDays(0));
    const res = await launch(missionId);
    // Le lancement exige aussi budgets et solde carburant, hors sujet ici.
    expect(res.body.message ?? "").not.toMatch(/carte grise|assurance|visite technique|plaque|expir/i);
  });

  it("lancement : le récépissé ne remplace pas un papier manquant", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await addDoc(vehicle.id, "carte_grise", inDays(100));
    const visite = await addDoc(vehicle.id, "visite_technique", inDays(100));
    await addReceipt(vehicle.id, visite.id, "assurance", inDays(10));
    const missionId = await assignedMission(vehicle.id);
    const res = await launch(missionId);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Assurance manquante ou expirée");
  });
});

describe("carte grise : préparation alignée sur le lancement", { timeout: 60000 }, () => {
  /** Véhicule aux papiers valides, sauf la carte grise (échéance donnée, ou sans date). */
  async function vehicleWithCarteGrise(expiryDate: string | null) {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const carteGrise = await addDoc(vehicle.id, "carte_grise", expiryDate);
    await addDoc(vehicle.id, "assurance", inDays(100));
    await addDoc(vehicle.id, "visite_technique", inDays(100));
    return { vehicle, carteGrise };
  }

  it("carte grise expirée : item bloquant à faux, comme le lancement qui la refuse", async () => {
    const { vehicle } = await vehicleWithCarteGrise(inDays(-3));
    const missionId = await assignedMission(vehicle.id);
    const check = await readinessCheck(missionId, "doc_carte_grise");
    expect(check).toMatchObject({ passed: false, blocking: true, detail: "Carte grise expirée." });
    const launched = await launch(missionId);
    expect(launched.status).toBe(400);
    expect(JSON.stringify(launched.body)).toContain("Carte grise expirée.");
  });

  it("le jour de l'échéance bloque, comme au lancement", async () => {
    const { vehicle } = await vehicleWithCarteGrise(inDays(0));
    const missionId = await assignedMission(vehicle.id);
    expect((await readinessCheck(missionId, "doc_carte_grise")).passed).toBe(false);
  });

  it("récépissé valable : item vrai, qui nomme le récépissé", async () => {
    const { vehicle, carteGrise } = await vehicleWithCarteGrise(inDays(-3));
    const missionId = await assignedMission(vehicle.id);
    await addReceipt(vehicle.id, carteGrise.id, "carte_grise", inDays(10));
    const check = await readinessCheck(missionId, "doc_carte_grise");
    expect(check.passed).toBe(true);
    expect(check.detail).toContain("récépissé provisoire");
  });

  it("carte grise sans date (papier permanent) ou à échéance future : item vrai", async () => {
    for (const expiry of [null, inDays(30)]) {
      const { vehicle } = await vehicleWithCarteGrise(expiry);
      const missionId = await assignedMission(vehicle.id);
      expect(await readinessCheck(missionId, "doc_carte_grise")).toMatchObject({ passed: true, detail: "Carte grise valide." });
    }
  });

  it("carte grise absente : item faux, « manquante »", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const missionId = await assignedMission(vehicle.id);
    expect(await readinessCheck(missionId, "doc_carte_grise")).toMatchObject({ passed: false, detail: "Carte grise manquante." });
  });
});
