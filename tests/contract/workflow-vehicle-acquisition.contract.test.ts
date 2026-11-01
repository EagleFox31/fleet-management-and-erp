import { count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicleAcquisitionWorkflows, vehicles } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, WFL1 : brouillon d'acquisition de véhicule
 * (POST /api/workflows/vehicle-acquisition, PATCH .../:sessionId).
 * Le statut, le propriétaire et les dates ne viennent jamais du corps : un
 * `status: "completed"` à l'étape 5 activait automatiquement le véhicule.
 */

const ACTORS = { owner: "logistics", other: "admin" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const sessionIds: string[] = ["TEST-wfl-invalide", "TEST-wfl-autre-session"];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);
const noLeak = (res: { body: any }) =>
  expect(JSON.stringify(res.body)).not.toMatch(/SQLSTATE|violates|duplicate key|invalid input syntax|at \S+:\d+|ZodError/);

const newSession = () => {
  const id = uniqueTestToken("wfl");
  sessionIds.push(id);
  return id;
};
const rowsOf = (sessionId: string) =>
  db.select().from(vehicleAcquisitionWorkflows).where(eq(vehicleAcquisitionWorkflows.sessionId, sessionId));
const vehicleCount = async () => Number((await db.select({ n: count() }).from(vehicles))[0].n);

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  if (sessionIds.length > 0) {
    await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.sessionId, sessionIds));
  }
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("WFL1 : POST, liste blanche des champs", { timeout: 60000 }, () => {
  it("un brouillon naît en cours, au nom de la session, quel que soit le corps", async () => {
    const sessionId = newSession();
    const before = await vehicleCount();
    const res = await call("POST", "/api/workflows/vehicle-acquisition", {
      actor: "owner",
      body: {
        sessionId,
        currentStep: 5,
        workflowData: { brand: "TEST" },
        status: "completed",
        userId: session.userIdOf("other"),
        completedAt: new Date().toISOString(),
      },
    });
    expect(res.status).toBe(200);
    const rows = await rowsOf(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("in_progress");
    expect(rows[0].userId).toBe(session.userIdOf("owner"));
    expect(rows[0].completedAt).toBeNull();
    expect(res.body.status).toBe("in_progress");
    expect(await vehicleCount()).toBe(before);
  });

  it("double envoi : un seul brouillon, mis à jour", async () => {
    const sessionId = newSession();
    const send = (step: number) =>
      call("POST", "/api/workflows/vehicle-acquisition", {
        actor: "owner",
        body: { sessionId, currentStep: step, workflowData: { step } },
      });
    expect((await send(2)).status).toBe(200);
    expect((await send(3)).status).toBe(200);
    const rows = await rowsOf(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].currentStep).toBe(3);
  });

  it("sans session : 401", async () => {
    const res = await call("POST", "/api/workflows/vehicle-acquisition", {
      body: { sessionId: newSession(), currentStep: 1, workflowData: {} },
    });
    expect(res.status).toBe(401);
  });

  it.each([
    ["corps vide", {}],
    ["sessionId absent", { currentStep: 1, workflowData: {} }],
    ["sessionId vide", { sessionId: "  ", currentStep: 1, workflowData: {} }],
    ["étape hors 1..5", { sessionId: "TEST-wfl-invalide", currentStep: 9, workflowData: {} }],
    ["étape non entière", { sessionId: "TEST-wfl-invalide", currentStep: 1.5, workflowData: {} }],
    ["étape textuelle", { sessionId: "TEST-wfl-invalide", currentStep: "trois", workflowData: {} }],
    ["données mal typées", { sessionId: "TEST-wfl-invalide", currentStep: 1, workflowData: "texte" }],
  ])("corps invalide (%s) : 400, aucune fuite technique, rien d'écrit", async (_label, body) => {
    const res = await call("POST", "/api/workflows/vehicle-acquisition", { actor: "owner", body });
    expect(res.status).toBe(400);
    noLeak(res);
    expect(await rowsOf("TEST-wfl-invalide")).toEqual([]);
  });
});

describe("WFL1 : PATCH, liste blanche des champs", { timeout: 60000 }, () => {
  async function seedDraft() {
    const sessionId = newSession();
    const res = await call("POST", "/api/workflows/vehicle-acquisition", {
      actor: "owner",
      body: { sessionId, currentStep: 1, workflowData: { brand: "TEST" } },
    });
    expect(res.status).toBe(200);
    return sessionId;
  }

  it("statut, propriétaire et dates du corps sont ignorés ; les données légitimes sont enregistrées", async () => {
    const sessionId = await seedDraft();
    const before = await vehicleCount();
    const res = await call("PATCH", `/api/workflows/vehicle-acquisition/${sessionId}`, {
      actor: "owner",
      body: {
        status: "completed",
        currentStep: 5,
        userId: session.userIdOf("other"),
        completedAt: new Date().toISOString(),
        sessionId: "TEST-wfl-autre-session",
        workflowData: { brand: "TEST-2" },
      },
    });
    expect(res.status).toBe(200);
    const rows = await rowsOf(sessionId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("in_progress");
    expect(rows[0].userId).toBe(session.userIdOf("owner"));
    expect(rows[0].completedAt).toBeNull();
    expect(rows[0].currentStep).toBe(5);
    expect(rows[0].workflowData).toEqual({ brand: "TEST-2" });
    expect(await rowsOf("TEST-wfl-autre-session")).toEqual([]);
    expect(await vehicleCount()).toBe(before);
  });

  it("le brouillon d'un autre compte n'est pas modifiable", async () => {
    const sessionId = await seedDraft();
    await call("PATCH", `/api/workflows/vehicle-acquisition/${sessionId}`, {
      actor: "other",
      body: { currentStep: 4, workflowData: { brand: "PIRATE" } },
    });
    const [row] = await rowsOf(sessionId);
    expect(row.currentStep).toBe(1);
    expect(row.workflowData).toEqual({ brand: "TEST" });
    expect(row.userId).toBe(session.userIdOf("owner"));
  });

  it("sans session : 401", async () => {
    const res = await call("PATCH", `/api/workflows/vehicle-acquisition/${newSession()}`, { body: { currentStep: 2 } });
    expect(res.status).toBe(401);
  });

  it.each([
    ["étape hors 1..5", { currentStep: 0 }],
    ["étape textuelle", { currentStep: "abc" }],
    ["données mal typées", { workflowData: 12 }],
  ])("corps invalide (%s) : 400, aucune fuite technique, brouillon intact", async (_label, body) => {
    const sessionId = await seedDraft();
    const res = await call("PATCH", `/api/workflows/vehicle-acquisition/${sessionId}`, { actor: "owner", body });
    expect(res.status).toBe(400);
    noLeak(res);
    const [row] = await rowsOf(sessionId);
    expect(row.currentStep).toBe(1);
    expect(row.workflowData).toEqual({ brand: "TEST" });
  });
});
