/**
 * Seed des démos par profil (e2e/demo/*.spec.ts). Base locale jetable uniquement.
 *
 * Usage : node --import tsx e2e/demo/seed-demo.ts (DATABASE_URL local, voir e2e/demo/README.md)
 *
 * Idempotent : les comptes, véhicules et la pièce sont posés par clé naturelle
 * (ON CONFLICT DO NOTHING) ; l'état des scénarios (OT du technicien, échéance du
 * document du secrétariat) est ramené à son état de départ à chaque lancement, pour
 * que chaque démo puisse être rejouée. Les mots de passe sont en clair ici : la base
 * est locale et le garde-fou ci-dessous refuse tout autre hôte.
 *
 * Choix reuse-first : scripts/recette-seed.ts exige un environnement de recette et
 * un mot de passe de 12 caractères ; il n'est pas adapté à une base Docker jetable.
 */
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import { and, eq, inArray, like, ne } from "drizzle-orm";
import { db, pool } from "../../server/db";
import {
  assignments,
  clientInvoices,
  clients,
  documentRenewalRequests,
  drivers,
  fuelRecords,
  missions,
  partRequirements,
  parts,
  partsStockMovements,
  partsUsed,
  purchaseOrderLines,
  purchaseOrders,
  supplierInvoices,
  suppliers,
  users,
  vehicleDocuments,
  vehicles,
  workOrders,
} from "../../shared/schema";
import { deleteClientInvoicesWhere } from "../../tests/support/money-override";
import { cleanupPodFiles } from "../../tests/support/pod";

export const DEMO_ACCOUNTS = {
  technician: { username: "tech1", password: "tech123", name: "Paul Mbarga", role: "technician" },
  technicianBis: { username: "demotech2", password: "tech123", name: "Rodrigue Fotsing", role: "technician" },
  secretary: { username: "secretaire1", password: "secret123", name: "Awa Ndiaye", role: "secretary" },
  clientA: { username: "client1", password: "client123", name: "Transports Kamga", role: "client" },
  clientB: { username: "client2", password: "client123", name: "Logistique Fotso", role: "client" },
  warehouse: { username: "fatou", password: "warehouse123", name: "Fatoumata Diallo", role: "warehouse" },
  logistics: { username: "logi1", password: "logi123", name: "Jean Tchoumi", role: "logistics" },
  workshopManager: { username: "terry", password: "workshop123", name: "Terry Ekambi", role: "workshop_manager" },
  management: { username: "direction1", password: "direction123", name: "Marie Essomba", role: "management" },
  admin: { username: "admin1", password: "admin123", name: "Admin Démo", role: "admin" },
  recruit: { username: "recrue1", password: "recrue123", name: "Paul Recrue", role: "warehouse" },
  driver: { username: "chauffeur1", password: "chauffeur123", name: "Samuel Biyick", role: "driver" },
} as const;

export const DEMO_VEHICLES = {
  clientA1: "DEMO-C1-001",
  clientA2: "DEMO-C1-002",
  clientB1: "DEMO-C2-001",
  workshop: "DEMO-ATL-001",
  secretary: "DEMO-SEC-001",
  atelierChef: "DEMO-CHEF-001",
} as const;

export const DEMO_MISSION = {
  clientName: "Brasseries du Littoral (démo)",
  orderPrefix: "DEMO-MIS-",
  vehicle: "DEMO-LOG-001",
  driverEmployee: "DEMO-EMP-001",
  fuelStation: "DEMO-APPROVISIONNEMENT",
} as const;

export const DEMO_OT_PREFIX = "Démo atelier - ";

export const DEMO_PART = { reference: "DEMO-FILTRE-HUILE", name: "Filtre à huile démo" } as const;
export const DEMO_RECEPTION = {
  supplierName: "Pièces Douala (démo)",
  orderNumber: "DEMO-BC-001",
  deliveryCode: "BL-DEMO-001",
  workOrderTitle: `${DEMO_OT_PREFIX}Entretien magasin`,
  orderedQuantity: 5,
  requestedQuantity: 2,
} as const;
export const DEMO_WORK_ORDER_TITLE = "Démo - Vidange et contrôle freins";
export const DEMO_DOCUMENT_NAME = "Assurance DEMO-SEC-001";

