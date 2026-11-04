import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like, or } from "drizzle-orm";
import { alerts, alertRecipientSettings, fuelRecords, maintenanceSchedules, vehicles } from "../../shared/schema";
import { db, pool } from "../../server/db";
import { alertService } from "../../server/services/alert-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";

/**
 * #281 : un passage du cycle d'alertes fait un nombre de requêtes indépendant du nombre
 * de véhicules. L'original faisait plusieurs requêtes par véhicule (plannings, historique
 * carburant, liens de renouvellement) et rechargeait toutes les alertes de chaque
 * destinataire pour chaque alerte candidate.
 *
 * Mesure : requêtes passées par le pool (`pool.query`, emprunté par Drizzle), pendant un
 * passage où des véhicules neufs déclenchent chacun les mêmes alertes. Un passage sur
 * 2 véhicules neufs et un passage sur 10 véhicules neufs doivent coûter pareil.
 */
const ids = createIdBag();
const plates: string[] = [];
let adminId = 0;
let logisticsId = 0;
let originalFuelRoles: string[] | null = null;

/** Véhicule qui déclenche : maintenance en retard, assurance expirée, kilométrage dépassé,
 *  planning échu et consommation carburant anormale. */
async function triggeringVehicle(): Promise<number> {
  const vehicle = await createTestVehicle({ mileage: 120000 });
  ids.vehicleIds.push(vehicle.id);
  plates.push(vehicle.registrationNumber);
  await db
    .update(vehicles)
    .set({ nextMaintenanceDate: "2026-01-10", insuranceExpiry: "2026-01-10", nextMaintenanceMileage: 110000 })
    .where(eq(vehicles.id, vehicle.id));
  await db.insert(maintenanceSchedules).values({
    vehicleId: vehicle.id,
    title: `Vidange ${vehicle.registrationNumber}`,
    scheduledDate: "2026-01-15",
    frequency: "monthly",
    frequencyValue: 1,
    isActive: true,
  } as typeof maintenanceSchedules.$inferInsert);
  // Huit intervalles à 8 L/100 km puis trois à 16 : moyenne récente bien au-delà de +20 %.
  const liters = [40, 40, 40, 40, 40, 40, 40, 40, 40, 80, 80, 80];
  const rows = liters.map((quantity, i) => ({
    vehicleId: vehicle.id,
    date: `2026-0${1 + Math.floor(i / 4)}-${String(1 + (i % 4) * 7).padStart(2, "0")}`,
    mileage: 100000 + i * 500,
    quantity,
    cost: "1000",
  }));
  const inserted = await db.insert(fuelRecords).values(rows as never).returning({ id: fuelRecords.id });
  ids.fuelRecordIds.push(...inserted.map((r) => r.id));
  return vehicle.id;
}

async function countedPass(): Promise<number> {
  const spy = vi.spyOn(pool, "query");
  try {
    await alertService.runAllAlertChecks();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

function alertsOfTestVehicles() {
  return db
    .select({ userId: alerts.userId, title: alerts.title, message: alerts.message })
    .from(alerts)
    .where(or(...plates.map((plate) => like(alerts.message, `%${plate}%`))));
}

beforeAll(async () => {
  const [admin, logistics] = await Promise.all([createTestUser({ role: "admin" }), createTestUser({ role: "logistics" })]);
  ids.userIds.push(admin.id, logistics.id);
  [adminId, logisticsId] = [admin.id, logistics.id];
  const [setting] = await db
    .select({ roles: alertRecipientSettings.recipientRoles })
    .from(alertRecipientSettings)
    .where(eq(alertRecipientSettings.alertType, "fuel"));
  originalFuelRoles = setting?.roles ?? null;
  // Une passe à vide d'abord : l'existant de la base partagée est émis une fois pour toutes.
  await alertService.runAllAlertChecks();
}, 180000);

afterAll(async () => {
  if (originalFuelRoles) {
    await db
      .update(alertRecipientSettings)
      .set({ recipientRoles: originalFuelRoles })
      .where(eq(alertRecipientSettings.alertType, "fuel"));
  }
  if (plates.length > 0) {
    await db.delete(alerts).where(or(...plates.map((plate) => like(alerts.message, `%${plate}%`))));
  }
  await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
  if (ids.vehicleIds.length > 0) {
    await db.delete(maintenanceSchedules).where(inArray(maintenanceSchedules.vehicleId, ids.vehicleIds));
  }
  await cleanupCreated(ids);
}, 180000);

describe("cycle d'alertes : requêtes bornées (#281)", { timeout: 300000 }, () => {
  it("2 puis 10 véhicules neufs : même nombre de requêtes, et chaque véhicule est alerté", async () => {
    for (let i = 0; i < 2; i++) await triggeringVehicle();
    const small = await countedPass();

    for (let i = 0; i < 10; i++) await triggeringVehicle();
    const large = await countedPass();

    expect(large).toBe(small);
    expect(small).toBeLessThanOrEqual(40);

    const created = await alertsOfTestVehicles();
    for (const plate of plates) {
      const mine = created.filter((a) => a.message.includes(plate));
      const titles = new Set(mine.filter((a) => a.userId === adminId).map((a) => a.title));
      expect([...titles].sort(), plate).toEqual(
        expect.arrayContaining([
          "Consommation carburant élevée",
          "Document expiré",
          "Kilométrage de maintenance dépassé",
          "Maintenance en retard",
          "Maintenance préventive programmée due",
        ]),
      );
      expect(mine.some((a) => a.userId === logisticsId && a.title === "Consommation carburant élevée"), plate).toBe(true);
      // Réserve 3 de #287 : le trigger a déjà alerté (même type, titre et lien) ; le cycle
      // n'ajoute pas sa propre alerte, reconnaissable à son message sans « L/100 km ».
      expect(mine.filter((a) => a.title === "Consommation carburant élevée" && a.message.endsWith("vs moyenne")), plate).toEqual([]);
    }
  });

  it("passage rejoué : aucune nouvelle alerte (dédoublonnage par clé et par non lue)", async () => {
    const before = (await alertsOfTestVehicles()).length;
    await alertService.runAllAlertChecks();
    expect((await alertsOfTestVehicles()).length).toBe(before);
  });

  it("une alerte lue n'est pas recréée le même jour (clé quotidienne)", async () => {
    await db
      .update(alerts)
      .set({ isRead: true })
      .where(and(eq(alerts.userId, adminId), like(alerts.message, `%${plates[0]}%`)));
    const before = (await alertsOfTestVehicles()).length;
    await alertService.runAllAlertChecks();
    expect((await alertsOfTestVehicles()).length).toBe(before);
  });

  it("destinataires carburant lus dans alert_recipient_settings", async () => {
    await db
      .update(alertRecipientSettings)
      .set({ recipientRoles: ["logistics"] })
      .where(eq(alertRecipientSettings.alertType, "fuel"));
    expect(await alertService.fuelRecipientRoles()).toEqual(["logistics"]);

    await db
      .update(alertRecipientSettings)
      .set({ recipientRoles: ["client", "driver"] })
      .where(eq(alertRecipientSettings.alertType, "fuel"));
    // Aucun rôle destinataire valable : repli sur la valeur par défaut, jamais personne.
    expect(await alertService.fuelRecipientRoles()).toEqual(["admin", "logistics"]);
  });
});
