import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { alerts, drivers, notificationPreferences } from "../../shared/schema";
import { db } from "../../server/db";
import { alertService } from "../../server/services/alert-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";

/**
 * V5a : alertes d'échéance du permis, de la CNI et de la CPC des chauffeurs (J-30, J-7, échu),
 * adressées aux DRIVER_MANAGER_ROLES, sans doublon d'un passage à l'autre.
 */
const ids = createIdBag();
const driverIds: number[] = [];

// Hors préfixe TEST_ : le passage touche tous les destinataires réels, le ménage global des autres suites ne doit pas les emporter.
const own = () => Math.random().toString(36).slice(2, 10);
const ownUser = (role: "admin" | "logistics" | "secretary" | "workshop_manager") =>
  createTestUser({ role, username: `v5a-${own()}`, email: `v5a-${own()}@fleet.test` });

function dayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function addDriver(fields: Partial<typeof drivers.$inferInsert>) {
  const [row] = await db
    .insert(drivers)
    .values({ firstName: "V5a", lastName: `Chauffeur-${own()}`, isActive: true, ...fields })
    .returning();
  driverIds.push(row.id);
  return row;
}

async function alertsOf(userId: number, driverId: number) {
  const rows = await db.select().from(alerts).where(eq(alerts.userId, userId));
  return rows.filter((a) => a.dedupeKey?.includes(`:${driverId}:`));
}

afterEach(async () => {
  for (const id of driverIds) {
    await db.delete(alerts).where(like(alerts.dedupeKey, `driver_doc:%:${id}:%`));
  }
  if (driverIds.length > 0) await db.delete(drivers).where(inArray(drivers.id, driverIds));
  driverIds.length = 0;
  for (const userId of ids.userIds) {
    await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  }
  await cleanupCreated(ids);
  ids.userIds.length = 0;
});

describe("alertes d'échéance des papiers chauffeur (V5a)", { timeout: 120000 }, () => {
  it("J-30, J-7, échu : une alerte par papier chez admin, logistique et secrétaire, aucune ailleurs, aucune au second passage", async () => {
    const admin = await ownUser("admin");
    const logistics = await ownUser("logistics");
    const secretary = await ownUser("secretary");
    const other = await ownUser("workshop_manager");
    ids.userIds.push(admin.id, logistics.id, secretary.id, other.id);
    // Formation CPC il y a 731 + 3 jours : échue depuis 3 jours.
    const driver = await addDriver({
      licenseExpiry: dayOffset(30),
      cniExpiry: dayOffset(7),
      cpcTrainingDate: dayOffset(-(731 + 3)),
    });

    await alertService.checkDriverDocumentAlerts();
    for (const user of [admin, logistics, secretary]) {
      const mine = await alertsOf(user.id, driver.id);
      expect(mine).toHaveLength(3);
      const byKind = Object.fromEntries(mine.map((a) => [a.dedupeKey!.split(":")[1], a]));
      expect(byKind.license).toMatchObject({ priority: "medium", topic: "documents", link: `/drivers/${driver.id}` });
      expect(byKind.license.title).toContain("Permis de conduire à renouveler sous 30 jours");
      expect(byKind.cni).toMatchObject({ priority: "high" });
      expect(byKind.cpc).toMatchObject({ priority: "critical" });
      expect(byKind.cpc.title).toContain("Formation CPC expiré");
    }
    expect(await alertsOf(other.id, driver.id)).toHaveLength(0);

    // Second passage le même jour : aucune alerte de plus.
    await alertService.checkDriverDocumentAlerts();
    expect(await alertsOf(admin.id, driver.id)).toHaveLength(3);
    expect(await alertsOf(logistics.id, driver.id)).toHaveLength(3);
    expect(await alertsOf(secretary.id, driver.id)).toHaveLength(3);
  });

  it("une alerte lue ne revient pas, une non lue ne masque pas le palier suivant ; chaque palier (J-30, J-7, échu) crée sa propre alerte", async () => {
    const admin = await ownUser("admin");
    ids.userIds.push(admin.id);
    const driver = await addDriver({ licenseExpiry: "2026-12-05" });

    await alertService.checkDriverDocumentAlerts(new Date("2026-11-10T08:00:00Z"));
    const [first] = await alertsOf(admin.id, driver.id);
    expect(first.dedupeKey).toBe(`driver_doc:license:j30:${driver.id}:2026-12-05`);
    await db.update(alerts).set({ isRead: true }).where(eq(alerts.id, first.id));

    await alertService.checkDriverDocumentAlerts(new Date("2026-11-12T08:00:00Z"));
    expect(await alertsOf(admin.id, driver.id), "alerte lue : pas de retour").toHaveLength(1);

    await alertService.checkDriverDocumentAlerts(new Date("2026-11-30T08:00:00Z"));
    const keys = (await alertsOf(admin.id, driver.id)).map((a) => a.dedupeKey).sort();
    expect(keys).toEqual([
      `driver_doc:license:j30:${driver.id}:2026-12-05`,
      `driver_doc:license:j7:${driver.id}:2026-12-05`,
    ]);

    await alertService.checkDriverDocumentAlerts(new Date("2026-12-07T08:00:00Z"));
    expect(await alertsOf(admin.id, driver.id)).toHaveLength(3);
  });

  it("chauffeur inactif, papiers lointains ou absents : aucune alerte", async () => {
    const admin = await ownUser("admin");
    ids.userIds.push(admin.id);
    const inactive = await addDriver({ licenseExpiry: dayOffset(2), isActive: false });
    const far = await addDriver({ licenseExpiry: dayOffset(90), cniExpiry: dayOffset(31) });
    const empty = await addDriver({});
    await alertService.checkDriverDocumentAlerts();
    for (const d of [inactive, far, empty]) expect(await alertsOf(admin.id, d.id)).toHaveLength(0);
  });
});