/** Hôtes acceptés : base locale ou conteneur Docker du compose de test. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);

/** Refuse toute base autre que `fleet_test` sur un hôte local (le .env racine peut viser la production). */
export function assertLocalDatabase(rawUrl: string | undefined = process.env.DATABASE_URL): void {
  let ok = false;
  try {
    const url = new URL(rawUrl ?? "");
    ok = LOCAL_HOSTS.has(url.hostname) && url.pathname === "/fleet_test";
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("Seed de démo refusé : DATABASE_URL doit viser la base locale fleet_test.");
}

async function ensureUser(account: { username: string; password: string; name: string; role: string }): Promise<number> {
  await db
    .insert(users)
    .values({
      username: account.username,
      name: account.name,
      email: `${account.username}@demo.invalid`,
      role: account.role as typeof users.$inferInsert.role,
      password: await bcrypt.hash(account.password, 4),
    })
    .onConflictDoNothing();
  // Réconciliation : un compte déjà présent retrouve rôle et mot de passe de la démo.
  const [current] = await db.select().from(users).where(eq(users.username, account.username));
  const passwordOk = current ? await bcrypt.compare(account.password, current.password) : true;
  if (current && (current.role !== account.role || current.name !== account.name || !passwordOk)) {
    await db.update(users).set({ role: account.role as typeof users.$inferInsert.role, name: account.name, password: await bcrypt.hash(account.password, 4) }).where(eq(users.id, current.id));
  }
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.username, account.username));
  return row.id;
}

async function ensureVehicle(registration: string, model: string, ownerId: number | null): Promise<number> {
  await db
    .insert(vehicles)
    .values({ registrationNumber: registration, brand: "Renault", model, year: 2021, mileage: 120000, lastMileage: 120000, ownerId })
    .onConflictDoNothing();
  const [row] = await db.select({ id: vehicles.id, ownerId: vehicles.ownerId }).from(vehicles).where(eq(vehicles.registrationNumber, registration));
  if (row.ownerId !== ownerId) await db.update(vehicles).set({ ownerId }).where(eq(vehicles.id, row.id));
  return row.id;
}

/** Jour calendaire LOCAL décalé de `days` (les rapports raisonnent en heure locale, pas en UTC). */
function isoDayFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Logistique : client donneur d'ordre, véhicule aux papiers valides, chauffeur formé, carte carburant créditée. */
/** Atelier : chef d'atelier ; le technicien tech1 est affecté par la démo. */
async function seedWorkshop(): Promise<void> {
  await ensureUser(DEMO_ACCOUNTS.workshopManager);
  await ensureUser(DEMO_ACCOUNTS.technician);
  await ensureUser(DEMO_ACCOUNTS.technicianBis);
  const vehicleId = await ensureVehicle(DEMO_VEHICLES.atelierChef, "T480", null);
  const old = await db.select({ id: workOrders.id }).from(workOrders).where(and(eq(workOrders.vehicleId, vehicleId), like(workOrders.title, `${DEMO_OT_PREFIX}%`)));
  if (old.length > 0) {
    const ids = old.map((o) => o.id);
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, ids));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, ids));
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, ids));
    await db.delete(workOrders).where(inArray(workOrders.id, ids));
  }
}

/** PDF minimal mais valide, pour que l'ouverture d'un document de démo ne donne pas 404. */
function writeDemoPdf(name: string): void {
  const dir = path.join(process.cwd(), "uploads", "demo");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  if (fs.existsSync(target)) return;
  const body = ["%PDF-1.1", "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj", "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj", "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj", "trailer<</Root 1 0 R>>", "%%EOF", ""].join("\n");
  fs.writeFileSync(target, body);
}

/** Les lignes de commande référencent les demandes de pièce : à purger avant les OT de démo. */
async function purgeReceptionOrders(): Promise<void> {
  const oldOrders = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.orderNumber, DEMO_RECEPTION.orderNumber));
  if (oldOrders.length > 0) {
    // Mouvements d'entrée créés par les réceptions précédentes : sans cette purge, ils s'accumulent à chaque rejeu.
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.reason, oldOrders.map((o) => `Réception commande #${o.id}`)));
    await db.delete(supplierInvoices).where(inArray(supplierInvoices.purchaseOrderId, oldOrders.map((o) => o.id)));
    await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.purchaseOrderId, oldOrders.map((o) => o.id)));
    await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, oldOrders.map((o) => o.id)));
  }
}

