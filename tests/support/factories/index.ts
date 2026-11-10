import bcrypt from "bcryptjs";
import { db } from "../../../server/db";
import {
  clientInvoices,
  clients,
  fuelRecords,
  parts,
  supplierInvoices,
  suppliers,
  users,
  vehicles,
  type Client,
  type ClientInvoice,
  type FuelRecord,
  type Part,
  type Supplier,
  type SupplierInvoice,
  type User,
  type Vehicle,
} from "../../../shared/schema";
import { uniqueTestToken } from "../ids";

export const TEST_USER_PASSWORD = "test-pass-123";

export type TestUserRole =
  | "admin"
  | "workshop_manager"
  | "management"
  | "technician"
  | "secretary"
  | "accountant"
  | "logistics"
  | "warehouse"
  | "driver"
  | "client"
  | "user";

export async function createTestUser(
  overrides: Partial<typeof users.$inferInsert> & { role?: TestUserRole } = {},
): Promise<User> {
  const token = uniqueTestToken("user");
  const password = overrides.password ?? await bcrypt.hash(TEST_USER_PASSWORD, 4);
  const [row] = await db
    .insert(users)
    .values({
      username: overrides.username ?? token,
      email: overrides.email ?? `${token}@fleet.test`,
      name: overrides.name ?? token,
      role: overrides.role ?? "warehouse",
      password,
    })
    .returning();
  return row;
}

export async function createTestPart(
  overrides: Partial<typeof parts.$inferInsert> = {},
): Promise<Part> {
  const token = uniqueTestToken("part");
  const [row] = await db
    .insert(parts)
    .values({
      name: overrides.name ?? token,
      reference: overrides.reference ?? token,
      quantity: overrides.quantity ?? 10,
      minQuantity: overrides.minQuantity ?? 5,
      unit: overrides.unit ?? "pièce",
      unitPrice: overrides.unitPrice ?? "1000.00",
      category: overrides.category ?? "TEST",
      location: overrides.location ?? "TEST-A1",
      createdBy: overrides.createdBy,
      updatedBy: overrides.updatedBy ?? overrides.createdBy,
      supplierId: overrides.supplierId,
      supplier: overrides.supplier,
      description: overrides.description,
      deliveryReceiptNumber: overrides.deliveryReceiptNumber,
    })
    .returning();
  return row;
}

export async function createTestVehicle(
  overrides: Partial<typeof vehicles.$inferInsert> = {},
): Promise<Vehicle> {
  const token = uniqueTestToken("veh");
  const plate = (overrides.registrationNumber ?? token).slice(0, 32);
  const [row] = await db
    .insert(vehicles)
    .values({
      registrationNumber: plate,
      brand: overrides.brand ?? "Renault",
      model: overrides.model ?? "T480",
      year: overrides.year ?? 2021,
      mileage: overrides.mileage ?? 100000,
      lastMileage: overrides.lastMileage ?? overrides.mileage ?? 100000,
      vehicleType: overrides.vehicleType ?? "porteur",
      status: overrides.status ?? "operational",
      fuelType: overrides.fuelType ?? "diesel",
      createdBy: overrides.createdBy,
      ownerId: overrides.ownerId,
    })
    .returning();
  return row;
}

export async function createTestSupplier(
  overrides: Partial<typeof suppliers.$inferInsert> = {},
): Promise<Supplier> {
  const token = uniqueTestToken("supplier");
  const [row] = await db
    .insert(suppliers)
    .values({
      name: overrides.name ?? token,
      category: overrides.category ?? "Pièces",
      isActive: overrides.isActive ?? true,
      createdBy: overrides.createdBy,
    })
    .returning();
  return row;
}

export async function createTestSupplierInvoice(
  overrides: Partial<typeof supplierInvoices.$inferInsert> & { supplierId: number },
): Promise<SupplierInvoice> {
  const token = uniqueTestToken("inv");
  const amountHT = overrides.amountHT ?? "100000.00";
  const vatAmount = overrides.vatAmount ?? "19250.00";
  const totalTTC = overrides.totalTTC ?? "119250.00";
  const [row] = await db
    .insert(supplierInvoices)
    .values({
      supplierId: overrides.supplierId,
      invoiceNumber: overrides.invoiceNumber ?? token,
      invoiceDate: overrides.invoiceDate ?? "2026-01-15",
      family: overrides.family ?? "TEST",
      description: overrides.description ?? token,
      amountHT,
      vatAmount,
      totalTTC,
      totalAmount: overrides.totalAmount ?? totalTTC,
      subtotal: overrides.subtotal ?? amountHT,
      taxAmount: overrides.taxAmount ?? vatAmount,
      balance: overrides.balance ?? totalTTC,
      status: overrides.status ?? "received",
      // Écart de rapprochement : transmis seulement quand l'appelant le fournit.
      ...(overrides.hasDiscrepancy !== undefined ? { hasDiscrepancy: overrides.hasDiscrepancy } : {}),
      ...(overrides.priceVariance !== undefined ? { priceVariance: overrides.priceVariance } : {}),
      ...(overrides.variancePercentage !== undefined ? { variancePercentage: overrides.variancePercentage } : {}),
    })
    .returning();
  return row;
}

export async function createTestClient(
  overrides: Partial<typeof clients.$inferInsert> = {},
): Promise<Client> {
  const token = uniqueTestToken("client");
  const [row] = await db
    .insert(clients)
    .values({
      name: overrides.name ?? token,
      email: overrides.email ?? `${token}@client.test`,
      isActive: overrides.isActive ?? true,
      createdBy: overrides.createdBy,
    })
    .returning();
  return row;
}

export async function createTestClientInvoice(
  overrides: Partial<typeof clientInvoices.$inferInsert> & { clientId: number },
): Promise<ClientInvoice> {
  const token = uniqueTestToken("cinv");
  const amountHT = overrides.amountHT ?? "100000.00";
  const vatAmount = overrides.vatAmount ?? "19250.00";
  const amountTTC = overrides.amountTTC ?? "119250.00";
  const [row] = await db
    .insert(clientInvoices)
    .values({
      clientId: overrides.clientId,
      invoiceNumber: overrides.invoiceNumber ?? token,
      invoiceDate: overrides.invoiceDate ?? "2026-01-15",
      // Échéance lointaine : une facture de test échue serait passée en retard
      // par le cycle de fond d'un serveur branché sur la même base (CINV2).
      dueDate: overrides.dueDate ?? "2099-02-15",
      amountHT,
      vatAmount,
      amountTTC,
      balance: overrides.balance ?? amountTTC,
      status: overrides.status ?? "pending",
      createdBy: overrides.createdBy,
    })
    .returning();
  return row;
}

export async function createTestFuelRecord(
  overrides: Partial<typeof fuelRecords.$inferInsert> = {},
): Promise<FuelRecord> {
  const [row] = await db
    .insert(fuelRecords)
    .values({
      vehicleId: overrides.vehicleId,
      date: overrides.date ?? "2026-01-15",
      quantity: overrides.quantity ?? 100,
      cost: overrides.cost ?? "82800.00",
      creditAmount: overrides.creditAmount ?? "0",
      debitAmount: overrides.debitAmount ?? "82800.00",
      year: overrides.year ?? 2026,
      month: overrides.month ?? 1,
      stationName: overrides.stationName ?? "TEST-Station",
      createdBy: overrides.createdBy,
      notes: overrides.notes ?? uniqueTestToken("fuel"),
    })
    .returning();
  return row;
}
