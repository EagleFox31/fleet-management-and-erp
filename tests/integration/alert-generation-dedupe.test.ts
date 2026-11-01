import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { alerts, suppliers } from "../../shared/schema";
import { db } from "../../server/db";
import { alertService } from "../../server/services/alert-service";
import { alertInboxService } from "../../server/services/alert-inbox-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * ALR1 : une génération planifiée rejouée ne double pas l'alerte.
 * ALR3 : l'événement temps réel ne vise que les destinataires du rôle.
 *
 * Générateur choisi : fiche fournisseur au nom seul (`checkIncompleteSupplierAlerts`),
 * destinataires admin + secretary. Le passage parcourt toute la base partagée : les
 * assertions portent sur le lien de la fiche de test et sur les comptes de test.
 */
const ids = createIdBag();
let supplierId = 0;
let link = "";
let adminId = 0;
let secretaryId = 0;
let technicianId = 0;
const spy = vi.fn();
const previous = (global as any).broadcastUpdate;

async function alertsOf(userId: number) {
  return db.select().from(alerts).where(and(eq(alerts.userId, userId), eq(alerts.link, link)));
}

beforeAll(async () => {
  const [admin, secretary, technician] = await Promise.all([
    createTestUser({ role: "admin" }),
    createTestUser({ role: "secretary" }),
    createTestUser({ role: "technician" }),
  ]);
  ids.userIds.push(admin.id, secretary.id, technician.id);
  [adminId, secretaryId, technicianId] = [admin.id, secretary.id, technician.id];

  const [supplier] = await db
    .insert(suppliers)
    .values({ name: uniqueTestToken("alr-supplier"), isActive: true })
    .returning();
  supplierId = supplier.id;
  ids.supplierIds.push(supplierId);
  link = `/procurement/suppliers/${supplierId}/edit`;
  (global as any).broadcastUpdate = spy;
}, 120000);

afterAll(async () => {
  (global as any).broadcastUpdate = previous;
  // Les comptes réels admin/secretary de la base ont aussi reçu l'alerte de la fiche de test.
  await db.delete(alerts).where(eq(alerts.link, link));
  await cleanupCreated(ids);
});

describe("ALR1 génération planifiée sans doublon", { timeout: 180000 }, () => {
  it("deux passages successifs : une seule alerte par destinataire", async () => {
    await alertService.checkIncompleteSupplierAlerts();
    await alertService.checkIncompleteSupplierAlerts();
    expect(await alertsOf(adminId)).toHaveLength(1);
    expect(await alertsOf(secretaryId)).toHaveLength(1);
  });

  it("ALR3 : alert_created part en scope user, vers les seuls destinataires du rôle", async () => {
    const events = spy.mock.calls
      .filter(([event, data]) => event === "alert_created" && data?.payload?.link === link)
      .map(([, data]) => data);
    const targets = events.flatMap((data) => {
      expect(data.scope.type).toBe("user");
      expect(data.scope.userIds).toEqual([data.payload.userId]);
      return data.scope.userIds as number[];
    });
    expect(targets).toContain(adminId);
    expect(targets).toContain(secretaryId);
    expect(targets).not.toContain(technicianId);
    // Un événement par alerte créée : le second passage n'a rien réémis.
    expect(targets.filter((id) => id === adminId)).toHaveLength(1);
    expect(await alertsOf(technicianId)).toHaveLength(0);
  });

  it("deux passages simultanés : toujours une seule alerte par destinataire", async () => {
    await db.delete(alerts).where(eq(alerts.link, link));
    await Promise.all([alertService.checkIncompleteSupplierAlerts(), alertService.checkIncompleteSupplierAlerts()]);
    expect(await alertsOf(adminId)).toHaveLength(1);
    expect(await alertsOf(secretaryId)).toHaveLength(1);
  });

  it("une alerte lue n'est pas recréée au passage suivant", async () => {
    await alertInboxService.markAllRead(adminId);
    await alertService.checkIncompleteSupplierAlerts();
    const rows = await alertsOf(adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0].isRead).toBe(true);
  });

  it("alerte non lue antérieure à la clé (dedupe_key NULL) : pas de doublon au déploiement", async () => {
    await db.delete(alerts).where(eq(alerts.link, link));
    await db.insert(alerts).values({
      userId: adminId,
      title: "Fiche fournisseur à compléter",
      message: "TEST alerte d'avant la clé",
      type: "procurement",
      priority: "medium",
      link,
    });
    await alertService.checkIncompleteSupplierAlerts();
    const rows = await alertsOf(adminId);
    expect(rows).toHaveLength(1);
    expect(rows[0].dedupeKey).toBeNull();
    expect(await alertsOf(secretaryId)).toHaveLength(1);
  });

  it("fiche complétée : plus de nouvelle alerte", async () => {
    await db.delete(alerts).where(inArray(alerts.userId, [adminId, secretaryId]));
    await db.update(suppliers).set({ email: "alr@example.test" }).where(eq(suppliers.id, supplierId));
    await alertService.checkIncompleteSupplierAlerts();
    expect(await alertsOf(adminId)).toHaveLength(0);
  });
});
