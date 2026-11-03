import { and, asc, eq } from "drizzle-orm";
import {
  partSpecifications,
  partVariants,
  parts,
  type PartSpecification,
  type PartVariant,
  type UpdatePartSpecification,
  type UpdatePartVariant,
} from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/pg-errors";

const PART_NOT_FOUND = "Cette pièce n'existe pas.";
const SPECIFICATION_NOT_FOUND = "Cette spécification n'existe pas pour cette pièce.";
const VARIANT_NOT_FOUND = "Cette variante n'existe pas pour cette pièce.";
const NOTHING_TO_UPDATE = "Aucune modification à enregistrer.";

type NewSpecification = { specificationName: string; specificationValue: string; unit?: string | null };
type NewVariant = { variantName: string; variantCode: string; additionalPrice: string; isAvailable?: boolean };

async function assertPartExists(partId: number): Promise<void> {
  const [part] = await db.select({ id: parts.id }).from(parts).where(eq(parts.id, partId)).limit(1);
  if (!part) throw new AppError(404, PART_NOT_FOUND);
}

/** Retire les clés absentes (undefined) : un PATCH ne touche que ce qui est envoyé. */
function definedFields<T extends Record<string, unknown>>(data: T): Partial<T> {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function translateSpecificationError(err: unknown): unknown {
  if (isUniqueViolation(err)) {
    return new AppError(409, "Cette pièce a déjà une spécification de ce nom.", { cause: err });
  }
  return err;
}

function translateVariantError(err: unknown): unknown {
  if (isUniqueViolation(err)) {
    return new AppError(409, "Une variante avec ce code existe déjà.", { cause: err });
  }
  return err;
}

/**
 * Spécifications et variantes d'une fiche pièce (PRT1). Toute lecture ou écriture d'un enfant se
 * fait sur le couple (pièce, enfant) : l'enfant d'une autre pièce est introuvable (404), jamais modifié.
 */
export class PartCatalogChildrenService {
  async listSpecifications(partId: number): Promise<PartSpecification[]> {
    await assertPartExists(partId);
    return db.select().from(partSpecifications).where(eq(partSpecifications.partId, partId)).orderBy(asc(partSpecifications.id));
  }

  async createSpecification(partId: number, data: NewSpecification): Promise<PartSpecification> {
    await assertPartExists(partId);
    try {
      const [created] = await db.insert(partSpecifications).values({ ...data, partId }).returning();
      return created;
    } catch (err) {
      throw translateSpecificationError(err);
    }
  }

  async updateSpecification(partId: number, specId: number, data: UpdatePartSpecification): Promise<PartSpecification> {
    await assertPartExists(partId);
    const changes = definedFields(data);
    if (Object.keys(changes).length === 0) throw new AppError(400, NOTHING_TO_UPDATE);
    try {
      const [updated] = await db
        .update(partSpecifications)
        .set(changes)
        .where(and(eq(partSpecifications.id, specId), eq(partSpecifications.partId, partId)))
        .returning();
      if (!updated) throw new AppError(404, SPECIFICATION_NOT_FOUND);
      return updated;
    } catch (err) {
      throw translateSpecificationError(err);
    }
  }

  async deleteSpecification(partId: number, specId: number): Promise<void> {
    await assertPartExists(partId);
    const deleted = await db
      .delete(partSpecifications)
      .where(and(eq(partSpecifications.id, specId), eq(partSpecifications.partId, partId)))
      .returning({ id: partSpecifications.id });
    if (deleted.length === 0) throw new AppError(404, SPECIFICATION_NOT_FOUND);
  }

  async listVariants(partId: number): Promise<PartVariant[]> {
    await assertPartExists(partId);
    return db.select().from(partVariants).where(eq(partVariants.partId, partId)).orderBy(asc(partVariants.id));
  }

  async createVariant(partId: number, data: NewVariant): Promise<PartVariant> {
    await assertPartExists(partId);
    try {
      const [created] = await db.insert(partVariants).values({ ...data, partId }).returning();
      return created;
    } catch (err) {
      throw translateVariantError(err);
    }
  }

  async updateVariant(partId: number, variantId: number, data: UpdatePartVariant): Promise<PartVariant> {
    await assertPartExists(partId);
    const changes = definedFields(data);
    if (Object.keys(changes).length === 0) throw new AppError(400, NOTHING_TO_UPDATE);
    try {
      const [updated] = await db
        .update(partVariants)
        .set(changes)
        .where(and(eq(partVariants.id, variantId), eq(partVariants.partId, partId)))
        .returning();
      if (!updated) throw new AppError(404, VARIANT_NOT_FOUND);
      return updated;
    } catch (err) {
      throw translateVariantError(err);
    }
  }

  async deleteVariant(partId: number, variantId: number): Promise<void> {
    await assertPartExists(partId);
    try {
      const deleted = await db
        .delete(partVariants)
        .where(and(eq(partVariants.id, variantId), eq(partVariants.partId, partId)))
        .returning({ id: partVariants.id });
      if (deleted.length === 0) throw new AppError(404, VARIANT_NOT_FOUND);
    } catch (err) {
      if (isForeignKeyViolation(err)) {
        throw new AppError(409, "Cette variante est utilisée par une demande de pièce : rendez-la indisponible plutôt que de la supprimer.", {
          cause: err,
        });
      }
      throw err;
    }
  }
}

export const partCatalogChildrenService = new PartCatalogChildrenService();