/** Magasinier : une commande fournisseur confirmée à réceptionner, et la demande de pièce d'un OT qui l'attend. */
async function seedWarehouse(): Promise<void> {
  const warehouseId = await ensureUser(DEMO_ACCOUNTS.warehouse);
  const managerId = await ensureUser(DEMO_ACCOUNTS.workshopManager);
  const vehicleId = await ensureVehicle(DEMO_VEHICLES.atelierChef, "T480", null);
  const [part] = await db.select({ id: parts.id }).from(parts).where(eq(parts.reference, DEMO_PART.reference));

  const oldOts = await db.select({ id: workOrders.id }).from(workOrders).where(eq(workOrders.title, DEMO_RECEPTION.workOrderTitle));
  if (oldOts.length > 0) {
    const ids = oldOts.map((o) => o.id);
    await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, ids));
    await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, ids));
    await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, ids));
    await db.delete(workOrders).where(inArray(workOrders.id, ids));
  }

  await db.insert(suppliers).values({ name: DEMO_RECEPTION.supplierName, category: "Pièces", isActive: true }).onConflictDoNothing();
  const [supplier] = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.name, DEMO_RECEPTION.supplierName));
  const [workOrder] = await db
    .insert(workOrders)
    .values({ vehicleId, title: DEMO_RECEPTION.workOrderTitle, priority: "medium", status: "awaiting_parts", description: "Remplacement du filtre à huile : pièce commandée, en attente de réception." })
    .returning({ id: workOrders.id });
  const [requirement] = await db
    .insert(partRequirements)
    .values({
      partId: part.id,
      vehicleId,
      workOrderId: workOrder.id,
      quantityNeeded: DEMO_RECEPTION.requestedQuantity,
      reason: "Remplacement du filtre à huile",
      status: "ordered",
      requestedBy: managerId,
    })
    .returning({ id: partRequirements.id });
  const [order] = await db
    .insert(purchaseOrders)
    .values({
      orderNumber: DEMO_RECEPTION.orderNumber,
      supplierId: supplier.id,
      orderDate: isoDayFromNow(-3),
      expectedDeliveryDate: isoDayFromNow(0),
      status: "confirmed",
      totalAmountHT: "62500",
      totalAmountTTC: "74528.13",
      createdBy: warehouseId,
    })
    .returning({ id: purchaseOrders.id });
  await db.insert(purchaseOrderLines).values({
    purchaseOrderId: order.id,
    partRequirementId: requirement.id,
    partId: part.id,
    quantityOrdered: DEMO_RECEPTION.orderedQuantity,
    unitPrice: "12500",
    totalPrice: "62500",
  });
}

export const DEMO_INVOICE = {
  number: "DEMO-FAC-001",
  numberPaid: "DEMO-FAC-002",
  clientName: "Brasseries du Littoral (démo)",
  amountHT: 1_000_000,
  amountTTC: 1_192_500,
  firstPayment: 500_000,
} as const;

/** Factures de la période : purgées (paiements en cascade) puis recréées, donc rejeu sans doublon. */
async function seedClientInvoices(): Promise<void> {
  await deleteClientInvoicesWhere(like(clientInvoices.invoiceNumber, "DEMO-FAC-%"));
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.name, DEMO_INVOICE.clientName));
  const today = isoDayFromNow(0);
  const due = isoDayFromNow(30);
  await db.insert(clientInvoices).values([
    {
      invoiceNumber: DEMO_INVOICE.number,
      clientId: client.id,
      invoiceDate: today,
      dueDate: due,
      amountHT: String(DEMO_INVOICE.amountHT),
      vatAmount: "192500",
      amountTTC: String(DEMO_INVOICE.amountTTC),
      balance: String(DEMO_INVOICE.amountTTC),
      status: "pending",
    },
    {
      invoiceNumber: DEMO_INVOICE.numberPaid,
      clientId: client.id,
      invoiceDate: today,
      dueDate: due,
      amountHT: "600000",
      vatAmount: "115500",
      amountTTC: "715500",
      balance: "0",
      status: "paid",
    },
  ]);
}

