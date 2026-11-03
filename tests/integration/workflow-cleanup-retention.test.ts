import { existsSync, rmSync } from "fs";
import { join } from "path";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { WorkflowDocumentService } from "../../server/services/workflow-document-service";
import { vehicleAcquisitionWorkflows, workflowDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau I, rétention des documents de workflow abandonné.
 * La clause « abandonné depuis plus de 7 jours » était un simple commentaire dans le `where` :
 * un workflow abandonné la veille perdait ses fichiers et ses lignes au premier nettoyage.
 *
 * `now` est placé en 2000 : seuls les workflows de ce test, datés artificiellement, sont
 * assez anciens pour être visés. La base de test partagée n'est pas touchée.
 */

const ids = createIdBag();
const now = new Date("2000-01-15T12:00:00Z");
const daysBefore = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const sessions = {
  recent: uniqueTestToken("wf-ret-recent"),
  old: uniqueTestToken("wf-ret-old"),
  active: uniqueTestToken("wf-ret-active"),
};
const dirOf = (sessionId: string) => join(process.cwd(), "uploads", "workflows", sessionId);

afterAll(async () => {
  for (const sessionId of Object.values(sessions)) rmSync(dirOf(sessionId), { recursive: true, force: true });
  await db.delete(workflowDocuments).where(inArray(workflowDocuments.sessionId, Object.values(sessions)));
  await cleanupCreated(ids);
});

describe("Nettoyage des workflows abandonnés : délai de 7 jours", { timeout: 120000 }, () => {
  it("purge l'abandon de 8 jours, garde celui de la veille et le workflow en cours", async () => {
    const user = await createTestUser({ role: "admin" });
    ids.userIds.push(user.id);

    const seed = async (sessionId: string, status: "abandoned" | "in_progress", updatedAt: Date) => {
      const [workflow] = await db
        .insert(vehicleAcquisitionWorkflows)
        .values({ userId: user.id, sessionId, workflowData: {}, status, updatedAt })
        .returning();
      await WorkflowDocumentService.saveWorkflowDocument({
        workflowId: workflow.id,
        sessionId,
        documentType: "carte_grise",
        originalName: "carte.pdf",
        fileBuffer: Buffer.from("%PDF-1.4 test"),
        mimeType: "application/pdf",
        uploadedBy: user.id,
      });
    };
    await seed(sessions.recent, "abandoned", daysBefore(1));
    await seed(sessions.old, "abandoned", daysBefore(8));
    await seed(sessions.active, "in_progress", daysBefore(30));

    await WorkflowDocumentService.cleanupAbandonedWorkflowDocuments({ now });

    const remaining = await db
      .select({ sessionId: workflowDocuments.sessionId })
      .from(workflowDocuments)
      .where(inArray(workflowDocuments.sessionId, Object.values(sessions)));
    expect(remaining.map((row) => row.sessionId).sort()).toEqual([sessions.active, sessions.recent].sort());
    expect(existsSync(dirOf(sessions.recent))).toBe(true);
    expect(existsSync(dirOf(sessions.active))).toBe(true);
    expect(existsSync(dirOf(sessions.old))).toBe(false);
  });
});
