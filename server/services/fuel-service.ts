import { db } from "../db";
import { fuelRecords, missionBudgets, missions, vehicles, type FuelRecord, type InsertFuelRecord } from "@shared/schema";
import { eq, desc, count, sum, avg, and, isNull } from "drizzle-orm";
import { isMissionBudgetSettled } from "@shared/contracts/mission-budgets";
import { lockFuelCard } from "../lib/fuel-card-lock";
import { reverseFuelLink } from "./treasury-links";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { hasMovedFuelCard } from "../lib/fuel-record-ledger-lock";
import { FUEL_CARD_MANAGER_ROLES } from "@shared/constants/roles";
import { FUEL_PHYSICAL_RECORD_DELETE_ROLES } from "@shared/constants/fuel-record-delete";
import {
  FUEL_RECORD_ALREADY_REMOVED_MESSAGE,
  FUEL_RECORD_BUDGET_SETTLED_MESSAGE,
  FUEL_RECORD_CANCEL_FORBIDDEN_MESSAGE,
  FUEL_RECORD_CANCEL_NOT_VALIDATED_MESSAGE,
  FUEL_RECORD_VALIDATED_DELETE_MESSAGE,
  FUEL_RECORD_VALIDATED_EDIT_MESSAGE,
  FUEL_RECORD_CANCEL_REASON_MAX_LENGTH,
  FUEL_RECORD_CANCEL_REASON_MIN_LENGTH,
  canCancelFuelRecord,
  isFuelRecordValidated,
} from "@shared/constants/fuel-record-cancel";

const log = moduleLogger("fuel-service");

/** Année et mois (calendaires) d'une date `AAAA-MM-JJ`, pour les colonnes `year` / `month`. */
function periodOf(date: unknown): { year?: number; month?: number } {
  const match = typeof date === "string" ? /^(\d{4})-(\d{2})-\d{2}/.exec(date) : null;
  return match ? { year: Number(match[1]), month: Number(match[2]) } : {};
}

