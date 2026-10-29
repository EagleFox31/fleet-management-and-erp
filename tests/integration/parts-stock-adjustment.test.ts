import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partsService } from "../../server/services/parts-service";
import { parts, partsStockMovements } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser } from "../support/factories";

/**
 * Ajustement manuel de stock (`partsService.updateStock`), niveau I.
 *
 * Le stock était lu puis réécrit sans verrou : deux ajustements simultanés de +3
 * sur 10 écrivaient tous deux 13 et traçaient deux mouvements « 10 -> 13 ».
 * L'historique disait +6, le stock +3. Un retrait au-delà du stock était
 * ramené à 0 en silence, avec un mouvement qui mentait sur la quantité sortie.
 */

const ids = createIdBag();

afterAll(async () => {
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

async function setup(quantity: number) {
  const warehouse = await createTestUser({ role: "warehouse" });
  ids.userIds.push(warehouse.id);
  const part = await createTestPart({ quantity });
  ids.partIds.push(part.id);
  return { warehouse, part };
}

async function stateOf(partId: number) {
  const [part] = await db.select().from(parts).where(eq(parts.id, partId));
  const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, partId));
  return { quantity: part.quantity, movements };
}

describe("PartsService.updateStock", { timeout: 120000 }, () => {
  it("des ajustements simultanés s'additionnent et tracent une chaîne cohérente", async () => {
    const { warehouse, part } = await setup(10);

    // Cinq appels plutôt que deux : la course est réelle mais sa détection dépend du
    // timing réseau ; à deux appels, l'ancien code passait parfois.
    await Promise.all(
      Array.from({ length: 5 }, () => partsService.updateStock(part.id, 1, "TEST ajustement", warehouse.id)),
    );

    const state = await stateOf(part.id);
    expect(state.quantity).toBe(15);
    const chain = state.movements
      .map((m) => [m.previousStock, m.newStock])
      .sort((x, y) => x[0] - y[0]);
    expect(chain).toEqual([[10, 11], [11, 12], [12, 13], [13, 14], [14, 15]]);
  });

  it("un retrait au-delà du stock est refusé (409), stock et historique intacts", async () => {
    const { warehouse, part } = await setup(5);

    await expect(partsService.updateStock(part.id, -8, "TEST retrait", warehouse.id)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("5"),
    });

    const state = await stateOf(part.id);
    expect(state.quantity).toBe(5);
    expect(state.movements).toHaveLength(0);
  });

  it("un retrait égal au stock le vide et trace la quantité réellement sortie", async () => {
    const { warehouse, part } = await setup(5);

    const updated = await partsService.updateStock(part.id, -5, "TEST retrait", warehouse.id);

    expect(updated.quantity).toBe(0);
    expect(updated.updatedBy).toBe(warehouse.id);
    const state = await stateOf(part.id);
    expect(state.movements).toMatchObject([
      { movementType: "out", quantity: 5, previousStock: 5, newStock: 0, createdBy: warehouse.id },
    ]);
  });

  it.each([0, 1.5, Number.NaN])("ajustement %s : refusé (400) sans écriture", async (adjustment) => {
    const { warehouse, part } = await setup(5);

    await expect(partsService.updateStock(part.id, adjustment, "TEST", warehouse.id)).rejects.toMatchObject({ status: 400 });

    expect((await stateOf(part.id)).movements).toHaveLength(0);
  });

  it("pièce inexistante : 404", async () => {
    await expect(partsService.updateStock(-1, 3, "TEST", undefined)).rejects.toMatchObject({ status: 404 });
  });
});
