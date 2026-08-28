import { eq, inArray, like } from "drizzle-orm";
import { db } from "../../server/db";
import {
  fuelRecords,
  parts,
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
  fuelRecordIds: number[];
};

export function createIdBag(): CreatedIds {
  return {
    userIds: [],
    partIds: [],
    vehicleIds: [],
    supplierIds: [],
    invoiceIds: [],
    fuelRecordIds: [],
  };
}

export async function cleanupCreated(ids: CreatedIds): Promise<void> {
  if (ids.fuelRecordIds.length > 0) {
    await db.delete(fuelRecords).where(inArray(fuelRecords.id, ids.fuelRecordIds));
  }
  if (ids.invoiceIds.length > 0) {
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.id, ids.invoiceIds));
  }
  if (ids.partIds.length > 0) {
    await db.delete(parts).where(inArray(parts.id, ids.partIds));
  }
  if (ids.vehicleIds.length > 0) {
    await db.delete(vehicles).where(inArray(vehicles.id, ids.vehicleIds));
  }
  if (ids.supplierIds.length > 0) {
    await db.delete(suppliers).where(inArray(suppliers.id, ids.supplierIds));
  }
  if (ids.userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, ids.userIds));
  }
}

/** Filet si un test a crashé avant d'enregistrer un id. */
export async function cleanupOrphanTestRows(): Promise<void> {
  await db.delete(fuelRecords).where(like(fuelRecords.notes, `${TEST_PREFIX}%`));
  await db.delete(supplierInvoices).where(like(supplierInvoices.invoiceNumber, `${TEST_PREFIX}%`));
  await db.delete(parts).where(like(parts.reference, `${TEST_PREFIX}%`));
  await db.delete(vehicles).where(like(vehicles.registrationNumber, `${TEST_PREFIX}%`));
  await db.delete(suppliers).where(like(suppliers.name, `${TEST_PREFIX}%`));
  await db.delete(users).where(like(users.username, `${TEST_PREFIX}%`));
}