export class FuelService {
  /**
   * Récupère un enregistrement de carburant par ID - COPIÉ depuis storage-backup.ts
   */
  async getFuelRecord(id: number): Promise<FuelRecord | undefined> {
    const [fuelRecord] = await db
      .select()
      .from(fuelRecords)
      .where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt)));
    return fuelRecord;
  }

  /**
   * Récupère les enregistrements de carburant pour un véhicule - COPIÉ depuis storage-backup.ts
   */
  async getFuelRecordsByVehicleId(vehicleId: number): Promise<any[]> {
    const records = await db
      .select()
      .from(fuelRecords)
      .where(and(eq(fuelRecords.vehicleId, vehicleId), isNull(fuelRecords.deletedAt)))
      .orderBy(desc(fuelRecords.date));
    
    // Enrichir avec le prix par litre calculé
    return records.map(record => ({
      ...record,
      pricePerLiter: record.quantity > 0 ? Number(record.cost) / record.quantity : 0,
      totalCost: Number(record.cost)
    }));
  }

  /**
   * Crée un nouvel enregistrement de carburant - COPIÉ depuis storage-backup.ts
   */
  async createFuelRecord(fuelRecord: InsertFuelRecord, createdById?: number): Promise<FuelRecord> {
    // Écriture sur la carte carburant : sous son verrou, comme les débits et recharges.
    return db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const [createdFuelRecord] = await tx
        .insert(fuelRecords)
        .values({
          ...fuelRecord,
          ...periodOf(fuelRecord.date),
          createdBy: createdById,
          updatedBy: createdById,
        })
        .returning();
      return createdFuelRecord;
    });
  }

  /**
   * Met à jour un enregistrement de carburant - COPIÉ depuis storage-backup.ts
   */
  async updateFuelRecord(id: number, fuelRecord: Partial<InsertFuelRecord>, updatedById?: number): Promise<FuelRecord | undefined> {
    return db.transaction(async (tx) => {
      await lockFuelCard(tx);
      // Ligne verrouillée avant la décision : un plein validé ne se modifie plus (409), même si une
      // validation concurrente vient de passer. Absent ou supprimé : rien à modifier (undefined, 404 côté route).
      const [current] = await tx
        .select({ validationStatus: fuelRecords.validationStatus })
        .from(fuelRecords)
        .where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt)))
        .for("update");
      if (!current) return undefined;
      if (isFuelRecordValidated(current)) throw new AppError(409, FUEL_RECORD_VALIDATED_EDIT_MESSAGE);
      const [updatedFuelRecord] = await tx
        .update(fuelRecords)
        .set({
          ...fuelRecord,
          updatedBy: updatedById,
          updatedAt: new Date(),
        })
        .where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt)))
        .returning();
      return updatedFuelRecord;
    });
  }

  /**
   * Annule un plein validé, avec motif : suppression douce tracée (deleted_at, deleted_by,
   * cancellation_reason), contre-passation en trésorerie, recalcul du budget de mission par le
   * trigger AFTER de fuel_records. Rejeu avec le même motif : rien n'est réécrit (`replayed`).
   * Mêmes rôles que la suppression. 409 si le budget de la mission est soldé.
   * Retourne undefined si le plein n'existe pas.
   */
  async cancelFuelRecord(
    id: number,
    actor: { id: number; role: string },
    reason: string,
  ): Promise<{ record: FuelRecord; replayed: boolean } | undefined> {
    if (!actor || typeof actor.role !== "string" || !Number.isInteger(actor.id)) {
      log.error({ fuelRecordId: id }, "cancelFuelRecord appelé sans acteur identifié");
      throw new AppError(401, "Authentification requise pour annuler un plein.");
    }
    const trimmed = typeof reason === "string" ? reason.trim() : "";
    if (trimmed.length > FUEL_RECORD_CANCEL_REASON_MAX_LENGTH) {
      throw new AppError(400, "Le motif d'annulation est limité à 500 caractères.");
    }
    if (trimmed.length < FUEL_RECORD_CANCEL_REASON_MIN_LENGTH) {
      throw new AppError(400, "Le motif d'annulation est obligatoire (3 caractères au minimum).");
    }
    return db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const [record] = await tx.select().from(fuelRecords).where(eq(fuelRecords.id, id)).for("update");
      if (!record) return undefined;
      if (!canCancelFuelRecord(actor.role, record)) throw new AppError(403, FUEL_RECORD_CANCEL_FORBIDDEN_MESSAGE);

      if (record.deletedAt) {
        if (record.cancellationReason === trimmed) return { record, replayed: true };
        throw new AppError(409, FUEL_RECORD_ALREADY_REMOVED_MESSAGE);
      }
      if (!isFuelRecordValidated(record)) throw new AppError(409, FUEL_RECORD_CANCEL_NOT_VALIDATED_MESSAGE);

      if (record.missionId !== null) {
        // Même ordre que le solde (mission, puis budget) : le trigger du plein met à jour la mission, un
        // verrou pris dans l'autre sens fait un interblocage. Le solde en cours se termine avant nous.
        await tx.select({ id: missions.id }).from(missions).where(eq(missions.id, record.missionId)).for("update");
        // Verrou pris sans condition : le solde (FOR UPDATE) attend cette lecture, ou l'inverse.
        // Filtrer sur settled_at avant le verrou ne verrouillerait rien tant que le budget n'est pas soldé.
        const [budget] = await tx
          .select({ id: missionBudgets.id, settledAt: missionBudgets.settledAt })
          .from(missionBudgets)
          .where(eq(missionBudgets.missionId, record.missionId))
          .for("share");
        if (budget && isMissionBudgetSettled(budget)) throw new AppError(409, FUEL_RECORD_BUDGET_SETTLED_MESSAGE);
      }

      const now = new Date();
      const [cancelled] = await tx
        .update(fuelRecords)
        .set({ deletedAt: now, deletedBy: actor.id, cancellationReason: trimmed, updatedBy: actor.id, updatedAt: now })
        .where(eq(fuelRecords.id, id))
        .returning();
      await reverseFuelLink(tx, id, actor.id);
      log.info({ fuelRecordId: id, vehicleId: record.vehicleId, userId: actor.id }, "Plein validé annulé");
      return { record: cancelled, replayed: false };
    });
  }

  /**
   * Supprime un enregistrement de carburant - COPIÉ depuis storage-backup.ts
   */
  async deleteFuelRecord(id: number, actor: { id: number; role: string }): Promise<boolean> {
    // Acteur absent ou malformé : appel interne sans identité. 401 (non identifié) plutôt qu'un TypeError 500.
    if (!actor || typeof actor.role !== "string" || !Number.isInteger(actor.id)) {
      log.error({ fuelRecordId: id }, "deleteFuelRecord appelé sans acteur identifié");
      throw new AppError(401, "Authentification requise pour supprimer un plein.");
    }
    // Supprimer un débit ou une recharge change le solde : même verrou que l'écriture. La décision
    // (ligne vivante ? a-t-elle mouvementé la carte ?) est prise sous ce verrou, dans la transaction.
    return db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const [record] = await tx
        .select()
        .from(fuelRecords)
        .where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt)))
        .for("update");
      if (!record) return false;

      if (hasMovedFuelCard(record)) {
        // Plein qui a mouvementé la carte : réservé aux gestionnaires de la carte, suppression douce tracée.
        if (!(FUEL_CARD_MANAGER_ROLES as readonly string[]).includes(actor.role)) {
          throw new AppError(403, "Seuls l'administrateur, la logistique et le secrétariat peuvent supprimer un plein qui a mouvementé la carte carburant.");
        }
        if (isFuelRecordValidated(record)) throw new AppError(409, FUEL_RECORD_VALIDATED_DELETE_MESSAGE);
        await tx
          .update(fuelRecords)
          .set({ deletedAt: new Date(), deletedBy: actor.id })
          .where(eq(fuelRecords.id, id));
        await reverseFuelLink(tx, id, actor.id);
        return true;
      }

      // Plein physique sans mouvement de carte : garde historique (isWorkshopManager), suppression définitive.
      if (!(FUEL_PHYSICAL_RECORD_DELETE_ROLES as readonly string[]).includes(actor.role)) {
        throw new AppError(403, "Accès non autorisé");
      }
      if (isFuelRecordValidated(record)) throw new AppError(409, FUEL_RECORD_VALIDATED_DELETE_MESSAGE);
      const result = await tx.delete(fuelRecords).where(eq(fuelRecords.id, id)).returning();
      if (result.length > 0) {
        log.info(
          { fuelRecordId: id, vehicleId: record.vehicleId, cost: record.cost, quantity: record.quantity, userId: actor.id },
          "Plein physique supprimé définitivement",
        );
      }
      return result.length > 0;
    });
  }

  /**
   * Récupère les statistiques globales de carburant
   */
  async getFuelStatistics() {
    try {
      const [stats] = await db.select({
        totalCost: sum(fuelRecords.cost),
        totalQuantity: sum(fuelRecords.quantity),
        recordsCount: count(fuelRecords.id),
        averageCost: avg(fuelRecords.cost)
      }).from(fuelRecords).where(isNull(fuelRecords.deletedAt));

      return {
        totalCost: Number(stats.totalCost || 0),
        totalQuantity: Number(stats.totalQuantity || 0),
        recordsCount: Number(stats.recordsCount || 0),
        averageCost: Number(stats.averageCost || 0)
      };
    } catch (error) {
      console.error('Error getting fuel statistics:', error);
      return {
        totalCost: 0,
        totalQuantity: 0,
        recordsCount: 0,
        averageCost: 0
      };
    }
  }
}