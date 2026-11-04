import { describe, expect, it, vi } from "vitest";

/**
 * Une panne base sur l'abandon d'un brouillon n'est pas une absence : le service lève une
 * AppError 500 (cause conservée), il ne renvoie plus `false` qui se traduisait en 404.
 */
const dbState = vi.hoisted(() => ({ failure: null as Error | null, owned: true }));

vi.mock("../../../server/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => (dbState.failure ? Promise.reject(dbState.failure) : Promise.resolve([])),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(dbState.owned ? [{ id: 1 }] : []) }),
      }),
    }),
  },
}));

import { workflowReminderService } from "../../../server/services/workflow-reminder-service";

describe("workflowReminderService.abandonWorkflow", () => {
  it("panne base : AppError 500 lisible, cause conservée", async () => {
    dbState.failure = new Error('relation "vehicle_acquisition_workflows" does not exist');
    await expect(workflowReminderService.abandonWorkflow(1, "S")).rejects.toMatchObject({
      status: 500,
      message: expect.not.stringMatching(/relation|does not exist/),
      cause: dbState.failure,
    });
  });

  it("session inconnue : false (la route répond 404)", async () => {
    dbState.failure = null;
    dbState.owned = false;
    await expect(workflowReminderService.abandonWorkflow(1, "S")).resolves.toBe(false);
  });

  it("session de l'utilisateur : true", async () => {
    dbState.failure = null;
    dbState.owned = true;
    await expect(workflowReminderService.abandonWorkflow(1, "S")).resolves.toBe(true);
  });
});
