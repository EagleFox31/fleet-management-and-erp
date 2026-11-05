import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { uploadedFileCandidates } from "../../server/lib/uploaded-file";
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
  return { sessionId, vehicleId: vehicle.id, document, workflowId: workflow.id };
}

describe("WorkflowDocumentService.transferDocumentsToVehicle", { timeout: 60000 }, () => {
  it("nom d'origine avec apostrophe et SQL : document créé, nom enregistré tel quel", async () => {
    const originalName = "carte d'origine'); DROP TABLE vehicle_documents; --.pdf";
    const { sessionId, vehicleId, workflowId } = await workflowWithDocument(originalName);

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);

    const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(originalName);
    expect(rows[0].type).toBe("carte_grise");
    const [source] = await db.select().from(workflowDocuments).where(eq(workflowDocuments.sessionId, sessionId));
    expect(source).toMatchObject({ isTransferred: true, vehicleId });
  });

  it("nom d'origine avec répertoires : fichier copié dans le dossier du véhicule", async () => {
    const { sessionId, vehicleId, workflowId } = await workflowWithDocument(`../../../${evilName}`);
    const vehicleDir = join(process.cwd(), "uploads", "documents", `vehicle-${vehicleId}`);

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);

    const files = readdirSync(vehicleDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(new RegExp(`^carte_grise_[0-9a-f]{12}_${evilName.replace(/[.]/g, "\.")}$`));
    const [row] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(row.filePath).toBe(`/uploads/documents/vehicle-${vehicleId}/${files[0]}`);
  });

  it("deux documents de même type et de même nom : deux fichiers distincts, chacun avec son contenu", async () => {
    const { sessionId, vehicleId, workflowId, document: first } = await workflowWithDocument("doublon.pdf");
    const second = await WorkflowDocumentService.saveWorkflowDocument({
      workflowId,
      sessionId,
      documentType: "carte_grise",
      originalName: "doublon.pdf",
      fileBuffer: Buffer.from("SECOND"),
      mimeType: "application/pdf",
      uploadedBy: first.uploadedBy,
    });
    const vehicleDir = join(process.cwd(), "uploads", "documents", `vehicle-${vehicleId}`);

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);

    const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.filePath)).size).toBe(2);
    expect(readdirSync(vehicleDir)).toHaveLength(2);
    const contents = rows.map((row) => readFileSync(join(vehicleDir, row.filename), "utf8")).sort();
    expect(contents).toEqual(["SECOND", "TEST"]);
    expect(second.id).not.toBe(first.id);
  });

  it("fichier source disparu : ce document n'est ni copié ni marqué transféré, les autres le sont", async () => {
    const { sessionId, vehicleId, document: kept, workflowId } = await workflowWithDocument("present.pdf");
    const [workflow] = await db.select().from(vehicleAcquisitionWorkflows).where(eq(vehicleAcquisitionWorkflows.sessionId, sessionId));
    const lost = await WorkflowDocumentService.saveWorkflowDocument({
      workflowId: workflow.id,
      sessionId,
      documentType: "factur_achat",
      originalName: "disparu.pdf",
      fileBuffer: Buffer.from("TEST"),
      mimeType: "application/pdf",
      uploadedBy: workflow.userId,
    });
    for (const candidate of uploadedFileCandidates(lost.filePath)) rmSync(candidate, { force: true });

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);

    const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(rows.map((row) => row.name)).toEqual(["present.pdf"]);
    const sources = await db.select().from(workflowDocuments).where(eq(workflowDocuments.sessionId, sessionId));
    const byId = new Map(sources.map((row) => [row.id, row]));
    expect(byId.get(kept.id)).toMatchObject({ isTransferred: true, vehicleId });
    expect(byId.get(lost.id)).toMatchObject({ isTransferred: false, vehicleId: null });
  });

  it("idempotent (#231) : un second transfert ne crée aucune ligne de plus", async () => {
    const { sessionId, vehicleId, workflowId } = await workflowWithDocument("une-fois.pdf");

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);
    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);

    const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(rows.map((row) => row.name)).toEqual(["une-fois.pdf"]);
  });

  it("idempotent (#231) : document refusé puis rendu disponible, transféré une seule fois au rejeu", async () => {
    const { sessionId, vehicleId, workflowId, document } = await workflowWithDocument("tardif.pdf");
    const stored = uploadedFileCandidates(document.filePath).find((candidate) => existsSync(candidate))!;
    const backup = readFileSync(stored);
    rmSync(stored, { force: true });

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);
    expect(await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId))).toHaveLength(0);

    writeFileSync(stored, backup);
    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);
    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);

    const rows = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId));
    expect(rows.map((row) => row.name)).toEqual(["tardif.pdf"]);
  });

  it("dossier du véhicule remplacé par une jonction qui mène dehors : rien copié dehors, document non transféré", async () => {
    const { sessionId, vehicleId, workflowId, document } = await workflowWithDocument("piege.pdf");
    const vehicleDir = join(process.cwd(), "uploads", "documents", `vehicle-${vehicleId}`);
    const outside = mkdtempSync(join(tmpdir(), "fleet-transfer-out-"));
    mkdirSync(join(process.cwd(), "uploads", "documents"), { recursive: true });
    rmSync(vehicleDir, { recursive: true, force: true });
    symlinkSync(outside, vehicleDir, "junction");
    try {
      await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);

      expect(readdirSync(outside)).toEqual([]);
      expect(await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicleId))).toHaveLength(0);
      const [source] = await db.select().from(workflowDocuments).where(eq(workflowDocuments.id, document.id));
      expect(source).toMatchObject({ isTransferred: false, vehicleId: null });
    } finally {
      // Le lien seul, jamais sa cible par récursion : jonction Windows (rmdir), lien symbolique ailleurs (unlink).
      if (process.platform === "win32") rmdirSync(vehicleDir);
      else unlinkSync(vehicleDir);
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("facture d'achat : rangée en « autre », seul type véhicule sans catégorie propre", async () => {
    const { sessionId, vehicleId, workflowId } = await workflowWithDocument("facture.pdf", "factur_achat");

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicleId, workflowId);

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
