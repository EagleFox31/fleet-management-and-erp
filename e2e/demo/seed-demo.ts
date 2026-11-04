/**
 * Seed des démos par profil (e2e/demo/*.spec.ts). Base locale jetable uniquement.
 *
 * Usage : node --env-file=.env --import tsx e2e/demo/seed-demo.ts
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
import bcrypt from "bcryptjs";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db, pool } from "../../server/db";
import { documentRenewalRequests, partRequirements, parts, partsStockMovements, partsUsed, users, vehicleDocuments, vehicles, workOrders } from "../../shared/schema";

export const DEMO_ACCOUNTS = {
  technician: { username: "tech1", password: "tech123", name: "Paul Mbarga", role: "technician" },
  secretary: { username: "secretaire1", password: "secret123", name: "Awa Ndiaye", role: "secretary" },
  clientA: { username: "client1", password: "client123", name: "Transports Kamga", role: "client" },
  clientB: { username: "client2", password: "client123", name: "Logistique Fotso", role: "client" },
  warehouse: { username: "fatou", password: "warehouse123", name: "Fatoumata Diallo", role: "warehouse" },
} as const;

export const DEMO_VEHICLES = {
  clientA1: "DEMO-C1-001",
  clientA2: "DEMO-C1-002",
  clientB1: "DEMO-C2-001",
  workshop: "DEMO-ATL-001",
  secretary: "DEMO-SEC-001",
} as const;

export const DEMO_PART = { reference: "DEMO-FILTRE-HUILE", name: "Filtre à huile démo" } as const;
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
  if (current && (current.role !== account.role || !passwordOk)) {
    await db.update(users).set({ role: account.role as typeof users.$inferInsert.role, password: await bcrypt.hash(account.password, 4) }).where(eq(users.id, current.id));
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

function isoDayFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function seedDemo(): Promise<void> {
  assertLocalDatabase();
  const technicianId = await ensureUser(DEMO_ACCOUNTS.technician);
  await ensureUser(DEMO_ACCOUNTS.secretary);
  const clientAId = await ensureUser(DEMO_ACCOUNTS.clientA);
  const clientBId = await ensureUser(DEMO_ACCOUNTS.clientB);
  await ensureUser(DEMO_ACCOUNTS.warehouse);

  await ensureVehicle(DEMO_VEHICLES.clientA1, "T480", clientAId);
  await ensureVehicle(DEMO_VEHICLES.clientA2, "Master", clientAId);
  await ensureVehicle(DEMO_VEHICLES.clientB1, "Premium", clientBId);
  const workshopVehicleId = await ensureVehicle(DEMO_VEHICLES.workshop, "T480", null);
  const secretaryVehicleId = await ensureVehicle(DEMO_VEHICLES.secretary, "Kerax", null);

  await db
    .insert(parts)
    .values({ reference: DEMO_PART.reference, name: DEMO_PART.name, quantity: 20, minQuantity: 2, unitPrice: "12500", location: "Rayon A1" })
    .onConflictDoNothing();
  await db.update(parts).set({ quantity: 20 }).where(and(eq(parts.reference, DEMO_PART.reference), ne(parts.quantity, 20)));

  // Intervention du technicien : ramenée à « en cours », sans demande de pièce.
  const existing = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.vehicleId, workshopVehicleId), eq(workOrders.title, DEMO_WORK_ORDER_TITLE)));
  const reset = { status: "in_progress" as const, technicianId, endDate: null, description: "Vidange moteur, remplacement du filtre et contrôle des freins." };
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
    .select({ id: vehicleDocuments.id })
    .from(vehicleDocuments)
    .where(and(eq(vehicleDocuments.vehicleId, secretaryVehicleId), eq(vehicleDocuments.name, DEMO_DOCUMENT_NAME)));
  if (documents.length > 0) {
    // Demandes de renouvellement créées par la démo précédente (périmètre : ce document seul).
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleDocumentId, documents.map((d) => d.id)));
  }
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
    await db.update(vehicleDocuments).set({ expiryDate: isoDayFromNow(10) }).where(inArray(vehicleDocuments.id, documents.map((d) => d.id)));
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
