import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { alerts, partsStockMovements } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart } from "../support/factories";

/**
 * Alerte de stock bas après un mouvement (`storage.recordStockMovement`), niveau I.
 *
 * L'alerte était écrite en base sans trame `alert_created` : la cloche des autres profils
 * ne la voyait qu'au prochain rafraîchissement. Dans une transaction, elle était écrite
 * hors de celle-ci et survivait à son annulation.
 *
 * Seuil : minimum 5, alerte à 6 ; un stock de 6 qui descend à 4 franchit le minimum.
 */

const ids = createIdBag();
const spy = vi.fn();
const previous = (global as any).broadcastUpdate;

const alertsOf = (partId: number) => db.select().from(alerts).where(eq(alerts.link, `/warehouse/parts/${partId}`));
const alertFrames = () => spy.mock.calls.filter(([event]) => event === "alert_created");

async function partAtThreshold() {
  const part = await createTestPart({ quantity: 6, minQuantity: 5 });
  ids.partIds.push(part.id);
  return part;
}

beforeAll(() => {
  (global as any).broadcastUpdate = spy;
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

describe("alerte de stock bas : trame alert_created", { timeout: 120000 }, () => {
  it("hors transaction, l'alerte écrite est diffusée à son destinataire", async () => {
    const part = await partAtThreshold();

    await storage.recordStockMovement(part.id, "out", 2, undefined, "TEST sortie");

    const [alert] = await alertsOf(part.id);
    expect(alert?.priority).toBe("high");
    const frames = alertFrames();
    expect(frames).toHaveLength(1);
    const [, frame] = frames[0];
    expect(frame.entityId).toBe(alert.id);
    expect(frame.payload).toMatchObject({ alertId: alert.id, link: `/warehouse/parts/${part.id}` });
    expect(frame.scope).toEqual({ type: "user", userIds: [alert.userId] });
  });

  it("dans une transaction, la trame attend le commit (afterCommit)", async () => {
    const part = await partAtThreshold();
    const effects: Array<() => void> = [];

    await db.transaction(async (tx) => {
      await storage.recordStockMovement(part.id, "out", 2, undefined, "TEST sortie", undefined, {
        executor: tx,
        afterCommit: (effect) => effects.push(effect),
      });
      expect(alertFrames()).toHaveLength(0);
    });

    expect(effects).toHaveLength(1);
    effects.forEach((effect) => effect());
    const [alert] = await alertsOf(part.id);
    expect(alertFrames().map(([, frame]) => frame.entityId)).toEqual([alert.id]);
  });

  it("une transaction annulée n'emporte ni alerte ni trame", async () => {
    const part = await partAtThreshold();
    const effects: Array<() => void> = [];

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

  it("dans une transaction sans afterCommit, rien n'est diffusé", async () => {
    const part = await partAtThreshold();

    await db.transaction((tx) =>
      storage.recordStockMovement(part.id, "out", 2, undefined, "TEST sortie", undefined, { executor: tx }),
    );

    expect(await alertsOf(part.id)).toHaveLength(1);
    expect(alertFrames()).toHaveLength(0);
  });
});
