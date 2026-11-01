import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partsService } from "../../server/services/parts-service";
import { tiresService } from "../../server/services/tires-service-simplified";
import { parts, partsStockMovements, tires } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * T5, niveau I : traçabilité des fiches `parts` et `tires` (AGENTS.md §5).
 * Création : `created_by` = `updated_by` = l'auteur. Chaque modification (fiche, ajustement
 * de stock, suppression douce d'un pneu) : `updated_by` = l'auteur de CE geste,
 * `created_by` et `created_at` inchangés, `updated_at` avancé.
 * Trois utilisateurs distincts : un test à un seul compte ne verrait pas une colonne copiée.
 */

const ids = createIdBag();
const tireIds: number[] = [];

afterAll(async () => {
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  if (tireIds.length > 0) await db.delete(tires).where(inArray(tires.id, tireIds));
  await cleanupCreated(ids);
});

async function actors() {
  const [creator, editor, third] = await Promise.all(
    (["warehouse", "admin", "workshop_manager"] as const).map((role) => createTestUser({ role })),
  );
  ids.userIds.push(creator.id, editor.id, third.id);
  return { creator, editor, third };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("T5 : audit des fiches pièce", { timeout: 120000 }, () => {
  async function newPart(createdBy: number) {
    const token = uniqueTestToken("part-audit");
    const part = await partsService.createPart(
      { name: token, reference: token, quantity: 10, minQuantity: 2, unit: "pièce", unitPrice: "1000.00", category: "TEST", location: "TEST-A1" } as any,
      createdBy,
    );
    ids.partIds.push(part.id);
    return part;
  }

  it("création : created_by = updated_by = l'auteur, deux horodatages posés", async () => {
    const { creator } = await actors();
    const part = await newPart(creator.id);
    const [row] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(row.createdBy).toBe(creator.id);
    expect(row.updatedBy).toBe(creator.id);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("modification : updated_by passe à l'éditeur, created_by et created_at ne bougent pas", async () => {
    const { creator, editor } = await actors();
    const part = await newPart(creator.id);
    const [before] = await db.select().from(parts).where(eq(parts.id, part.id));
    await pause();

    await partsService.updatePart(part.id, { location: "TEST-B2" }, editor.id);

    const [after] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(after.location).toBe("TEST-B2");
    expect(after.updatedBy).toBe(editor.id);
    expect(after.createdBy).toBe(creator.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedAt!.getTime()).toBeGreaterThan(before.updatedAt!.getTime());
  });

  it("ajustement de stock : updated_by = l'auteur de l'ajustement, created_by inchangé", async () => {
    const { creator, editor, third } = await actors();
    const part = await newPart(creator.id);
    await partsService.updatePart(part.id, { location: "TEST-C3" }, editor.id);
    await partsService.updateStock(part.id, 5, "TEST ajustement", third.id);

    const [after] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(after.quantity).toBe(15);
    expect(after.updatedBy).toBe(third.id);
    expect(after.createdBy).toBe(creator.id);
    const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, part.id));
    // La création écrit le mouvement d'entrée initial (créateur), l'ajustement le suivant (auteur de l'ajustement).
    expect(movements.map((m) => m.createdBy).sort()).toEqual([creator.id, third.id].sort());
  });

  it("lecture : les noms de l'auteur et du dernier éditeur sont joints", async () => {
    const { creator, editor } = await actors();
    const part = await newPart(creator.id);
    await partsService.updatePart(part.id, { location: "TEST-D4" }, editor.id);

    const detail = (await partsService.getPartById(part.id)) as any;
    expect(detail.createdByName).toBe(creator.name);
    expect(detail.updatedByName).toBe(editor.name);
    const list = (await partsService.getParts({ search: part.reference } as any)) as any;
    const rows = Array.isArray(list) ? list : list.items ?? list.parts ?? [];
    const listed = rows.find((p: any) => p.id === part.id);
    expect(listed).toMatchObject({ createdByName: creator.name, updatedByName: editor.name });
  });
});

describe("T5 : audit des fiches pneu", { timeout: 120000 }, () => {
  async function newTire(createdBy: number) {
    const tire = await tiresService.createTire(
      { brand: "TEST-MARQUE", model: uniqueTestToken("tire-audit"), size: "315/80R22.5", stockQuantity: 4 } as any,
      createdBy,
    );
    tireIds.push(tire.id);
    return tire;
  }

  it("création : created_by = updated_by = l'auteur, usagé à zéro", async () => {
    const { creator } = await actors();
    const tire = await newTire(creator.id);
    const [row] = await db.select().from(tires).where(eq(tires.id, tire.id));
    expect(row.createdBy).toBe(creator.id);
    expect(row.updatedBy).toBe(creator.id);
    expect(row.usedStockQuantity).toBe(0);
  });

  it("modification : updated_by passe à l'éditeur, created_by et created_at ne bougent pas", async () => {
    const { creator, editor } = await actors();
    const tire = await newTire(creator.id);
    const [before] = await db.select().from(tires).where(eq(tires.id, tire.id));
    await pause();

    await tiresService.updateTire(tire.id, { stockQuantity: 9 }, editor.id);

    const [after] = await db.select().from(tires).where(eq(tires.id, tire.id));
    expect(after.stockQuantity).toBe(9);
    expect(after.updatedBy).toBe(editor.id);
    expect(after.createdBy).toBe(creator.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("suppression douce : deleted_at posé, updated_by = qui supprime, created_by inchangé", async () => {
    const { creator, editor, third } = await actors();
    const tire = await newTire(creator.id);
    await tiresService.updateTire(tire.id, { stockQuantity: 6 }, editor.id);

    expect(await tiresService.deleteTire(tire.id, third.id)).toBe(true);

    const [after] = await db.select().from(tires).where(eq(tires.id, tire.id));
    expect(after.deletedAt).toBeInstanceOf(Date);
    expect(after.updatedBy).toBe(third.id);
    expect(after.createdBy).toBe(creator.id);
  });

  it("lecture : noms de l'auteur et du dernier éditeur joints", async () => {
    const { creator, editor } = await actors();
    const tire = await newTire(creator.id);
    await tiresService.updateTire(tire.id, { stockQuantity: 7 }, editor.id);
    const detail = (await tiresService.getTire(tire.id)) as any;
    expect(detail.createdByName).toBe(creator.name);
    expect(detail.updatedByName).toBe(editor.name);
  });

  it("fiche supprimée : plus modifiable, aucune colonne d'audit touchée", async () => {
    const { creator, editor, third } = await actors();
    const tire = await newTire(creator.id);
    await tiresService.deleteTire(tire.id, third.id);
    const result = await tiresService.updateTire(tire.id, { stockQuantity: 99 }, editor.id);
    expect(result).toBeUndefined();
    const [after] = await db.select().from(tires).where(eq(tires.id, tire.id));
    expect(after.updatedBy).toBe(third.id);
    expect(after.stockQuantity).toBe(4);
  });
});
