import { and, eq, inArray, like, or, sql, type AnyColumn, type SQL, type SQLWrapper } from "drizzle-orm";
import { db } from "../../server/db";
import {
  activityLogs,
  alerts,
  clientInvoices,
  clients,
  documentRenewalCenters,
  documentRenewalRequests,
  fuelPrices,
  missionBudgets,
  missionDestinations,
  missionOperations,
  missions,
  fuelRecords,
  partRequirements,
  parts,
  partsStockMovements,
  partsUsed,
  qhseInspectionCriteria,
  qhseInspections,
  statusHistory,
  supplierInvoices,
  suppliers,
  tireInspections,
  tireRotationDetails,
  tireRotations,
  supplierInvoiceSettlements,
  paymentInstruments,
  treasuryAccounts,
  treasuryEntries,
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
    // Contrôles QHSE sur un véhicule de test : qhse_inspections_vehicle_id_fkey bloquerait la suppression.
    await db.delete(qhseInspections).where(inArray(qhseInspections.vehicleId, ids.vehicleIds));
    // Écriture de trésorerie liée au véhicule (recharge carte, lot T2) : bloquerait la suppression (FK).
    await db.delete(paymentInstruments).where(inArray(paymentInstruments.vehicleId, ids.vehicleIds));
    await deleteInstrumentsOfEntries(db.select({ id: treasuryEntries.id }).from(treasuryEntries).where(inArray(treasuryEntries.vehicleId, ids.vehicleIds)));
    await deleteTreasuryEntriesWhere(inArray(treasuryEntries.vehicleId, ids.vehicleIds));
    await db.delete(vehicles).where(inArray(vehicles.id, ids.vehicleIds));
  }
  if (ids.supplierIds.length > 0) {
    // Factures créées sans id connu du test (import Excel) : bloquaient la suppression (FK).
    await deleteSupplierInvoicesOf(db.select({ id: suppliers.id }).from(suppliers).where(inArray(suppliers.id, ids.supplierIds)));
    await db.delete(paymentInstruments).where(inArray(paymentInstruments.supplierId, ids.supplierIds));
    await db.delete(suppliers).where(inArray(suppliers.id, ids.supplierIds));
  }
  if (ids.clientIds.length > 0) {
    await db.delete(paymentInstruments).where(inArray(paymentInstruments.clientId, ids.clientIds));
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
      // Contrôles et critères QHSE tracés par un compte de test (inspecteur ou audit).
      await db.delete(qhseInspections).where(inArray(qhseInspections.inspectorId, ids.userIds));
      await db.delete(qhseInspections).where(inArray(qhseInspections.createdBy, ids.userIds));
      await db.delete(qhseInspections).where(inArray(qhseInspections.updatedBy, ids.userIds));
      await db.delete(qhseInspectionCriteria).where(inArray(qhseInspectionCriteria.createdBy, ids.userIds));
      await db.delete(qhseInspectionCriteria).where(inArray(qhseInspectionCriteria.updatedBy, ids.userIds));
      // Trésorerie : écritures auto (plein, recharge, règlement) et comptes créés par un compte de test.
      await deleteTreasuryOfUsers(ids.userIds);
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
 * Suppression d'écritures de trésorerie : un budget de mission décaissé (L1c) qui en vise une la perd
 * d'abord (FK treasury_entry_id, nullable), sinon la suppression échoue.
 */
async function deleteTreasuryEntriesWhere(where: SQL | undefined): Promise<void> {
  const entries = db.select({ id: treasuryEntries.id }).from(treasuryEntries).where(where);
  await db.update(missionBudgets).set({ treasuryEntryId: null }).where(inArray(missionBudgets.treasuryEntryId, entries));
  await db.delete(treasuryEntries).where(where);
}

/** Écritures de trésorerie et comptes créés par ces utilisateurs ; un règlement garde son paiement, perd le lien de compte. */
async function deleteTreasuryOfUsers(userIds: number[]): Promise<void> {
  const accounts = db
    .select({ id: treasuryAccounts.id })
    .from(treasuryAccounts)
    .where(or(inArray(treasuryAccounts.createdBy, userIds), inArray(treasuryAccounts.updatedBy, userIds)));
  await db.update(supplierInvoiceSettlements).set({ treasuryAccountId: null }).where(inArray(supplierInvoiceSettlements.treasuryAccountId, accounts));
  // Traites et chèques (T4) : créés par ces comptes, ou payés par une écriture qui va disparaître.
  await db.delete(paymentInstruments).where(or(inArray(paymentInstruments.createdBy, userIds), inArray(paymentInstruments.updatedBy, userIds)));
  await deleteInstrumentsOfEntries(db.select({ id: treasuryEntries.id }).from(treasuryEntries).where(inArray(treasuryEntries.accountId, accounts)));
  await deleteInstrumentsOfEntries(db.select({ id: treasuryEntries.id }).from(treasuryEntries).where(or(inArray(treasuryEntries.createdBy, userIds), inArray(treasuryEntries.updatedBy, userIds))));
  await deleteTreasuryEntriesWhere(inArray(treasuryEntries.accountId, accounts));
  await deleteTreasuryEntriesWhere(or(inArray(treasuryEntries.createdBy, userIds), inArray(treasuryEntries.updatedBy, userIds)));
  await db.delete(treasuryAccounts).where(or(inArray(treasuryAccounts.createdBy, userIds), inArray(treasuryAccounts.updatedBy, userIds)));
}

/** Traite ou chèque payé par ces écritures : payment_instruments_treasury_entry_id_fkey bloquerait leur suppression. */
async function deleteInstrumentsOfEntries(entryIds: SQLWrapper): Promise<void> {
  await db.delete(paymentInstruments).where(inArray(paymentInstruments.treasuryEntryId, entryIds as any));
}

/** Une écriture de plein garde sa mission (FK sans cascade) : à supprimer avant la mission. */
export async function deleteTreasuryEntriesOfMissions(missionIds: number[]): Promise<void> {
  if (missionIds.length > 0) await deleteTreasuryEntriesWhere(inArray(treasuryEntries.missionId, missionIds));
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
  // Pleins d'un véhicule orphelin dont les notes ne portent pas le préfixe : fuel_records_vehicle_id_vehicles_id_fk
  // bloquait la suppression du véhicule et faisait échouer le hook global de chaque fichier de contrat.
  await db.delete(fuelRecords).where(inArray(fuelRecords.vehicleId, orphanVehicles));
  await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, orphanWorkOrders));
  await db.delete(qhseInspections).where(inArray(qhseInspections.vehicleId, orphanVehicles));
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
  // Budget de mission (L1) : FK vers la mission et vers ses auteurs, sans cascade.
  await db.delete(missionBudgets).where(
    or(
      inArray(missionBudgets.missionId, testMissions),
      inArray(missionBudgets.createdBy, testUsers),
      inArray(missionBudgets.updatedBy, testUsers),
      inArray(missionBudgets.approvedBy, testUsers),
      inArray(missionBudgets.disbursedBy, testUsers),
    ),
  );
  // Destination du barème (L1b) écrite par un compte de test : un budget hors test qui la vise la
  // perd (destination_id nullable), il n'est pas supprimé.
  const testDestinations = db
    .select({ id: missionDestinations.id })
    .from(missionDestinations)
    .where(or(inArray(missionDestinations.createdBy, testUsers), inArray(missionDestinations.updatedBy, testUsers)));
  await db.update(missionBudgets).set({ destinationId: null }).where(inArray(missionBudgets.destinationId, testDestinations));
  await db.delete(missionDestinations).where(inArray(missionDestinations.createdBy, testUsers));
  await db.delete(missionDestinations).where(inArray(missionDestinations.updatedBy, testUsers));
  await db.delete(missions).where(inArray(missions.createdBy, testUsers));
  // Suivi d'opération saisi par un compte de test sur une mission qui ne l'est pas (FK created_by/updated_by).
  await db.delete(missionOperations).where(inArray(missionOperations.createdBy, testUsers));
  await db.delete(missionOperations).where(inArray(missionOperations.updatedBy, testUsers));
  // Journal de trésorerie saisi par un compte de test : écritures d'abord (elles référencent les
  // comptes), y compris celles posées sur un compte créé par un compte de test, puis les comptes.
  const testTreasuryAccounts = db
    .select({ id: treasuryAccounts.id })
    .from(treasuryAccounts)
    .where(or(inArray(treasuryAccounts.createdBy, testUsers), inArray(treasuryAccounts.updatedBy, testUsers)));
  await db.update(supplierInvoiceSettlements).set({ treasuryAccountId: null }).where(inArray(supplierInvoiceSettlements.treasuryAccountId, testTreasuryAccounts));
  await db.delete(paymentInstruments).where(or(inArray(paymentInstruments.createdBy, testUsers), inArray(paymentInstruments.updatedBy, testUsers)));
  await deleteInstrumentsOfEntries(db.select({ id: treasuryEntries.id }).from(treasuryEntries).where(inArray(treasuryEntries.accountId, testTreasuryAccounts)));
  await deleteInstrumentsOfEntries(db.select({ id: treasuryEntries.id }).from(treasuryEntries).where(or(inArray(treasuryEntries.createdBy, testUsers), inArray(treasuryEntries.updatedBy, testUsers))));
  await deleteTreasuryEntriesWhere(inArray(treasuryEntries.accountId, testTreasuryAccounts));
  await deleteTreasuryEntriesWhere(or(inArray(treasuryEntries.createdBy, testUsers), inArray(treasuryEntries.updatedBy, testUsers)));
  await db.delete(treasuryAccounts).where(or(inArray(treasuryAccounts.createdBy, testUsers), inArray(treasuryAccounts.updatedBy, testUsers)));
  // Même cas que cleanupCreated : historique de statut tracé par un compte de test orphelin.
  await db.delete(statusHistory).where(inArray(statusHistory.updatedById, testUsers));
  await db.delete(qhseInspections).where(inArray(qhseInspections.inspectorId, testUsers));
  await db.delete(qhseInspections).where(inArray(qhseInspections.createdBy, testUsers));
  await db.delete(qhseInspections).where(inArray(qhseInspections.updatedBy, testUsers));
  await db.delete(qhseInspectionCriteria).where(inArray(qhseInspectionCriteria.createdBy, testUsers));
  await db.delete(qhseInspectionCriteria).where(inArray(qhseInspectionCriteria.updatedBy, testUsers));
  // Réduit la fenêtre de course avec les alertes écrites en tâche de fond.
  await db.delete(alerts).where(inArray(alerts.userId, testUsers));
  await db.delete(users).where(orphan(users.username, users.createdAt));
}
