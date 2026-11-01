import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicleAcquisitionWorkflows } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, VEH3 : brouillon serveur du parcours d'acquisition d'un véhicule
 * (`/api/workflows/vehicle-acquisition`, server/routes.ts, server/services/workflow-service.ts).
 * - reprise : le dernier état (étape, données, fichiers) revient tel quel ;
 * - une session se met à jour, elle ne se duplique pas ;
 * - le brouillon est celui de son auteur : un autre compte ne le lit pas ni ne le modifie ;
 * - terminé ou abandonné : il ne revient plus à la reprise ;
 * - l'étape 5 « terminé » déclenche la création du véhicule : non rejouée ici (voir le test du
 *   workflow d'activation).
 */

const ACTORS = { owner: "workshop_manager", other: "admin", technician: "technician" } as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const call = (...args: Parameters<typeof session.call>) => session.call(...args);
const PREFIX = "TEST-wf-";
const sid = () => `${PREFIX}${uniqueTestToken("s")}`;
const URL = "/api/workflows/vehicle-acquisition";

const save = (sessionId: string, extra: Record<string, unknown> = {}, actor: Actor = "owner") =>
  call("POST", URL, {
    actor,
    body: { sessionId, currentStep: 1, workflowData: { registrationNumber: "TEST-IMM" }, uploadedFiles: [], ...extra },
  });
const rows = (sessionId: string) =>
  db.select().from(vehicleAcquisitionWorkflows).where(eq(vehicleAcquisitionWorkflows.sessionId, sessionId));

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
}, 120000);

afterAll(async () => {
  await db.delete(vehicleAcquisitionWorkflows).where(like(vehicleAcquisitionWorkflows.sessionId, `${PREFIX}%`));
  await cleanupCreated(ids);
  await session?.close();
}, 120000);

describe("VEH3 : reprise du brouillon", { timeout: 180000 }, () => {
  it("enregistre, puis la reprise rend étape, données et fichiers", async () => {
    const s = sid();
    const res = await save(s, {
      currentStep: 3,
      workflowData: { registrationNumber: "TEST-IMM", brand: "Renault" },
      uploadedFiles: [{ name: "carte-grise.pdf" }],
    });
    expect(res.status).toBe(200);
    const resume = await call("GET", `${URL}/${s}`, { actor: "owner" });
    expect(resume.status).toBe(200);
    expect(resume.body).toMatchObject({
      sessionId: s,
      currentStep: 3,
      status: "in_progress",
      workflowData: { brand: "Renault" },
      uploadedFiles: [{ name: "carte-grise.pdf" }],
    });
  });

  it("une session inconnue ne rend aucun brouillon", async () => {
    const resume = await call("GET", `${URL}/${sid()}`, { actor: "owner" });
    expect(resume.status).toBe(200);
    expect(resume.body).toBeNull();
  });

  it("enregistrer deux fois la même session met à jour la même ligne", async () => {
    const s = sid();
    await save(s, { currentStep: 1 });
    await save(s, { currentStep: 2, workflowData: { registrationNumber: "TEST-IMM", brand: "Volvo" } });
    const all = await rows(s);
    expect(all).toHaveLength(1);
    expect(all[0].currentStep).toBe(2);
    expect((all[0].workflowData as any).brand).toBe("Volvo");
  });

  it("sauvegarde progressive (PATCH) : l'étape avance, la ligne reste unique", async () => {
    const s = sid();
    await save(s);
    const res = await call("PATCH", `${URL}/${s}`, { actor: "owner", body: { currentStep: 4 } });
    expect(res.status).toBe(200);
    expect(res.body.currentStep).toBe(4);
    expect(await rows(s)).toHaveLength(1);
  });

  it("sans session : 401", async () => {
    expect((await call("POST", URL, { body: { sessionId: sid(), workflowData: {} } })).status).toBe(401);
    expect((await call("GET", `${URL}/${sid()}`, {})).status).toBe(401);
  });
});

describe("VEH3 : le brouillon est à son auteur", { timeout: 180000 }, () => {
  it("un autre compte ne le lit pas", async () => {
    const s = sid();
    await save(s, {}, "owner");
    const other = await call("GET", `${URL}/${s}`, { actor: "other" });
    expect(other.body).toBeNull();
  });

  it("un autre compte ne le modifie pas, ni ne le termine", async () => {
    const s = sid();
    await save(s, { currentStep: 2 }, "owner");
    await call("PATCH", `${URL}/${s}`, { actor: "other", body: { currentStep: 4 } });
    await call("PATCH", `${URL}/${s}/complete`, { actor: "other" });
    await call("PATCH", `${URL}/${s}/abandon`, { actor: "other" });
    const [row] = await rows(s);
    expect(row.currentStep).toBe(2);
    expect(row.status).toBe("in_progress");
  });

  it("le même identifiant de session chez deux comptes donne deux brouillons distincts", async () => {
    const s = sid();
    await save(s, { currentStep: 1 }, "owner");
    await save(s, { currentStep: 3 }, "other");
    const all = await rows(s);
    expect(all).toHaveLength(2);
    const mine = await call("GET", `${URL}/${s}`, { actor: "owner" });
    expect(mine.body.currentStep).toBe(1);
  });

  // DEFAUT PRODUIT : `updateWorkflowState` (server/services/workflow-service.ts:88) étale le corps
  // du PATCH dans le `set` : `userId` y est écrit, le brouillon passe à un autre compte.
  describe("brouillon prêt pour le PATCH", () => {
    const s = sid();
    beforeAll(async () => {
      expect((await save(s, {}, "owner")).status).toBe(200);
    });

    it("témoin : le brouillon appartient à son auteur avant le PATCH", async () => {
      expect((await rows(s))[0].userId).toBe(session.userIdOf("owner"));
    });

    it.fails("le corps d'un PATCH ne réaffecte pas le brouillon à un autre compte", async () => {
      await call("PATCH", `${URL}/${s}`, { actor: "owner", body: { userId: session.userIdOf("other") } });
      expect((await rows(s))[0].userId).toBe(session.userIdOf("owner"));
    });
  });
});

