import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { alerts, notificationPreferences, vehicleDocuments } from "../../shared/schema";
import { db } from "../../server/db";
import { alertService } from "../../server/services/alert-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";

const ids = createIdBag();
const docIds: number[] = [];

// Hors préfixe TEST_: ce passage est long (tous les destinataires réels) et le
// ménage global des autres suites supprimerait des comptes en plein cycle.
const own = () => Math.random().toString(36).slice(2, 10);
const ownUser = (role: "workshop_manager") =>
  createTestUser({ role, username: `t17a-${own()}`, email: `t17a-${own()}@fleet.test` });
const ownVehicle = () => createTestVehicle({ registrationNumber: `T17A-${own()}` });

function dayOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function addDoc(vehicleId: number, type: string, expiryDate: string) {
  const [row] = await db
    .insert(vehicleDocuments)
    .values({
      vehicleId,
      name: `doc-${type}-${expiryDate}`,
      type: type as never,
      filename: "x.pdf",
      filesize: 1,
      fileType: "application/pdf",
      filePath: "uploads/x.pdf",
      expiryDate,
    })
    .returning();
  docIds.push(row.id);
  return row;
}

afterEach(async () => {
  for (const id of docIds) {
    await db.delete(alerts).where(like(alerts.dedupeKey, `doc_expiry:%:${id}:%`));
  }
  docIds.length = 0;
  for (const userId of ids.userIds) {
    await db.delete(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  }
  await cleanupCreated(ids);
  ids.userIds.length = 0;
  ids.vehicleIds.length = 0;
});

describe("alertes d'échéance des documents typés (T-17a)", () => {
  it("alerte à J+30 et échu, ni J+31 ni type sans échéance, sans doublon au second passage, thème respecté", async () => {
    const a = await ownUser("workshop_manager");
    const b = await ownUser("workshop_manager");
    ids.userIds.push(a.id, b.id);
    await db.insert(notificationPreferences).values({ userId: b.id, topic: "documents", inApp: false, email: false });
    const vehicle = await ownVehicle();
    ids.vehicleIds.push(vehicle.id);

    const due = await addDoc(vehicle.id, "visite_technique", dayOffset(30));
    const far = await addDoc(vehicle.id, "assurance", dayOffset(31));
    const noExpiryType = await addDoc(vehicle.id, "taxe", dayOffset(5));
    const expired = await addDoc(vehicle.id, "carte_grise", dayOffset(-3));

    await alertService.checkTypedDocumentExpiryAlerts();
    await alertService.checkTypedDocumentExpiryAlerts();

    const keysOf = async (userId: number) =>
      (await db.select().from(alerts).where(eq(alerts.userId, userId)))
        .map((r) => r.dedupeKey)
        .filter((k): k is string => !!k && docIds.some((id) => k.includes(`:${id}:`)))
        .sort();

    const mine = await keysOf(a.id);
    expect(mine).toEqual(
      [
        `doc_expiry:due:${due.id}:${dayOffset(30)}`,
        `doc_expiry:expired:${expired.id}:${dayOffset(-3)}`,
      ].sort(),
    );
    expect(mine.some((k) => k.includes(`:${far.id}:`) || k.includes(`:${noExpiryType.id}:`))).toBe(false);

    const rows = await db.select().from(alerts).where(eq(alerts.userId, a.id));
    expect(rows.filter((r) => r.topic === "documents" && docIds.some((id) => r.dedupeKey?.includes(`:${id}:`))).length).toBe(2);
    expect(await keysOf(b.id)).toEqual([]);
  }, 90_000);

  it("une alerte lue n'est pas recréée au passage suivant", async () => {
    const a = await ownUser("workshop_manager");
    ids.userIds.push(a.id);
    const vehicle = await ownVehicle();
    ids.vehicleIds.push(vehicle.id);
    const doc = await addDoc(vehicle.id, "tae", dayOffset(10));

    await alertService.checkTypedDocumentExpiryAlerts();
    await db.update(alerts).set({ isRead: true }).where(inArray(alerts.userId, [a.id]));
    await alertService.checkTypedDocumentExpiryAlerts();

    const rows = await db.select().from(alerts).where(eq(alerts.userId, a.id));
    expect(rows.filter((r) => r.dedupeKey?.includes(`:${doc.id}:`)).length).toBe(1);
  }, 90_000);
});