export const DEMO_TCO = { orderNumber: "DEMO-TCO-001", invoiceNumber: "DEMO-FAC-003", amountHT: 800_000, amountTTC: 953_400 } as const;

/** Mission terminée de la période, affectée à un camion et facturée : alimente l'audit flotte et TCO. */
async function seedFleetAudit(vehicleId: number): Promise<void> {
  const old = await db.select({ id: missions.id }).from(missions).where(eq(missions.orderNumber, DEMO_TCO.orderNumber));
  if (old.length > 0) {
    const ids = old.map((m) => m.id);
    await deleteClientInvoicesWhere(inArray(clientInvoices.missionId, ids));
    await db.delete(assignments).where(inArray(assignments.missionId, ids));
    await db.delete(missions).where(inArray(missions.id, ids));
  }
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.name, DEMO_INVOICE.clientName));
  const now = new Date();
  const [mission] = await db
    .insert(missions)
    .values({
      clientId: client.id,
      orderNumber: DEMO_TCO.orderNumber,
      pickupAddress: "Douala, port",
      deliveryAddress: "Yaoundé, entrepôt central",
      pickupDate: new Date(now.getTime() - 2 * 86_400_000),
      deliveryDate: now,
      actualDistance: 240,
      status: "completed",
    })
    .returning({ id: missions.id });
  await db.insert(assignments).values({ missionId: mission.id, vehicleId, status: "completed", completedAt: now });
  const today = isoDayFromNow(0);
  await db.insert(clientInvoices).values({
    invoiceNumber: DEMO_TCO.invoiceNumber,
    missionId: mission.id,
    clientId: client.id,
    invoiceDate: today,
    dueDate: today,
    amountHT: String(DEMO_TCO.amountHT),
    vatAmount: "153400",
    amountTTC: String(DEMO_TCO.amountTTC),
    balance: "0",
    status: "paid",
  });
}

/** Carte grise, assurance et visite technique valides : le départ d'une mission n'est pas bloqué. */
async function ensureValidPapers(vehicleId: number, registration: string): Promise<void> {
  const docs = await db.select({ id: vehicleDocuments.id, type: vehicleDocuments.type, expiryDate: vehicleDocuments.expiryDate }).from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
  for (const type of ["carte_grise", "assurance", "visite_technique"] as const) {
    writeDemoPdf(`${registration}-${type}.pdf`);
    const existing = docs.find((d) => d.type === type);
    if (existing) {
      if (String(existing.expiryDate) !== "2099-12-31") {
        await db.update(vehicleDocuments).set({ expiryDate: "2099-12-31" }).where(eq(vehicleDocuments.id, existing.id));
      }
      continue;
    }
    await db.insert(vehicleDocuments).values({
      vehicleId,
      name: `${registration} ${type}`,
      type,
      filename: `${type}.pdf`,
      filesize: 4,
      fileType: "application/pdf",
      filePath: `uploads/demo/${registration}-${type}.pdf`,
      expiryDate: "2099-12-31",
    });
  }
}