describe("VEH3 : terminé et abandonné", { timeout: 180000 }, () => {
  it("abandonner : le brouillon ne revient plus ; rejouer ne casse rien", async () => {
    const s = sid();
    await save(s);
    expect((await call("PATCH", `${URL}/${s}/abandon`, { actor: "owner" })).status).toBe(200);
    expect((await call("GET", `${URL}/${s}`, { actor: "owner" })).body).toBeNull();
    expect((await call("PATCH", `${URL}/${s}/abandon`, { actor: "owner" })).status).toBe(200);
    expect((await rows(s))[0].status).toBe("abandoned");
  });

  it("terminer : statut completed et date de fin ; le brouillon ne revient plus", async () => {
    const s = sid();
    await save(s, { currentStep: 4 });
    expect((await call("PATCH", `${URL}/${s}/complete`, { actor: "owner" })).status).toBe(200);
    const [row] = await rows(s);
    expect(row.status).toBe("completed");
    expect(row.completedAt).toBeTruthy();
    expect((await call("GET", `${URL}/${s}`, { actor: "owner" })).body).toBeNull();
  });

  it("une session terminée n'est pas rouverte par un nouvel enregistrement", async () => {
    const s = sid();
    await save(s, { currentStep: 4 });
    await call("PATCH", `${URL}/${s}/complete`, { actor: "owner" });
    await save(s, { currentStep: 1 });
    const all = await rows(s);
    expect(all.filter((r) => r.status === "completed")).toHaveLength(1);
    expect(all.find((r) => r.status === "completed")!.currentStep).toBe(4);
  });
});

describe("VEH3 : entrées invalides", { timeout: 180000 }, () => {
  // DEFAUT PRODUIT : `POST /api/workflows/vehicle-acquisition` (server/routes.ts:5654) passe le corps
  // brut à `saveWorkflowState` sans validation ; l'insertion (server/services/workflow-service.ts:36-42)
  // échoue sur `session_id` / `workflow_data` NOT NULL et le catch répond 500 au lieu de 400.
  it.fails("corps sans sessionId ni données : 400, jamais 500", async () => {
    const res = await call("POST", URL, { actor: "owner", body: {} });
    expect(res.status).toBe(400);
  });

  // DEFAUT PRODUIT : même absence de validation (server/routes.ts:5654) : `currentStep: "abc"` atteint
  // l'insertion d'une colonne integer (server/services/workflow-service.ts:36-42), 500 au lieu de 400.
  it.fails("étape hors bornes ou mal typée : 400", async () => {
    const res = await call("POST", URL, {
      actor: "owner",
      body: { sessionId: sid(), currentStep: "abc", workflowData: {} },
    });
    expect(res.status).toBe(400);
  });

  // DEFAUT PRODUIT : `updateWorkflowState` rend null (server/services/workflow-service.ts:100) et
  // `PATCH /api/workflows/vehicle-acquisition/:sessionId` (server/routes.ts:5710-5711) répond 200 avec ce null.
  it.fails("PATCH d'une session inconnue : 404 et non un 200 vide", async () => {
    const res = await call("PATCH", `${URL}/${sid()}`, { actor: "owner", body: { currentStep: 2 } });
    expect(res.status).toBe(404);
  });

  describe("brouillon prêt pour le PATCH de statut", () => {
    const s = sid();
    beforeAll(async () => {
      expect((await save(s)).status).toBe(200);
    });

    it("témoin : le brouillon est en cours avant le PATCH", async () => {
      expect((await rows(s))[0].status).toBe("in_progress");
    });

    // DEFAUT PRODUIT : même étalement du corps dans le `set` (server/services/workflow-service.ts:88) :
    // `status: "completed"` clôt le brouillon sans passer par `/complete` (ni `completedAt`).
    it.fails("le corps d'un PATCH ne peut pas changer le statut du brouillon", async () => {
      await call("PATCH", `${URL}/${s}`, { actor: "owner", body: { status: "completed" } });
      expect((await rows(s))[0].status).toBe("in_progress");
    });
  });
});
