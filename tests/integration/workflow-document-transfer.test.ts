import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { WorkflowDocumentService } from "../../server/services/workflow-document-service";
import { vehicleAcquisitionWorkflows, vehicleDocuments, workflowDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { cleanupTrackedDir, trackDir, type TrackedDir } from "../support/tracked-dirs";
import { createTestUser, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Transfert des documents d'un workflow d'acquisition vers le véhicule, niveau I.
 *
 * L'INSERT `vehicle_documents` était une chaîne interpolée : un nom de fichier
 * contenant une apostrophe cassait la requête (ou injectait du SQL). Le nom
 * d'origine servait aussi de nom disque sans en retirer les répertoires.
 */

const ids = createIdBag();
const workflowIds: number[] = [];
// Dossiers suivis : un dossier versionné (uploads/documents/vehicle-1/.gitkeep) ne perd que ce que le test a créé.
const vehicleDirs: TrackedDir[] = [];
// Sans le correctif, ces noms finissent hors du dossier prévu : uniques pour être retrouvés.
const escapeMarker = uniqueTestToken("escape");
const evilName = `${uniqueTestToken("evil")}.pdf`;
const workflowsRoot = join(process.cwd(), "uploads", "workflows");

afterAll(async () => {
  // Disque d'abord : un ménage base qui échoue ne doit pas laisser de fichier.
  for (const dir of vehicleDirs) cleanupTrackedDir(dir);
  rmSync(join(process.cwd(), escapeMarker), { recursive: true, force: true });
  rmSync(join(process.cwd(), "uploads", "documents", evilName), { force: true });
  for (const entry of existsSync(workflowsRoot) ? readdirSync(workflowsRoot) : []) {
    if (entry.startsWith(escapeMarker)) rmSync(join(workflowsRoot, entry), { force: true });
  }
  // workflow_documents.vehicle_id n'est pas en cascade : le workflow part avant le véhicule.
  if (workflowIds.length > 0) {
    await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
  }
  await cleanupCreated(ids);
});

async function workflowWithDocument(originalName: string, documentType: "carte_grise" | "factur_achat" = "carte_grise") {
  const user = await createTestUser({ role: "admin" });
  ids.userIds.push(user.id);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleDirs.push(trackDir(join(process.cwd(), "uploads", "documents", `vehicle-${vehicle.id}`)));

  const sessionId = uniqueTestToken("wf");
  const [workflow] = await db
    .insert(vehicleAcquisitionWorkflows)
    .values({ userId: user.id, sessionId, workflowData: {} })
    .returning();
  workflowIds.push(workflow.id);
  vehicleDirs.push(trackDir(join(process.cwd(), "uploads", "workflows", sessionId)));

  const document = await WorkflowDocumentService.saveWorkflowDocument({
    workflowId: workflow.id,
    sessionId,
    documentType,
    originalName,
    fileBuffer: Buffer.from("TEST"),
    mimeType: "application/pdf",
    uploadedBy: user.id,
  });
  return { sessionId, vehicleId: vehicle.id, document };
}

describe("WorkflowDocumentService.transferDocumentsToVehicle", { timeout: 60000 }, () => {
  it("nom d'origine avec apostrophe et SQL : document créé, nom enregistré tel quel", async () => {
    const originalName = "carte d'origine'); DROP TABLE vehicle_documents; --.pdf";
    const { sessionId, vehicleId } = await workflowWithDocument(originalName);

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId);

    const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(originalName);
    expect(rows[0].type).toBe("carte_grise");
    const [source] = await db.select().from(workflowDocuments).where(eq(workflowDocuments.sessionId, sessionId));
    expect(source).toMatchObject({ isTransferred: true, vehicleId });
  });

  it("nom d'origine avec répertoires : fichier copié dans le dossier du véhicule", async () => {
    const { sessionId, vehicleId } = await workflowWithDocument(`../../../${evilName}`);
    const vehicleDir = join(process.cwd(), "uploads", "documents", `vehicle-${vehicleId}`);

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId);

    expect(readdirSync(vehicleDir)).toEqual([`carte_grise_${evilName}`]);
    const [row] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(row.filePath).toBe(`/uploads/documents/vehicle-${vehicleId}/carte_grise_${evilName}`);
  });

  it("facture d'achat : rangée en « autre », seul type véhicule sans catégorie propre", async () => {
    const { sessionId, vehicleId } = await workflowWithDocument("facture.pdf", "factur_achat");

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId);

    const [row] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(row.type).toBe("autre");
  });
});

describe("WorkflowDocumentService.saveWorkflowDocument", { timeout: 60000 }, () => {
  const okSession = uniqueTestToken("wf");
  vehicleDirs.push(trackDir(join(workflowsRoot, okSession)));

  it.each([
    ["sessionId remontant", { sessionId: `../../${escapeMarker}`, documentType: "carte_grise" }],
    ["type hors liste", { sessionId: okSession, documentType: `../${escapeMarker}` }],
  ])("%s : AppError 400, rien n'est écrit", async (_label, input) => {
    await expect(
      WorkflowDocumentService.saveWorkflowDocument({
        workflowId: 0,
        sessionId: input.sessionId,
        documentType: input.documentType as "carte_grise",
        originalName: "a.pdf",
        fileBuffer: Buffer.from("TEST"),
        mimeType: "application/pdf",
        uploadedBy: 0,
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(existsSync(join(process.cwd(), escapeMarker))).toBe(false);
    expect(readdirSync(workflowsRoot).filter((entry) => entry.startsWith(escapeMarker))).toEqual([]);
    expect(existsSync(join(workflowsRoot, okSession))).toBe(false);
  });
});
