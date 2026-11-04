import { existsSync, rmSync } from "fs";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { WorkflowDocumentService } from "../../server/services/workflow-document-service";
import { vehicleAcquisitionWorkflows, vehicleDocuments, workflowDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { cleanupTrackedDir, trackDir } from "../support/tracked-dirs";
import { createTestUser, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau I : `sessionId` n'est pas unique entre utilisateurs (deux comptes peuvent avoir
 * le même). Le transfert et le nettoyage doivent viser le workflow, pas le seul sessionId.
 */

const ids = createIdBag();
const workflowIds: number[] = [];
const sessionId = uniqueTestToken("wf-shared");
const dir = trackDir(join(process.cwd(), "uploads", "workflows", sessionId));
const vehicleDirs = [] as ReturnType<typeof trackDir>[];
const now = new Date("2000-01-15T12:00:00Z");

afterAll(async () => {
  cleanupTrackedDir(dir);
  for (const d of vehicleDirs) cleanupTrackedDir(d);
  rmSync(join(process.cwd(), "uploads", "workflows", sessionId), { recursive: true, force: true });
  if (workflowIds.length > 0) {
    await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
  }
  await cleanupCreated(ids);
});

async function seedPair(statusOfB: "in_progress" | "abandoned") {
  const userA = await createTestUser({ role: "admin" });
  const userB = await createTestUser({ role: "admin" });
  ids.userIds.push(userA.id, userB.id);
  const make = async (userId: number, status: "in_progress" | "abandoned") => {
    const [workflow] = await db
      .insert(vehicleAcquisitionWorkflows)
      .values({ userId, sessionId, workflowData: {}, status, updatedAt: status === "abandoned" ? new Date("1999-12-01T00:00:00Z") : new Date() })
      .returning();
    workflowIds.push(workflow.id);
    const document = await WorkflowDocumentService.saveWorkflowDocument({
      workflowId: workflow.id,
      sessionId,
      documentType: "carte_grise",
      originalName: `doc-${userId}.pdf`,
      fileBuffer: Buffer.from("TEST"),
      mimeType: "application/pdf",
      uploadedBy: userId,
    });
    return { workflow, document };
  };
  const a = await make(userA.id, "in_progress");
  const b = await make(userB.id, statusOfB);
  return { a, b };
}

describe("Workflows homonymes (même sessionId, deux comptes)", { timeout: 120000 }, () => {
  it("l'abandon de B nettoyé : les documents (lignes et fichier) de A survivent", async () => {
    const { a, b } = await seedPair("abandoned");

    await WorkflowDocumentService.cleanupAbandonedWorkflowDocuments({ now });

    const rows = await db.select().from(workflowDocuments).where(eq(workflowDocuments.sessionId, sessionId));
    expect(rows.map((row) => row.id)).toEqual([a.document.id]);
    expect(rows.map((row) => row.id)).not.toContain(b.document.id);
    expect(existsSync(join(process.cwd(), a.document.filePath.replace(/^\//, "")))).toBe(true);
  });

  it("le transfert de B n'emporte pas les documents de A", async () => {
    const { a, b } = await seedPair("in_progress");
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    vehicleDirs.push(trackDir(join(process.cwd(), "uploads", "documents", `vehicle-${vehicle.id}`)));

    await WorkflowDocumentService.transferDocumentsToVehicle(sessionId, vehicle.id, b.workflow.id);

    const copied = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, vehicle.id));
    expect(copied.map((row) => row.name)).toEqual([b.document.originalName]);
    const [untouched] = await db.select().from(workflowDocuments).where(eq(workflowDocuments.id, a.document.id));
    expect(untouched).toMatchObject({ isTransferred: false, vehicleId: null });
  });
});
