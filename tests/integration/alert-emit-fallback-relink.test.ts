import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { alerts } from "../../shared/schema";
import { db, pool } from "../../server/db";
import { relinkLegacyFuelAlerts } from "../../server/init-database";
import { alertService, emitLossContext, isConnectionError, MAX_CONSECUTIVE_RETRY_FAILURES } from "../../server/services/alert-service";
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

describe("emitAlerts : coupe-circuit sur la reprise", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    type: "fuel",
    title: `T${i}`,
    message: "m",
    priority: "medium",
    link: `/x/${i}`,
    targetUserIds: [1],
  }));

  async function attempts(error: Error): Promise<{ created: number; calls: number }> {
    const service = alertService as any;
    const spy = vi.spyOn(service, "emitAlertBatch").mockRejectedValue(error);
    try {
      const created = await service.emitAlerts(candidates);
      return { created, calls: spy.mock.calls.length };
    } finally {
      spy.mockRestore();
    }
  }

  it("base qui tombe en série : au plus 3 reprises, pas une par candidate", async () => {
    const result = await attempts(new Error("échec"));
    expect(MAX_CONSECUTIVE_RETRY_FAILURES).toBe(3);
    expect(result).toEqual({ created: 0, calls: 1 + MAX_CONSECUTIVE_RETRY_FAILURES });
  });

  it("lot entier en échec sur une erreur de connexion : aucune reprise unitaire", async () => {
    const result = await attempts(Object.assign(new Error("connexion refusée"), { code: "ECONNREFUSED" }));
    expect(result).toEqual({ created: 0, calls: 1 });
  });

  it("erreur de connexion en cours de reprise : arrêt dès cette reprise", async () => {
    const service = alertService as any;
    const spy = vi
      .spyOn(service, "emitAlertBatch")
      .mockRejectedValueOnce(new Error("lot en échec"))
      .mockRejectedValue(Object.assign(new Error("connexion perdue"), { code: "ECONNRESET" }));
    try {
      expect(await service.emitAlerts(candidates)).toBe(0);
      expect(spy.mock.calls.length).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("récapitulatif : échantillons de 5 au plus, échouées et abandonnées", () => {
    const err = new Error("x");
    const brief = (list: typeof candidates) => list.map((c) => ({ title: c.title, type: c.type }));
    expect(emitLossContext(err, candidates, [], 0)).toMatchObject({
      failed: 0, abandoned: 10, lost: 10, candidates: 10, sample: [], abandonedSample: brief(candidates.slice(0, 5)),
    });
    expect(emitLossContext(err, candidates, candidates.slice(0, 1), 1)).toMatchObject({
      failed: 1, abandoned: 9, lost: 10, sample: brief(candidates.slice(0, 1)), abandonedSample: brief(candidates.slice(1, 6)),
    });
    expect(emitLossContext(err, candidates, candidates.slice(0, 3), 10)).toMatchObject({
      failed: 3, abandoned: 0, lost: 3, abandonedSample: [],
    });
  });

  it("reconnaît les erreurs de connexion, y compris enveloppées", () => {
    expect(isConnectionError(Object.assign(new Error(), { code: "57P01" }))).toBe(true);
    expect(isConnectionError(Object.assign(new Error(), { code: "08006" }))).toBe(true);
    expect(isConnectionError(new Error("requête", { cause: Object.assign(new Error(), { code: "ECONNRESET" }) }))).toBe(true);
    expect(isConnectionError(Object.assign(new Error(), { code: "23505" }))).toBe(false);
    expect(isConnectionError(new Error("sans code"))).toBe(false);
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
