import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workflowService } from "../../server/services/workflow-service";
import { vehicleAcquisitionWorkflows } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Clôture d'un brouillon quand le même compte a déjà abandonné une session du même sessionId.
 * Sans contrainte unique (user_id, session_id), deux lignes coexistent : la relecture après la
 * clôture ne doit pas retomber sur l'ancienne ligne abandonnée et répondre 409.
 */

const ids = createIdBag();
const workflowIds: number[] = [];

afterAll(async () => {
  if (workflowIds.length > 0) {
    await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
  }
  await cleanupCreated(ids);
});

describe("workflowService.completeWorkflow", { timeout: 60000 }, () => {
  it("ancienne ligne abandonnée + nouvelle en cours, même sessionId : la clôture réussit", async () => {
    const user = await createTestUser({ role: "admin" });
    ids.userIds.push(user.id);
    const sessionId = uniqueTestToken("wf");
    const rows = await db
      .insert(vehicleAcquisitionWorkflows)
      .values([
        { userId: user.id, sessionId, workflowData: {}, status: "abandoned", updatedAt: new Date(Date.now() - 3600_000) },
        { userId: user.id, sessionId, workflowData: {}, status: "in_progress" },
      ])
      .returning({ id: vehicleAcquisitionWorkflows.id });
    workflowIds.push(...rows.map((row) => row.id));

    await expect(workflowService.completeWorkflow(user.id, sessionId)).resolves.toBe(true);
    // Rejouer sur une session terminée reste un succès.
    await expect(workflowService.completeWorkflow(user.id, sessionId)).resolves.toBe(true);
  });

  it("seule une ligne abandonnée : 409", async () => {
    const user = await createTestUser({ role: "admin" });
    ids.userIds.push(user.id);
    const sessionId = uniqueTestToken("wf");
    const [row] = await db
      .insert(vehicleAcquisitionWorkflows)
      .values({ userId: user.id, sessionId, workflowData: {}, status: "abandoned" })
      .returning({ id: vehicleAcquisitionWorkflows.id });
    workflowIds.push(row.id);

    await expect(workflowService.completeWorkflow(user.id, sessionId)).rejects.toMatchObject({ status: 409 });
  });
});