async function seedLogistics(): Promise<void> {
  await ensureUser(DEMO_ACCOUNTS.logistics);
  await db.insert(clients).values({ name: DEMO_MISSION.clientName, paymentTerms: 30 }).onConflictDoNothing();
  const vehicleId = await ensureVehicle(DEMO_MISSION.vehicle, "Premium 450", null);
  await ensureValidPapers(vehicleId, DEMO_MISSION.vehicle);
  await db
    .insert(drivers)
    .values({ firstName: "Emmanuel", lastName: "Nkoulou", employeeNumber: DEMO_MISSION.driverEmployee, cpcStatus: "FORMÉ", cpcTrainingDate: isoDayFromNow(-30), licenseExpiry: "2099-12-31", isActive: true })
    .onConflictDoNothing();
  await db.update(drivers).set({ cpcStatus: "FORMÉ", cpcTrainingDate: isoDayFromNow(-30), isActive: true }).where(eq(drivers.employeeNumber, DEMO_MISSION.driverEmployee));
  const [credit] = await db.select({ id: fuelRecords.id }).from(fuelRecords).where(eq(fuelRecords.stationName, DEMO_MISSION.fuelStation));
  if (!credit) {
    await db.insert(fuelRecords).values({
      date: "2026-01-15",
      quantity: 1,
      cost: "0",
      creditAmount: "50000000",
      debitAmount: "0",
      year: 2026,
      month: 1,
      stationName: DEMO_MISSION.fuelStation,
      notes: "Crédit de carte (démo)",
    });
  }
  // Missions de la démo : retirées à chaque lancement (factures et affectations d'abord).
  const old = await db.select({ id: missions.id }).from(missions).where(like(missions.orderNumber, `${DEMO_MISSION.orderPrefix}%`));
  if (old.length > 0) {
    const oldIds = old.map((m) => m.id);
    await deleteClientInvoicesWhere(inArray(clientInvoices.missionId, oldIds));
    await cleanupPodFiles(oldIds);
    await db.delete(assignments).where(inArray(assignments.missionId, oldIds));
    await db.delete(missions).where(inArray(missions.id, oldIds));
  }
}

export const DEMO_DRIVER_DAY = { orderNumber: "DEMO-JOUR-001", vehicle: "DEMO-JOUR-001", employee: "DEMO-EMP-JOUR", pickup: "Douala, port", delivery: "Bafoussam, marché central" } as const;

/** Mission du jour du chauffeur1 : affectée, à démarrer depuis son tableau de bord. */
async function seedDriverDay(): Promise<void> {
  const userId = await ensureUser(DEMO_ACCOUNTS.driver);
  const vehicleId = await ensureVehicle(DEMO_DRIVER_DAY.vehicle, "T480", null);
  await ensureValidPapers(vehicleId, DEMO_DRIVER_DAY.vehicle);
  const old = await db.select({ id: missions.id }).from(missions).where(eq(missions.orderNumber, DEMO_DRIVER_DAY.orderNumber));
  if (old.length > 0) {
    const ids = old.map((m) => m.id);
    await db.delete(assignments).where(inArray(assignments.missionId, ids));
    await db.delete(missions).where(inArray(missions.id, ids));
  }
  await db.update(drivers).set({ userId: null }).where(and(eq(drivers.userId, userId), ne(drivers.employeeNumber, DEMO_DRIVER_DAY.employee)));
  await db
    .insert(drivers)
    .values({ userId, firstName: "Samuel", lastName: "Biyick", employeeNumber: DEMO_DRIVER_DAY.employee, cpcStatus: "FORMÉ", cpcTrainingDate: isoDayFromNow(-30), licenseExpiry: "2099-12-31", isActive: true })
    .onConflictDoNothing();
  await db.update(drivers).set({ userId, isActive: true }).where(eq(drivers.employeeNumber, DEMO_DRIVER_DAY.employee));
  const [driver] = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.employeeNumber, DEMO_DRIVER_DAY.employee));
  const [client] = await db.select({ id: clients.id }).from(clients).where(eq(clients.name, DEMO_INVOICE.clientName));
  const now = new Date();
  const [mission] = await db
    .insert(missions)
    .values({ clientId: client.id, orderNumber: DEMO_DRIVER_DAY.orderNumber, pickupAddress: DEMO_DRIVER_DAY.pickup, deliveryAddress: DEMO_DRIVER_DAY.delivery, pickupDate: now, status: "assigned", workflowData: { budgetPlan: { fuelBudget: 150000, roadExpensesBudget: 40000, contingencyBudget: 20000 } } })
    .returning({ id: missions.id });
  await db.insert(assignments).values({ missionId: mission.id, vehicleId, driverId: driver.id, status: "accepted" });
}

