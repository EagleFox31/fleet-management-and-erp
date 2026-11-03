import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alertService } from "../../server/services/alert-service";
import { preventiveMaintenanceService } from "../../server/services/preventive-maintenance-service";
import { alerts, assignments, drivers, missions, vehicleDocuments, vehicles, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestClient, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * P3-2 : prévenir avant, bloquer à l'expiration.
 * - papier dans la fenêtre : aucune OT atelier, une alerte, statut véhicule inchangé ;
 * - papier expiré : affectation ET lancement refusés (carte grise comprise) ;
 * - papier expiré pendant une mission en cours : alerte au chef de parc (logistics),
 *   mission non interrompue, nouvelle affectation refusée.
 */

const ACTORS = { logistics: "logistics", atelier: "workshop_manager" } as const;
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

async function addDoc(vehicleId: number, type: "carte_grise" | "assurance" | "visite_technique", expiryDate: string) {
  await db.insert(vehicleDocuments).values({
    vehicleId,
    name: `TEST ${type}`,
    type,
    filename: "x.pdf",
    filesize: 1,
    fileType: "application/pdf",
    filePath: "uploads/x.pdf",
    expiryDate,
  });
}

async function vehicleRow(vehicleId: number) {
  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
  return v;
}

async function plannedMission(assignment?: { vehicleId: number; driverId: number }) {
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

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  const client = await createTestClient();
  ids.clientIds.push(client.id);
  clientId = client.id;
}, 120000);

afterAll(async () => {
  const vehicleIds = ids.vehicleIds;
  if (ids.userIds.length > 0) await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  if (missionIds.length > 0) {
    await db.delete(assignments).where(inArray(assignments.missionId, missionIds));
    await db.delete(missions).where(inArray(missions.id, missionIds));
  }
  if (vehicleIds.length > 0) {
    await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, vehicleIds));
    await db.delete(workOrders).where(inArray(workOrders.vehicleId, vehicleIds));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  await cleanupCreated(ids);
  await session?.close();
});

describe("P3-2 papier dans la fenêtre d'alerte", () => {
  it("aucun OT atelier, une alerte avec lien de renouvellement, statut inchangé", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await addDoc(vehicle.id, "assurance", inDays(10));
    await db
      .update(vehicles)
      .set({ insuranceExpiry: inDays(10), technicalInspectionDate: inDays(5), licensePlateExpiry: inDays(20) })
      .where(eq(vehicles.id, vehicle.id));

    for (const type of ["insurance", "inspection", "license"] as const) {
      expect(await preventiveMaintenanceService.checkDateBasedMaintenance(vehicle.id, type)).toHaveLength(0);
    }
    expect(await db.select().from(workOrders).where(eq(workOrders.vehicleId, vehicle.id))).toHaveLength(0);

    await (alertService as any).checkVehicleDocumentAlerts(await vehicleRow(vehicle.id));
    const rows = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, session.userIdOf("atelier")),
          like(alerts.link, `%vehicleId=${vehicle.id}&%`),
          eq(alerts.title, "Document expire bientôt"),
        ),
      );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.link?.startsWith("/vehicles/documents/renew?vehicleId="))).toBe(true);
    expect((await vehicleRow(vehicle.id)).status).toBe("operational");
  }, 60000);
});

