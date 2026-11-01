import { and, eq, inArray, like, sql, type AnyColumn } from "drizzle-orm";
import { db } from "../../server/db";
import {
  activityLogs,
  alerts,
  clientInvoices,
  clients,
  fuelPrices,
  fuelRecords,
  partRequirements,
  parts,
  partsStockMovements,
  partsUsed,
  supplierInvoices,
  suppliers,
  tireRotations,
  users,
  vehicles,
  workOrders,
} from "../../shared/schema";
import { TEST_PREFIX } from "./ids";

export type CreatedIds = {
  userIds: number[];
  partIds: number[];
  vehicleIds: number[];
  supplierIds: number[];
  invoiceIds: number[];
  clientIds: number[];
  clientInvoiceIds: number[];
  fuelRecordIds: number[];
};

export function createIdBag(): CreatedIds {
  return {
    userIds: [],
    partIds: [],
    vehicleIds: [],
    supplierIds: [],
    invoiceIds: [],
    clientIds: [],
    clientInvoiceIds: [],
    fuelRecordIds: [],
  };
}

export async function cleanupCreated(ids: CreatedIds): Promise<void> {
  if (ids.fuelRecordIds.length > 0) {
    await db.delete(fuelRecords).where(inArray(fuelRecords.id, ids.fuelRecordIds));
  }
  if (ids.clientInvoiceIds.length > 0) {
    await db.delete(clientInvoices).where(inArray(clientInvoices.id, ids.clientInvoiceIds));
  }
  if (ids.invoiceIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.id, ids.invoiceIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, ids.partIds));
    await db.delete(parts).where(inArray(parts.id, ids.partIds));
  }
  if (ids.vehicleIds.length > 0) {
    await db.delete(vehicles).where(inArray(vehicles.id, ids.vehicleIds));
  }
  if (ids.supplierIds.length > 0) {
    await db.delete(suppliers).where(inArray(suppliers.id, ids.supplierIds));
  }
  if (ids.clientIds.length > 0) {
    await db.delete(clients).where(inArray(clients.id, ids.clientIds));
  }
  if (ids.userIds.length > 0) {
    // Une affectation ou le planificateur crée des alertes nominatives :
    // sans ce ménage, la clé étrangère bloque la suppression de l'utilisateur.
    // Certaines alertes partent sans attente (avancement d'OT) et peuvent
    // arriver après le ménage : on recommence quelques fois.
    // Le journal d'audit (auditWrites) référence aussi l'utilisateur.
    for (let attempt = 1; ; attempt++) {
      await db.delete(alerts).where(inArray(alerts.userId, ids.userIds));
      await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
      try {
        await db.delete(users).where(inArray(users.id, ids.userIds));
        break;
      } catch (error) {
        if (attempt >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
}

/**
 * Âge minimal d'une ligne `TEST-` pour la tenir pour orpheline. La base de test est
 * partagée (autres suites, e2e, worktrees) : balayer tout le préfixe supprimait en
 * plein vol les utilisateurs et données d'un lancement concurrent (401, lignes absentes).
 */
export const ORPHAN_MIN_AGE = "2 hours";

const orphan = (prefixColumn: AnyColumn, createdAt: AnyColumn) =>
  and(like(prefixColumn, `${TEST_PREFIX}%`), sql`${createdAt} < now() - ${ORPHAN_MIN_AGE}::interval`);

/** Filet si un test a crashé avant d'enregistrer un id : ne touche que les lignes anciennes. */
export async function cleanupOrphanTestRows(): Promise<void> {
  await db.delete(fuelRecords).where(orphan(fuelRecords.notes, fuelRecords.createdAt));
  await db.delete(clientInvoices).where(orphan(clientInvoices.invoiceNumber, clientInvoices.createdAt));
  await db.delete(clients).where(orphan(clients.name, clients.createdAt));
  await db.delete(supplierInvoices).where(orphan(supplierInvoices.invoiceNumber, supplierInvoices.createdAt));
  // Les OT d'un véhicule orphelin bloquaient sa suppression (FK) et faisaient
  // échouer le nettoyage global de toutes les suites suivantes.
  const orphanVehicles = db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(orphan(vehicles.registrationNumber, vehicles.createdAt));
  const orphanWorkOrders = db.select({ id: workOrders.id }).from(workOrders).where(inArray(workOrders.vehicleId, orphanVehicles));
  await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, orphanWorkOrders));
  await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, orphanWorkOrders));
  await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, orphanWorkOrders));
  await db.delete(tireRotations).where(inArray(tireRotations.workOrderId, orphanWorkOrders));
  await db.delete(workOrders).where(inArray(workOrders.vehicleId, orphanVehicles));
  const orphanParts = db.select({ id: parts.id }).from(parts).where(orphan(parts.reference, parts.createdAt));
  await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, orphanParts));
  await db.delete(parts).where(orphan(parts.reference, parts.createdAt));
  await db.delete(vehicles).where(orphan(vehicles.registrationNumber, vehicles.createdAt));
  await db.delete(suppliers).where(orphan(suppliers.name, suppliers.createdAt));
  const testUsers = db.select({ id: users.id }).from(users).where(orphan(users.username, users.createdAt));
  await db.delete(alerts).where(inArray(alerts.userId, testUsers));
  await db.delete(activityLogs).where(inArray(activityLogs.userId, testUsers));
  // Prix carburant saisi par un compte de test : bloquait la suppression du compte (FK).
  await db.delete(fuelPrices).where(inArray(fuelPrices.createdBy, testUsers));
  await db.delete(users).where(orphan(users.username, users.createdAt));
}
