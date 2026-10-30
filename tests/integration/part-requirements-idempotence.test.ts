import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { partRequirementsService } from "../../server/services/part-requirements-service";
import { partRequirements, parts, partsStockMovements } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestPart, createTestUser } from "../support/factories";

/**
 * T7 niveau I : une double soumission (double clic, onglet rejoué, retry
 * réseau) ne doit produire qu'un seul effet de stock.
 *
 * Le contrôle de statut était une lecture suivie d'une écriture : deux
 * requêtes simultanées lisaient toutes deux l'ancien statut et appliquaient
 * chacune l'entrée en stock.
 */

const ids = createIdBag();
const requirementIds: number[] = [];

afterAll(async () => {
  if (requirementIds.length > 0) {
    await db.delete(partRequirements).where(inArray(partRequirements.id, requirementIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
  }
  await cleanupCreated(ids);
});

async function setup(status: "ordered" | "received", quantity: number) {
  const requester = await createTestUser({ role: "workshop_manager" });
  const warehouse = await createTestUser({ role: "warehouse" });
  ids.userIds.push(requester.id, warehouse.id);
  const part = await createTestPart({ quantity });
  ids.partIds.push(part.id);
  const [requirement] = await db
    .insert(partRequirements)
    .values({
      partId: part.id,
      quantityNeeded: 2,
      reason: "TEST idempotence",
      status,
      requestedBy: requester.id,
    })
    .returning();
  requirementIds.push(requirement.id);
  return { warehouse, part, requirement };
}

describe("PartRequirementsService : double soumission", { timeout: 120000 }, () => {
  it("deux réceptions simultanées n'entrent le stock qu'une fois", async () => {
    const { warehouse, part, requirement } = await setup("ordered", 5);

    const results = await Promise.all([
      partRequirementsService.updatePartRequirement(requirement.id, { status: "received" }, "warehouse", warehouse.id),
      partRequirementsService.updatePartRequirement(requirement.id, { status: "received" }, "warehouse", warehouse.id),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    const refused = results.find((r) => !r.success);
    expect(refused?.error).toMatch(/déjà|statut/i);

    const [stock] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(7);
    const movements = await db.select().from(partsStockMovements).where(eq(partsStockMovements.partId, part.id));
    expect(movements).toHaveLength(1);
  });

  it("une réception rejouée après coup est un no-op", async () => {
    const { warehouse, part, requirement } = await setup("ordered", 0);

    const first = await partRequirementsService.updatePartRequirement(
      requirement.id,
      { status: "received" },
      "warehouse",
      warehouse.id,
    );
    expect(first.success).toBe(true);
    const replay = await partRequirementsService.updatePartRequirement(
      requirement.id,
      { status: "received" },
      "warehouse",
      warehouse.id,
    );
    expect(replay.success).toBe(true);

    const [stock] = await db.select().from(parts).where(eq(parts.id, part.id));
    expect(stock.quantity).toBe(2);
  });

  it("une sortie sans effet de stock est refusée : le statut ne change pas", async () => {
    const { warehouse, requirement } = await setup("received", 5);

    const result = await partRequirementsService.updatePartRequirement(requirement.id, { status: "issued" }, "warehouse", warehouse.id);
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/ordre de travail/) });
    const [row] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(row.status).toBe("received");
  });

  it("deux sorties simultanées : une seule passe", async () => {
    const { warehouse, requirement } = await setup("received", 5);
    const onTransition = async () => {};

    const results = await Promise.all([
      partRequirementsService.updatePartRequirement(requirement.id, { status: "issued" }, "warehouse", warehouse.id, { onTransition }),
      partRequirementsService.updatePartRequirement(requirement.id, { status: "issued" }, "warehouse", warehouse.id, { onTransition }),
    ]);

    expect(results.filter((r) => r.success)).toHaveLength(1);
    const [row] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(row.status).toBe("issued");
  });

  it("l'effet de la transition s'exécute une seule fois, et jamais si la transition est refusée", async () => {
    const { warehouse, requirement } = await setup("received", 5);
    let calls = 0;
    const onTransition = async () => {
      calls += 1;
    };

    // Le technicien n'a pas le droit de sortir une pièce : aucun effet.
    const refused = await partRequirementsService.updatePartRequirement(
      requirement.id,
      { status: "issued" },
      "technician",
      warehouse.id,
      { onTransition },
    );
    expect(refused.success).toBe(false);
    expect(calls).toBe(0);

    await Promise.all([
      partRequirementsService.updatePartRequirement(requirement.id, { status: "issued" }, "warehouse", warehouse.id, {
        onTransition,
      }),
      partRequirementsService.updatePartRequirement(requirement.id, { status: "issued" }, "warehouse", warehouse.id, {
        onTransition,
      }),
    ]);
    expect(calls).toBe(1);
  });

  it("un effet en échec annule la transition", async () => {
    const { warehouse, requirement } = await setup("received", 5);

    const result = await partRequirementsService.updatePartRequirement(
      requirement.id,
      { status: "issued" },
      "warehouse",
      warehouse.id,
      {
        onTransition: async () => {
          throw new Error("stock indisponible");
        },
      },
    );
    expect(result.success).toBe(false);
    const [row] = await db.select().from(partRequirements).where(eq(partRequirements.id, requirement.id));
    expect(row.status).toBe("received");
  });
});
