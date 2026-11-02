import { and, asc, eq } from "drizzle-orm";
import { faultCatalog, faultCatalogParts, parts, type FaultCatalogPart, type UpdateFaultCatalogPart } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/pg-errors";

const FAULT_NOT_FOUND = "Cette fiche du catalogue n'existe pas.";
const LINK_NOT_FOUND = "Cette pièce n'est pas associée à cette panne.";
const PART_NOT_FOUND = "Cette pièce n'existe pas.";
const ALREADY_LINKED = "Cette pièce est déjà associée à cette panne.";
const ARCHIVED = "Cette panne est archivée : ses pièces ne peuvent plus être modifiées.";

export type FaultCatalogPartRow = FaultCatalogPart & { partName: string; partReference: string };

type NewFaultPart = { partId: number; quantity: number; isOptional: boolean };

/**
 * Pièces associées à une panne du catalogue (CAT2). Une panne archivée est figée : toute écriture
 * sur ses pièces est refusée (409) ; une panne validée reste modifiable. Toute opération sur un lien
 * se fait sur le couple (panne, lien) : le lien d'une autre panne est introuvable (404).
 */
export class FaultCatalogService {
  private async assertFault(faultId: number, forWrite: boolean): Promise<void> {
    const [fault] = await db.select({ status: faultCatalog.status }).from(faultCatalog).where(eq(faultCatalog.id, faultId)).limit(1);
    if (!fault) throw new AppError(404, FAULT_NOT_FOUND);
    if (forWrite && fault.status === "archived") throw new AppError(409, ARCHIVED);
  }

  async listParts(faultId: number): Promise<FaultCatalogPartRow[]> {
    await this.assertFault(faultId, false);
    const rows = await db
      .select({ link: faultCatalogParts, partName: parts.name, partReference: parts.reference })
      .from(faultCatalogParts)
      .innerJoin(parts, eq(parts.id, faultCatalogParts.partId))
      .where(eq(faultCatalogParts.faultCatalogId, faultId))
      .orderBy(asc(faultCatalogParts.id));
    return rows.map(({ link, partName, partReference }) => ({ ...link, partName, partReference }));
  }

  async addPart(faultId: number, data: NewFaultPart): Promise<FaultCatalogPartRow> {
    await this.assertFault(faultId, true);
    const [part] = await db.select({ name: parts.name, reference: parts.reference }).from(parts).where(eq(parts.id, data.partId)).limit(1);
    if (!part) throw new AppError(404, PART_NOT_FOUND);
    try {
      const [link] = await db
        .insert(faultCatalogParts)
        .values({ faultCatalogId: faultId, partId: data.partId, quantity: data.quantity, isOptional: data.isOptional })
        .returning();
      return { ...link, partName: part.name, partReference: part.reference };
    } catch (err) {
      // Deux ajouts simultanés : l'index unique (panne, pièce) tranche ; pièce supprimée entre-temps : FK.
      if (isUniqueViolation(err)) throw new AppError(409, ALREADY_LINKED, { cause: err });
      if (isForeignKeyViolation(err)) throw new AppError(404, PART_NOT_FOUND, { cause: err });
      throw err;
    }
  }

  async updatePart(faultId: number, linkId: number, data: UpdateFaultCatalogPart): Promise<FaultCatalogPartRow> {
    await this.assertFault(faultId, true);
    const changes = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
    if (Object.keys(changes).length === 0) throw new AppError(400, "Aucune modification à enregistrer.");
    const [updated] = await db
      .update(faultCatalogParts)
      .set(changes)
      .where(and(eq(faultCatalogParts.id, linkId), eq(faultCatalogParts.faultCatalogId, faultId)))
      .returning();
    if (!updated) throw new AppError(404, LINK_NOT_FOUND);
    const [part] = await db.select({ name: parts.name, reference: parts.reference }).from(parts).where(eq(parts.id, updated.partId)).limit(1);
    return { ...updated, partName: part?.name ?? "", partReference: part?.reference ?? "" };
  }

  async removePart(faultId: number, linkId: number): Promise<void> {
    await this.assertFault(faultId, true);
    const deleted = await db
      .delete(faultCatalogParts)
      .where(and(eq(faultCatalogParts.id, linkId), eq(faultCatalogParts.faultCatalogId, faultId)))
      .returning({ id: faultCatalogParts.id });
    if (deleted.length === 0) throw new AppError(404, LINK_NOT_FOUND);
  }
}

export const faultCatalogService = new FaultCatalogService();
