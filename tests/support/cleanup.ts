import { and, eq, inArray, like, or, sql, type AnyColumn, type SQLWrapper } from "drizzle-orm";
import { db } from "../../server/db";
import {
  activityLogs,
  alerts,
  clientInvoices,
  clients,
  documentRenewalCenters,
  documentRenewalRequests,
  fuelPrices,
  missions,
  fuelRecords,
  partRequirements,
  parts,
  partsStockMovements,
  partsUsed,
  statusHistory,
  supplierInvoices,
  suppliers,
  tireInspections,
  tireRotationDetails,
  tireRotations,
  vehicleAcquisitionWorkflows,
  vehicleTires,
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
    // Factures créées sans id connu du test (import Excel) : bloquaient la suppression (FK).
    await deleteSupplierInvoicesOf(db.select({ id: suppliers.id }).from(suppliers).where(inArray(suppliers.id, ids.supplierIds)));
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
      await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.userId, ids.userIds));
      // Un changement de statut tracé par un compte de test sur un véhicule hors du lot
      // survit à la cascade vehicle_id : status_history_updated_by_id_users_id_fk bloque.
      await db.delete(statusHistory).where(inArray(statusHistory.updatedById, ids.userIds));
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

/** Factures des fournisseurs de test sélectionnés, quel que soit leur numéro (règlements en cascade). */
async function deleteSupplierInvoicesOf(supplierIdsQuery: SQLWrapper): Promise<void> {
  await db.delete(supplierInvoices).where(inArray(supplierInvoices.supplierId, supplierIdsQuery));
}

/**
 * Filet si un test a crashé avant d'enregistrer un id : ménage des restes de test (préfixe TEST,
 * plus d'une heure). Il tourne dans le
 * hook global de chaque fichier : un échec ici ferait échouer un fichier dont tous les tests
 * passent. L'application écrit des alertes en tâche de fond pour les comptes de test, ce qui peut
 * précéder la suppression des comptes (FK alerts_user_id). On rejoue deux fois ; si seule cette
 * course persiste, on prévient sans faire échouer (les restes partiront au passage suivant).
 * Toute autre erreur, par exemple une nouvelle FK vers users oubliée ici, fait échouer.
 */
export async function cleanupOrphanTestRows(): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await deleteOrphanTestRows();
      return;
    } catch (err) {
      if (attempt === 3) {
        if (!isBackgroundAlertRace(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[cleanupOrphanTestRows] restes de test non supprimés : ${message}
`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

/** Course connue : une alerte écrite en tâche de fond entre la suppression des alertes et celle du compte. */
function isBackgroundAlertRace(err: unknown): boolean {
  const pg = (err as { cause?: unknown })?.cause ?? err;
  const { code, constraint } = (pg ?? {}) as { code?: string; constraint?: string };
  if (code === "23503" && constraint === "alerts_user_id_users_id_fk") return true;
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("alerts_user_id_users_id_fk");
}

async function deleteOrphanTestRows(): Promise<void> {
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
  // Pneus montés, inspections et rotations d'un véhicule orphelin (client-read-scope-tires) : FK vers le véhicule.
  // Les détails d'une rotation partent avant elle, qu'elle soit rattachée par le véhicule ou par l'OT.
  const orphanVehicleTires = db.select({ id: vehicleTires.id }).from(vehicleTires).where(inArray(vehicleTires.vehicleId, orphanVehicles));
  const orphanRotations = db
    .select({ id: tireRotations.id })
    .from(tireRotations)
    .where(or(inArray(tireRotations.vehicleId, orphanVehicles), inArray(tireRotations.workOrderId, orphanWorkOrders)));
  await db.delete(tireRotationDetails).where(inArray(tireRotationDetails.rotationId, orphanRotations));
  await db.delete(tireRotationDetails).where(inArray(tireRotationDetails.vehicleTireId, orphanVehicleTires));
  await db.delete(tireRotations).where(inArray(tireRotations.workOrderId, orphanWorkOrders));
  await db.delete(tireRotations).where(inArray(tireRotations.vehicleId, orphanVehicles));
  await db.delete(tireInspections).where(inArray(tireInspections.vehicleTireId, orphanVehicleTires));
  await db.delete(vehicleTires).where(inArray(vehicleTires.vehicleId, orphanVehicles));
  await db.delete(workOrders).where(inArray(workOrders.vehicleId, orphanVehicles));
  const orphanParts = db.select({ id: parts.id }).from(parts).where(orphan(parts.reference, parts.createdAt));
  await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, orphanParts));
  await db.delete(parts).where(orphan(parts.reference, parts.createdAt));
  await db.delete(vehicles).where(orphan(vehicles.registrationNumber, vehicles.createdAt));
  await deleteSupplierInvoicesOf(db.select({ id: suppliers.id }).from(suppliers).where(orphan(suppliers.name, suppliers.createdAt)));
  await db.delete(suppliers).where(orphan(suppliers.name, suppliers.createdAt));
  const testUsers = db.select({ id: users.id }).from(users).where(orphan(users.username, users.createdAt));
  await db.delete(alerts).where(inArray(alerts.userId, testUsers));
  await db.delete(activityLogs).where(inArray(activityLogs.userId, testUsers));
  // Brouillons d'acquisition d'un compte de test : bloquaient la suppression du compte (FK).
  await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.userId, testUsers));
  // Centre de renouvellement créé par un compte de test (renouvellement rapide) : bloquait la
  // suppression du compte (FK document_renewal_centers_created_by_fkey) et faisait échouer le
  // hook global de tous les fichiers de contrat.
  const testCenters = db.select({ id: documentRenewalCenters.id }).from(documentRenewalCenters).where(inArray(documentRenewalCenters.createdBy, testUsers));
  await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.centerId, testCenters));
  await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.requestedBy, testUsers));
  await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.completedBy, testUsers));
  await db.delete(documentRenewalCenters).where(inArray(documentRenewalCenters.createdBy, testUsers));
  // Prix carburant saisi par un compte de test : bloquait la suppression du compte (FK).
  await db.delete(fuelPrices).where(inArray(fuelPrices.createdBy, testUsers));
  // Mission créée par un compte de test : bloquait la suppression du compte (FK
  // missions_created_by_users_id_fk) et faisait échouer le hook global de tous les fichiers.
  const testMissions = db.select({ id: missions.id }).from(missions).where(inArray(missions.createdBy, testUsers));
  await db.delete(clientInvoices).where(inArray(clientInvoices.missionId, testMissions));
  await db.delete(missions).where(inArray(missions.createdBy, testUsers));
  // Même cas que cleanupCreated : historique de statut tracé par un compte de test orphelin.
  await db.delete(statusHistory).where(inArray(statusHistory.updatedById, testUsers));
  // Réduit la fenêtre de course avec les alertes écrites en tâche de fond.
  await db.delete(alerts).where(inArray(alerts.userId, testUsers));
  await db.delete(users).where(orphan(users.username, users.createdAt));
}