describe("P3-2 papier expiré : affectation et lancement refusés", () => {
  it("affectation refusée pour une assurance expirée (colonne miroir)", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await db.update(vehicles).set({ insuranceExpiry: inDays(-3) }).where(eq(vehicles.id, vehicle.id));
    const d = await driver();
    const res = await plannedMission({ vehicleId: vehicle.id, driverId: d.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("assurance expirée");
  }, 60000);

  it("affectation refusée pour une plaque / carte grise expirée", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await db.update(vehicles).set({ licensePlateExpiry: inDays(-1) }).where(eq(vehicles.id, vehicle.id));
    const d = await driver();
    const res = await plannedMission({ vehicleId: vehicle.id, driverId: d.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("plaque expirée");
  }, 60000);

  it("lancement refusé : carte grise expirée (document), alors que le véhicule est opérationnel", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await addDoc(vehicle.id, "carte_grise", inDays(-2));
    await addDoc(vehicle.id, "assurance", inDays(100));
    await addDoc(vehicle.id, "visite_technique", inDays(100));
    const d = await driver();
    const created = await plannedMission({ vehicleId: vehicle.id, driverId: d.id });
    expect(created.status).toBe(201);
    const res = await call("PUT", `/api/missions/${created.body.id}/status`, {
      actor: "logistics",
      body: { status: "in_progress" },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("Carte grise expirée");
  }, 60000);

  it("lancement refusé par l'éligibilité : colonne miroir expirée, documents valides", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await addDoc(vehicle.id, "carte_grise", inDays(100));
    await addDoc(vehicle.id, "assurance", inDays(100));
    await addDoc(vehicle.id, "visite_technique", inDays(100));
    const d = await driver();
    const created = await plannedMission({ vehicleId: vehicle.id, driverId: d.id });
    expect(created.status).toBe(201);
    // Le papier expire après l'affectation : seule la règle d'éligibilité le voit.
    await db.update(vehicles).set({ technicalInspectionDate: inDays(-4) }).where(eq(vehicles.id, vehicle.id));
    const res = await call("PUT", `/api/missions/${created.body.id}/status`, {
      actor: "logistics",
      body: { status: "in_progress" },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("isite technique expirée");
  }, 60000);
});

describe("P3-2 papier expiré pendant une mission en cours", () => {
  it("alerte au chef de parc, mission non interrompue, nouvelle affectation refusée", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    const d = await driver();
    const created = await plannedMission({ vehicleId: vehicle.id, driverId: d.id });
    expect(created.status).toBe(201);
    const missionId = created.body.id as number;
    await db.update(missions).set({ status: "in_progress" }).where(eq(missions.id, missionId));

    await addDoc(vehicle.id, "assurance", inDays(-1));
    await db.update(vehicles).set({ insuranceExpiry: inDays(-1) }).where(eq(vehicles.id, vehicle.id));
    await (alertService as any).checkVehicleDocumentAlerts(await vehicleRow(vehicle.id));

    const mine = await db
      .select()
      .from(alerts)
      .where(
        and(
          eq(alerts.userId, session.userIdOf("logistics")),
          like(alerts.link, `%vehicleId=${vehicle.id}&%`),
          eq(alerts.title, "Papier expiré en cours de mission"),
        ),
      );
    expect(mine).toHaveLength(1);
    expect(mine[0].priority).toBe("critical");

    // La mission n'est pas interrompue, le véhicule garde son statut.
    const [mission] = await db.select().from(missions).where(eq(missions.id, missionId));
    expect(mission.status).toBe("in_progress");
    expect((await vehicleRow(vehicle.id)).status).toBe("operational");

    // Aucune nouvelle mission avant régularisation.
    const d2 = await driver();
    const refused = await plannedMission({ vehicleId: vehicle.id, driverId: d2.id });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("assurance expirée");
  }, 60000);
});

async function launch(missionId: number) {
  return call("PUT", `/api/missions/${missionId}/status`, { actor: "logistics", body: { status: "in_progress" } });
}

/**
 * Le lancement exige aussi des budgets et un solde carte carburant (hors sujet ici) :
 * on vérifie que plus aucun motif ne concerne les papiers du véhicule.
 */
function expectNoPaperError(res: { body: { message?: string } }) {
  expect(res.body.message ?? "").not.toMatch(/carte grise|assurance|visite technique|plaque|expir/i);
}

async function readyVehicleWithMission() {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const d = await driver();
  const created = await plannedMission({ vehicleId: vehicle.id, driverId: d.id });
  expect(created.status).toBe(201);
  return { vehicle, missionId: created.body.id as number };
}

describe("P3-2 lancement : un seul document retenu par type, une seule règle de date", () => {
  it("ancienne carte grise échue + nouvelle valide : lancement accepté", async () => {
    const { vehicle, missionId } = await readyVehicleWithMission();
    await addDoc(vehicle.id, "carte_grise", inDays(-400));
    await addDoc(vehicle.id, "carte_grise", inDays(300));
    await addDoc(vehicle.id, "carte_grise", inDays(-30));
    await addDoc(vehicle.id, "assurance", inDays(100));
    await addDoc(vehicle.id, "visite_technique", inDays(100));
    const res = await launch(missionId);
    expectNoPaperError(res);
  }, 60000);

  it("jour J : un papier qui expire aujourd'hui bloque, comme l'éligibilité", async () => {
    const { vehicle, missionId } = await readyVehicleWithMission();
    await addDoc(vehicle.id, "carte_grise", inDays(100));
    await addDoc(vehicle.id, "assurance", inDays(0));
    await addDoc(vehicle.id, "visite_technique", inDays(100));
    const res = await launch(missionId);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ssurance/);
  }, 60000);

  it("régularisation : nouvelle date future sur le document et le miroir, le lancement passe", async () => {
    const { vehicle, missionId } = await readyVehicleWithMission();
    await addDoc(vehicle.id, "carte_grise", inDays(100));
    await addDoc(vehicle.id, "assurance", inDays(-5));
    await addDoc(vehicle.id, "visite_technique", inDays(100));
    await db.update(vehicles).set({ insuranceExpiry: inDays(-5) }).where(eq(vehicles.id, vehicle.id));
    const refused = await launch(missionId);
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/ssurance/);

    await addDoc(vehicle.id, "assurance", inDays(365));
    await db.update(vehicles).set({ insuranceExpiry: inDays(365) }).where(eq(vehicles.id, vehicle.id));
    expectNoPaperError(await launch(missionId));
  }, 60000);
});

describe("P3-2 alertes papiers : chef de parc et idempotence", () => {
  it("un utilisateur logistics reçoit l'alerte à 30 jours, une seule malgré deux passages", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    await addDoc(vehicle.id, "assurance", inDays(12));
    await db.update(vehicles).set({ insuranceExpiry: inDays(12) }).where(eq(vehicles.id, vehicle.id));

    await (alertService as any).checkVehicleDocumentAlerts(await vehicleRow(vehicle.id));
    await (alertService as any).checkVehicleDocumentAlerts(await vehicleRow(vehicle.id));

    for (const actor of ["logistics", "atelier"] as const) {
      const rows = await db
        .select()
        .from(alerts)
        .where(
          and(
            eq(alerts.userId, session.userIdOf(actor)),
            like(alerts.link, `%vehicleId=${vehicle.id}&%`),
            eq(alerts.title, "Document expire bientôt"),
          ),
        );
      expect(rows).toHaveLength(1);
    }
  }, 60000);
});
