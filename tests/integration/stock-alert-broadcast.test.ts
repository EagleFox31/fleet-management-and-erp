import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { alerts, parts, partsStockMovements, users } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser } from "../support/factories";

/**
 * Alerte de stock bas après un mouvement (`storage.recordStockMovement`), niveau I.
 *
 * Destinataires : tous les admins et magasiniers (décision du 3 novembre 2026), une alerte
 * nominative et une trame `alert_created` chacun, sans doublon non lu par destinataire.
 * Dans une transaction, l'alerte est créée après le commit (afterCommit) : un échec de
 * l'alerte n'annule pas le mouvement, une transaction annulée n'emporte aucune alerte.
 *
 * Seuil : minimum 5, alerte à 6 ; un stock de 6 qui descend à 4 franchit le minimum.
 */

const ids = createIdBag();
const spy = vi.fn();
const previous = (global as any).broadcastUpdate;
let warehouseId = 0;

const alertsOf = (partId: number) => db.select().from(alerts).where(eq(alerts.link, `/warehouse/parts/${partId}`));
const alertFrames = () => spy.mock.calls.filter(([event]) => event === "alert_created").map(([, frame]) => frame);

async function partAtThreshold() {
  const part = await createTestPart({ quantity: 6, minQuantity: 5 });
  ids.partIds.push(part.id);
  return part;
}

beforeAll(async () => {
  (global as any).broadcastUpdate = spy;
  const warehouse = await createTestUser({ role: "warehouse" });
  ids.userIds.push(warehouse.id);
  warehouseId = warehouse.id;
});

beforeEach(() => spy.mockClear());

afterAll(async () => {
  (global as any).broadcastUpdate = previous;
  if (ids.partIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.link, ids.partIds.map((id) => `/warehouse/parts/${id}`)));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

describe("alerte de stock bas : admins et magasiniers", { timeout: 120000 }, () => {
  it("hors transaction : une alerte et une trame nominatives par admin et magasinier", async () => {
    const part = await partAtThreshold();

    await storage.recordStockMovement(part.id, "out", 2, undefined, "TEST sortie");

    const stored = await alertsOf(part.id);
    expect(stored.map((alert) => alert.userId)).toContain(warehouseId);
    expect(stored.every((alert) => alert.priority === "high")).toBe(true);
    const recipients = await db
      .select({ role: users.role })
      .from(users)
      .where(inArray(users.id, stored.flatMap((alert) => (alert.userId === null ? [] : [alert.userId]))));
    expect(recipients.every((r) => r.role === "admin" || r.role === "warehouse")).toBe(true);

    const frames = alertFrames();
    expect(frames.map((frame) => frame.entityId).sort()).toEqual(stored.map((alert) => alert.id).sort());
    for (const frame of frames) {
      const alert = stored.find((a) => a.id === frame.entityId)!;
      expect(frame.scope).toEqual({ type: "user", userIds: [alert.userId] });
    }
  });

  it("pas de doublon non lu par destinataire : même palier, une seule alerte", async () => {
    const part = await partAtThreshold();

    await storage.recordStockMovement(part.id, "out", 2, undefined, "TEST sortie"); // 6 -> 4 : Stock Bas
    await storage.recordStockMovement(part.id, "out", 1, undefined, "TEST sortie"); // 4 -> 3 : Stock Critique
    await storage.recordStockMovement(part.id, "out", 1, undefined, "TEST sortie"); // 3 -> 2 : Stock Critique, doublon

    const mine = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.link, `/warehouse/parts/${part.id}`), eq(alerts.userId, warehouseId)));
    expect(mine.map((alert) => alert.title).sort()).toEqual(["Stock Bas", "Stock Critique"]);
  });

  it("dans une transaction : rien avant le commit, l'alerte après (afterCommit)", async () => {
    const part = await partAtThreshold();
    const effects: Array<() => void | Promise<void>> = [];

    await db.transaction(async (tx) => {
      await storage.recordStockMovement(part.id, "out", 2, undefined, "TEST sortie", undefined, {
        executor: tx,
        afterCommit: (effect) => effects.push(effect),
      });
    });
    expect(await alertsOf(part.id)).toHaveLength(0);
    expect(alertFrames()).toHaveLength(0);

    expect(effects).toHaveLength(1);
    for (const effect of effects) await effect();
    const stored = await alertsOf(part.id);
    expect(stored.map((alert) => alert.userId)).toContain(warehouseId);
    expect(alertFrames().map((frame) => frame.entityId).sort()).toEqual(stored.map((alert) => alert.id).sort());
  });

  it("une transaction annulée n'emporte ni alerte ni trame", async () => {
    const part = await partAtThreshold();
    const effects: Array<() => void | Promise<void>> = [];

    await expect(
      db.transaction(async (tx) => {
        await storage.recordStockMovement(part.id, "out", 2, undefined, "TEST sortie", undefined, {
          executor: tx,
          afterCommit: (effect) => effects.push(effect),
        });
        throw new Error("annulation de test");
      }),
    ).rejects.toThrow("annulation de test");

    expect(await alertsOf(part.id)).toHaveLength(0);
    expect(alertFrames()).toHaveLength(0);
  });

  it("un échec d'écriture de l'alerte n'annule pas le mouvement", async () => {
    const part = await partAtThreshold();
    const fn = `test_fail_alert_${part.id}`;
    // Déclencheur limité à la pièce de ce test : n'affecte pas les autres sessions.
    await db.execute(
      sql.raw(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.link = '/warehouse/parts/${part.id}' THEN RAISE EXCEPTION 'alerte refusée (test)'; END IF;
          RETURN NEW;
        END $$`),
    );
    await db.execute(sql.raw(`CREATE TRIGGER ${fn} BEFORE INSERT ON alerts FOR EACH ROW EXECUTE FUNCTION ${fn}()`));
    try {
      const effects: Array<() => void | Promise<void>> = [];
      await db.transaction(async (tx) => {
        await storage.recordStockMovement(part.id, "out", 2, undefined, "TEST sortie", undefined, {
          executor: tx,
          afterCommit: (effect) => effects.push(effect),
        });
      });
      for (const effect of effects) await effect();

      const [after] = await db.select().from(parts).where(eq(parts.id, part.id));
      expect(after.quantity).toBe(4);
      const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, part.id));
      expect(movements).toHaveLength(1);
      expect(await alertsOf(part.id)).toHaveLength(0);
      expect(alertFrames()).toHaveLength(0);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${fn} ON alerts`));
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${fn}()`));
    }
  });
});
