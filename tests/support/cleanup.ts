import { eq, inArray, like } from "drizzle-orm";
import { db } from "../../server/db";
import {
  activityLogs,
  alerts,
  clientInvoices,
  clients,
  fuelRecords,
  parts,
  partsStockMovements,
  supplierInvoices,
  suppliers,
  users,
  vehicles,
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

/** Filet si un test a crashé avant d'enregistrer un id. */
export async function cleanupOrphanTestRows(): Promise<void> {
  await db.delete(fuelRecords).where(like(fuelRecords.notes, `${TEST_PREFIX}%`));
  await db.delete(clientInvoices).where(like(clientInvoices.invoiceNumber, `${TEST_PREFIX}%`));
  await db.delete(clients).where(like(clients.name, `${TEST_PREFIX}%`));
  await db.delete(supplierInvoices).where(like(supplierInvoices.invoiceNumber, `${TEST_PREFIX}%`));
  await db.delete(partsStockMovements).where(inArray(partsStockMovements.partId, db.select({ id: parts.id }).from(parts).where(like(parts.reference, `${TEST_PREFIX}%`))));
  await db.delete(parts).where(like(parts.reference, `${TEST_PREFIX}%`));
  await db.delete(vehicles).where(like(vehicles.registrationNumber, `${TEST_PREFIX}%`));
  await db.delete(suppliers).where(like(suppliers.name, `${TEST_PREFIX}%`));
  const testUsers = db.select({ id: users.id }).from(users).where(like(users.username, `${TEST_PREFIX}%`));
  await db.delete(alerts).where(inArray(alerts.userId, testUsers));
  await db.delete(activityLogs).where(inArray(activityLogs.userId, testUsers));
  await db.delete(users).where(like(users.username, `${TEST_PREFIX}%`));
}
