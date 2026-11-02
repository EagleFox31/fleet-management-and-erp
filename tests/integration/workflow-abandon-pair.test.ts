import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { workflowReminderService } from "../../server/services/workflow-reminder-service";
import { workflowService } from "../../server/services/workflow-service";
import { vehicleAcquisitionWorkflows } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * VEH3-UI-2 a laissé en base des paires `completed` + `in_progress` sous un même
 * sessionId. Abandonner le brouillon fantôme ne doit toucher que la ligne
 * `in_progress` : l'acquisition terminée reste `completed`.
 */

const ids = createIdBag();

afterAll(async () => {
  await cleanupCreated(ids);
});

async function seedPair() {
  const user = await createTestUser({ role: "workshop_manager" });
  ids.userIds.push(user.id);
  const sessionId = uniqueTestToken("abandon-pair");
  const base = { userId: user.id, sessionId, currentStep: 5, workflowData: { registrationNumber: sessionId } };
  await db.insert(vehicleAcquisitionWorkflows).values({ ...base, status: "completed", completedAt: new Date() });
  await db.insert(vehicleAcquisitionWorkflows).values({ ...base, status: "in_progress" });
  return { userId: user.id, sessionId };
}

async function statuses(userId: number, sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ status: vehicleAcquisitionWorkflows.status })
    .from(vehicleAcquisitionWorkflows)
    .where(and(eq(vehicleAcquisitionWorkflows.userId, userId), eq(vehicleAcquisitionWorkflows.sessionId, sessionId)));
  return rows.map((r) => r.status).sort();
}

describe("abandon d'un brouillon sous un sessionId deja termine", () => {
  it("workflowService (route vehicle-acquisition) : seule la ligne in_progress passe a abandoned", async () => {
    const { userId, sessionId } = await seedPair();
    await workflowService.abandonWorkflow(userId, sessionId);
    expect(await statuses(userId, sessionId)).toEqual(["abandoned", "completed"]);
  });

  it("workflowReminderService (route active) : meme garantie", async () => {
    const { userId, sessionId } = await seedPair();
    expect(await workflowReminderService.abandonWorkflow(userId, sessionId)).toBe(true);
    expect(await statuses(userId, sessionId)).toEqual(["abandoned", "completed"]);
  });
});
