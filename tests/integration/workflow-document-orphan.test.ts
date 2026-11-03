import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { afterAll, describe, expect, it } from "vitest";
import { WorkflowDocumentService } from "../../server/services/workflow-document-service";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau I, document de workflow d'acquisition : pas de fichier orphelin.
 * Le fichier était écrit sur disque avant l'INSERT ; un INSERT refusé (ici, workflow
 * inexistant : clé étrangère) laissait le fichier sous `uploads/workflows/<session>/`
 * sans aucune ligne pour le retrouver ni le supprimer.
 */

const ids = createIdBag();
const sessionId = uniqueTestToken("wf-orphan");
const sessionDir = join(process.cwd(), "uploads", "workflows", sessionId);

afterAll(async () => {
  rmSync(sessionDir, { recursive: true, force: true });
  await cleanupCreated(ids);
});

describe("Document de workflow : enregistrement refusé", { timeout: 120000 }, () => {
  it("INSERT en échec -> l'erreur remonte et aucun fichier ne reste sur disque", async () => {
    const user = await createTestUser({ role: "admin" });
    ids.userIds.push(user.id);

    await expect(
      WorkflowDocumentService.saveWorkflowDocument({
        workflowId: 2_147_483_000,
        sessionId,
        documentType: "carte_grise",
        originalName: "carte.pdf",
        fileBuffer: Buffer.from("%PDF-1.4 test"),
        mimeType: "application/pdf",
        uploadedBy: user.id,
      }),
    ).rejects.toThrow();

    const left = existsSync(sessionDir) ? readdirSync(sessionDir) : [];
    expect(left).toEqual([]);
  });
});
