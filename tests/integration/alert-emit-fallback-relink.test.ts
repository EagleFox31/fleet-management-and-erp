import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { alerts } from "../../shared/schema";
import { db, pool } from "../../server/db";
import { relinkLegacyFuelAlerts } from "../../server/init-database";
import { alertService } from "../../server/services/alert-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/** Relecture de #297 : repli par objet d'emitAlerts, et reprise des liens /vehicles/<id>/fuel. */
const ids = createIdBag();
let userId = 0;
const quiet = { info: () => undefined };

beforeAll(async () => {
  const user = await createTestUser({ role: "logistics" });
  ids.userIds.push(user.id);
  userId = user.id;
});

afterAll(async () => {
  vi.restoreAllMocks();
  await cleanupCreated(ids);
});

describe("emitAlerts : un lot en échec ne perd pas toutes les candidates", { timeout: 60_000 }, () => {
  it("échec du lot : reprise objet par objet, seule la candidate fautive est perdue", async () => {
    const token = uniqueTestToken("emit");
    const service = alertService as any;
    const real = service.usersByRole.bind(service);
    // Le lot échoue sur sa première lecture ; en reprise, seule la candidate « fautive »
    // (rôle inconnu) échoue encore.
    const spy = vi.spyOn(service, "usersByRole").mockImplementation(async (...args: unknown[]) => {
      const roles = args[0] as string[];
      if (spy.mock.calls.length === 1 || roles.includes("boom")) throw new Error("lecture des destinataires en échec");
      return real(roles);
    });
    try {
      const created = await service.emitAlerts([
        { type: "fuel", title: `A ${token}`, message: "a", priority: "medium", link: `/x/${token}/a`, targetUserIds: [userId] },
        { type: "fuel", title: `B ${token}`, message: "b", priority: "medium", link: `/x/${token}/b`, targetRoles: ["boom"] },
        { type: "fuel", title: `C ${token}`, message: "c", priority: "medium", link: `/x/${token}/c`, targetUserIds: [userId] },
      ]);
      expect(created).toBe(2);
      const rows = await db.select({ title: alerts.title }).from(alerts).where(inArray(alerts.userId, [userId]));
      expect(rows.map((r) => r.title).sort()).toEqual([`A ${token}`, `C ${token}`]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("relinkLegacyFuelAlerts", { timeout: 60_000 }, () => {
  it("réécrit /vehicles/<id>/fuel en /vehicles/<id> ; second passage : 0 écriture", async () => {
    const token = uniqueTestToken("relink");
    const inserted = await db
      .insert(alerts)
      .values(
        ["/vehicles/901/fuel", "/vehicles/902/fuel", "/vehicles/903", "/vehicles/904/fuel-cards", "/work-orders/5/fuel"].map((link) => ({
          userId,
          title: `Lien ${token}`,
          message: link,
          type: "fuel",
          priority: "medium",
          link,
        })) as (typeof alerts.$inferInsert)[],
      )
      .returning({ id: alerts.id });

    expect(await relinkLegacyFuelAlerts(pool, quiet)).toBeGreaterThanOrEqual(2);
    const rows = await db.select({ message: alerts.message, link: alerts.link }).from(alerts).where(inArray(alerts.id, inserted.map((r) => r.id)));
    const byOrigin = Object.fromEntries(rows.map((r) => [r.message, r.link]));
    expect(byOrigin).toEqual({
      "/vehicles/901/fuel": "/vehicles/901",
      "/vehicles/902/fuel": "/vehicles/902",
      "/vehicles/903": "/vehicles/903",
      "/vehicles/904/fuel-cards": "/vehicles/904/fuel-cards",
      "/work-orders/5/fuel": "/work-orders/5/fuel",
    });

    expect(await relinkLegacyFuelAlerts(pool, quiet)).toBe(0);
  });
});