export async function seedDemo(): Promise<void> {
  assertLocalDatabase();
  await purgeReceptionOrders();
  await seedLogistics();
  await seedClientInvoices();
  await seedWorkshop();
  const technicianId = await ensureUser(DEMO_ACCOUNTS.technician);
  await ensureUser(DEMO_ACCOUNTS.secretary);
  const clientAId = await ensureUser(DEMO_ACCOUNTS.clientA);
  const clientBId = await ensureUser(DEMO_ACCOUNTS.clientB);
  await ensureUser(DEMO_ACCOUNTS.warehouse);
  await ensureUser(DEMO_ACCOUNTS.management);
  await ensureUser(DEMO_ACCOUNTS.admin);
  await ensureUser(DEMO_ACCOUNTS.recruit);

  await ensureVehicle(DEMO_VEHICLES.clientA1, "T480", clientAId);
  await ensureVehicle(DEMO_VEHICLES.clientA2, "Master", clientAId);
  await ensureVehicle(DEMO_VEHICLES.clientB1, "Premium", clientBId);
  const workshopVehicleId = await ensureVehicle(DEMO_VEHICLES.workshop, "T480", null);
  const secretaryVehicleId = await ensureVehicle(DEMO_VEHICLES.secretary, "Kerax", null);
  await seedFleetAudit(secretaryVehicleId);
  await seedDriverDay();

  await db
    .insert(parts)
    .values({ reference: DEMO_PART.reference, name: DEMO_PART.name, quantity: 20, minQuantity: 2, unitPrice: "12500", location: "Rayon A1" })
    .onConflictDoNothing();
  await db.update(parts).set({ quantity: 20 }).where(and(eq(parts.reference, DEMO_PART.reference), ne(parts.quantity, 20)));
  await seedWarehouse();

  // Intervention du technicien : ramenée à « en cours », sans demande de pièce.
  const existing = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.vehicleId, workshopVehicleId), eq(workOrders.title, DEMO_WORK_ORDER_TITLE)));
  const reset = { status: "pending" as const, technicianId, endDate: null, description: "Vidange moteur, remplacement du filtre et contrôle des freins." };
  let workOrderIds = existing.map((row) => row.id);
  if (workOrderIds.length === 0) {
    const [created] = await db
      .insert(workOrders)
      .values({ vehicleId: workshopVehicleId, title: DEMO_WORK_ORDER_TITLE, priority: "medium", ...reset })
      .returning({ id: workOrders.id });
    workOrderIds = [created.id];
  } else {
    await db.update(workOrders).set(reset).where(inArray(workOrders.id, workOrderIds));
  }
  await db.delete(partsUsed).where(inArray(partsUsed.workOrderId, workOrderIds));
  await db.delete(partsStockMovements).where(inArray(partsStockMovements.workOrderId, workOrderIds));
  await db.delete(partRequirements).where(inArray(partRequirements.workOrderId, workOrderIds));

  // Document du secrétariat : assurance qui expire dans 10 jours (alerte d'échéance).
  const documents = await db
    .select({ id: vehicleDocuments.id, expiryDate: vehicleDocuments.expiryDate })
    .from(vehicleDocuments)
    .where(and(eq(vehicleDocuments.vehicleId, secretaryVehicleId), eq(vehicleDocuments.name, DEMO_DOCUMENT_NAME)));
  if (documents.length > 0) {
    // Demandes de renouvellement créées par la démo précédente (périmètre : ce document seul).
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleDocumentId, documents.map((d) => d.id)));
  }
  writeDemoPdf("assurance-demo.pdf");
  if (documents.length === 0) {
    await db.insert(vehicleDocuments).values({
      vehicleId: secretaryVehicleId,
      name: DEMO_DOCUMENT_NAME,
      type: "assurance",
      filename: "assurance-demo.pdf",
      filesize: 4,
      fileType: "application/pdf",
      filePath: "uploads/demo/assurance-demo.pdf",
      expiryDate: isoDayFromNow(10),
    });
  } else {
    const stale = documents.filter((d) => String(d.expiryDate) !== isoDayFromNow(10)).map((d) => d.id);
    if (stale.length > 0) await db.update(vehicleDocuments).set({ expiryDate: isoDayFromNow(10) }).where(inArray(vehicleDocuments.id, stale));
  }
}

const isMain = process.argv[1] && /seed-demo\.ts$/.test(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  seedDemo()
    .then(async () => {
      console.log("seed de démo prêt");
      await pool.end();
    })
    .catch(async (error) => {
      console.error("seed de démo en échec :", error instanceof Error ? error.message : error);
      await pool.end();
      process.exit(1);
    });
}
