import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { vehicleDocuments, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Anciens bouchons de `server/storage.ts`, niveau I.
 *
 * - `deleteVehicleDocument` renvoyait false : la route répondait 204 sans rien
 *   supprimer, ni la ligne ni le fichier.
 * - `getWorkOrdersByTechnicianId` et `getWorkOrdersByOwner` renvoyaient une
 *   liste vide : un client ne voyait aucun OT.
 * - `getWorkOrdersForTechnician` : `OR` sans parenthèses, le filtre de statut ne
 *   s'appliquait qu'aux OT non assignés.
 */

const ids = createIdBag();
const workOrderIds: number[] = [];
const uploadsSubdir = uniqueTestToken("docs");
const uploadsDir = join(process.cwd(), "uploads", uploadsSubdir);
const outsideDir = join(tmpdir(), uniqueTestToken("docs"));

afterAll(async () => {
  if (workOrderIds.length > 0) {
    await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
  }
  // Documents : supprimés en cascade avec le véhicule.
  await cleanupCreated(ids);
  rmSync(uploadsDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

async function newVehicle(ownerId?: number) {
  const vehicle = await createTestVehicle({ ownerId });
  ids.vehicleIds.push(vehicle.id);
  return vehicle;
}

async function newUser(role: "technician" | "client") {
  const user = await createTestUser({ role });
  ids.userIds.push(user.id);
  return user;
}

async function newWorkOrder(vehicleId: number, values: Partial<typeof workOrders.$inferInsert> = {}) {
  const [row] = await db
    .insert(workOrders)
    .values({ vehicleId, title: "TEST OT", status: "pending", ...values })
    .returning();
  workOrderIds.push(row.id);
  return row;
}

function writeFile(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "TEST");
  return path;
}

async function newDocument(vehicleId: number, filePath: string) {
  const [row] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId, name: "TEST doc", type: "autre", filename: "a.pdf", filesize: 4, fileType: "application/pdf", filePath })
    .returning();
  return row;
}

async function documentExists(id: number) {
  const rows = await db.select({ id: vehicleDocuments.id }).from(vehicleDocuments).where(eq(vehicleDocuments.id, id));
  return rows.length > 0;
}

describe("storage.deleteVehicleDocument", { timeout: 120000 }, () => {
  it("supprime la ligne et le fichier ; un second appel répond false", async () => {
    const vehicle = await newVehicle();
    const file = writeFile(uploadsDir, "multer.pdf");
    const doc = await newDocument(vehicle.id, join("uploads", uploadsSubdir, "multer.pdf"));

    expect(await storage.deleteVehicleDocument(doc.id)).toBe(true);
    expect(await documentExists(doc.id)).toBe(false);
    expect(existsSync(file)).toBe(false);

    expect(await storage.deleteVehicleDocument(doc.id)).toBe(false);
  });

  it("ancien chemin « /uploads/... » : le fichier est aussi supprimé", async () => {
    const vehicle = await newVehicle();
    const file = writeFile(uploadsDir, "legacy.pdf");
    const doc = await newDocument(vehicle.id, `/uploads/${uploadsSubdir}/legacy.pdf`);

    expect(await storage.deleteVehicleDocument(doc.id)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("fichier partagé par deux documents : conservé jusqu'à la dernière suppression", async () => {
    const vehicle = await newVehicle();
    const file = writeFile(uploadsDir, "shared.pdf");
    const stored = join("uploads", uploadsSubdir, "shared.pdf");
    const first = await newDocument(vehicle.id, stored);
    const second = await newDocument(vehicle.id, stored);

    expect(await storage.deleteVehicleDocument(first.id)).toBe(true);
    expect(existsSync(file)).toBe(true);
    expect(await documentExists(second.id)).toBe(true);

    expect(await storage.deleteVehicleDocument(second.id)).toBe(true);
    expect(existsSync(file)).toBe(false);
  });

  it("chemin hors de uploads/ : ligne supprimée, fichier intact", async () => {
    const vehicle = await newVehicle();
    const file = writeFile(outsideDir, "outside.pdf");
    const doc = await newDocument(vehicle.id, file);

    expect(await storage.deleteVehicleDocument(doc.id)).toBe(true);
    expect(await documentExists(doc.id)).toBe(false);
    expect(existsSync(file)).toBe(true);
  });

  it("fichier déjà absent du disque : la ligne est quand même supprimée", async () => {
    const vehicle = await newVehicle();
    const doc = await newDocument(vehicle.id, "uploads/test/absent.pdf");

    expect(await storage.deleteVehicleDocument(doc.id)).toBe(true);
    expect(await documentExists(doc.id)).toBe(false);
  });
});

describe("listes d'OT par technicien et par propriétaire", { timeout: 120000 }, () => {
  it("getWorkOrdersByTechnicianId : seulement les OT du technicien, technicien joint", async () => {
    const [tech, other] = [await newUser("technician"), await newUser("technician")];
    const vehicle = await newVehicle();
    const mine = await newWorkOrder(vehicle.id, { technicianId: tech.id });
    const theirs = await newWorkOrder(vehicle.id, { technicianId: other.id });
    const unassigned = await newWorkOrder(vehicle.id);

    const rows = await storage.getWorkOrdersByTechnicianId(tech.id);

    expect(rows.map((r) => r.id)).toEqual([mine.id]);
    expect(rows[0]).toMatchObject({ technicianName: tech.name, vehicleRegistration: vehicle.registrationNumber });
    expect([theirs.id, unassigned.id]).not.toContain(rows[0].id);
  });

  it("getWorkOrdersForTechnician : le filtre de statut vaut aussi pour ses propres OT", async () => {
    const tech = await newUser("technician");
    const vehicle = await newVehicle();
    const minePending = await newWorkOrder(vehicle.id, { technicianId: tech.id, status: "pending" });
    const mineCompleted = await newWorkOrder(vehicle.id, { technicianId: tech.id, status: "completed" });
    const unassignedPending = await newWorkOrder(vehicle.id, { status: "pending" });

    const { workOrders: rows } = await storage.getWorkOrdersForTechnician(tech.id, "pending", undefined, 500);
    const returned = rows.map((r) => r.id);

    expect(returned).toEqual(expect.arrayContaining([minePending.id, unassignedPending.id]));
    expect(returned).not.toContain(mineCompleted.id);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("getWorkOrdersByOwner : seulement les véhicules du client, filtres et total cohérents", async () => {
    const [owner, otherOwner] = [await newUser("client"), await newUser("client")];
    const [ownVehicle, otherVehicle] = [await newVehicle(owner.id), await newVehicle(otherOwner.id)];
    const ownPending = await newWorkOrder(ownVehicle.id, { status: "pending", priority: "high" });
    const ownCompleted = await newWorkOrder(ownVehicle.id, { status: "completed" });
    await newWorkOrder(otherVehicle.id);

    const all = await storage.getWorkOrdersByOwner(owner.id);
    expect(all.total).toBe(2);
    expect(all.workOrders.map((r) => r.id).sort()).toEqual([ownPending.id, ownCompleted.id].sort());

    const pending = await storage.getWorkOrdersByOwner(owner.id, "pending");
    expect(pending).toMatchObject({ total: 1, workOrders: [{ id: ownPending.id }] });

    const high = await storage.getWorkOrdersByOwner(owner.id, undefined, "high");
    expect(high.workOrders.map((r) => r.id)).toEqual([ownPending.id]);

    const paged = await storage.getWorkOrdersByOwner(owner.id, undefined, undefined, 1, 0);
    expect(paged.workOrders).toHaveLength(1);
    expect(paged.total).toBe(2);
  });
});
