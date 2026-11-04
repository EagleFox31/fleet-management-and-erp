import { rmSync } from "node:fs";
import { join } from "node:path";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicleAcquisitionWorkflows, workflowDocuments } from "../../shared/schema";
import { leakText } from "../support/api-error";
import { startContractSession } from "../support/contract-session";
import { uniqueTestToken } from "../support/ids";

/**
 * Lot R2 : les 7 écritures du parcours d'acquisition portent une garde déclarée et un corps validé.
 *
 *  - Rôles admis : ceux qui peuvent alimenter une session (admin, secrétariat, logistique, chef
 *    d'atelier, client). Les autres reçoivent 403 de la garde.
 *  - Cloison : une session est celle de son auteur. Un autre client reçoit 404 (sessions) ; les
 *    documents gardent le 403 « n'appartient pas à votre compte » du handler.
 *  - Corps invalide : 400 VALIDATION avec errors[] par champ, sans détail technique.
 */
type Actor = "clientA" | "clientB" | "technician" | "admin";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;

const PREFIX = "TEST-r2-";
const sid = () => `${PREFIX}${uniqueTestToken("s")}`;
const URL = "/api/workflows/vehicle-acquisition";
const uploadDirs: string[] = [];

beforeAll(async () => {
  session = await startContractSession({ clientA: "client", clientB: "client", technician: "technician", admin: "admin" });
}, 120000);

afterAll(async () => {
  await db.delete(workflowDocuments).where(like(workflowDocuments.sessionId, `${PREFIX}%`));
  await db.delete(vehicleAcquisitionWorkflows).where(like(vehicleAcquisitionWorkflows.sessionId, `${PREFIX}%`));
  for (const dir of uploadDirs) rmSync(join(process.cwd(), "uploads", "workflows", dir), { recursive: true, force: true });
  await session?.stop();
}, 120000);

const rowOf = async (sessionId: string) =>
  (await db.select().from(vehicleAcquisitionWorkflows).where(eq(vehicleAcquisitionWorkflows.sessionId, sessionId)))[0];

const create = (sessionId: string, actor: Actor = "clientA", extra: Record<string, unknown> = {}) =>
  session.call("POST", URL, {
    actor,
    body: { sessionId, currentStep: 1, workflowData: { registrationNumber: "TEST-IMM", purchasePrice: 1200 }, ...extra },
  });

function expectCleanError(res: { body: any }) {
  expect(typeof res.body.message).toBe("string");
  expect(typeof res.body.requestId).toBe("string");
  expect(leakText(res.body)).not.toMatch(/stack|SELECT|Error:|ZodError|issues/);
}

function expectValidation(res: { status: number; body: any }) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  expect(res.body.code).toBe("VALIDATION");
  expect(Array.isArray(res.body.errors) && res.body.errors.length).toBeGreaterThan(0);
  for (const e of res.body.errors) expect(typeof e.field).toBe("string");
  expectCleanError(res);
}

describe("R2 : POST /api/workflows/vehicle-acquisition", { timeout: 120000 }, () => {
  it("le client crée sa session (purchasePrice accepté dans workflowData)", async () => {
    const s = sid();
    const res = await create(s);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await rowOf(s);
    expect(row.userId).toBe(session.userId("clientA"));
    expect((row.workflowData as any).purchasePrice).toBe(1200);
  });

  it("technicien refusé (403)", async () => {
    const res = await create(sid(), "technician");
    expect(res.status).toBe(403);
    expectCleanError(res);
  });

  it("corps invalide : 400 errors[]", async () => {
    expectValidation(await create(sid(), "clientA", { currentStep: "x" }));
  });

  it("le même sessionId chez le client B donne un brouillon distinct, jamais celui de A", async () => {
    const s = sid();
    await create(s, "clientA");
    expect((await create(s, "clientB")).status).toBe(200);
    const rows = await db.select().from(vehicleAcquisitionWorkflows).where(eq(vehicleAcquisitionWorkflows.sessionId, s));
    expect(rows.map((r) => r.userId).sort()).toEqual([session.userId("clientA"), session.userId("clientB")].sort());
  });
});

describe("R2 : PATCH /api/workflows/vehicle-acquisition/:sessionId", { timeout: 120000 }, () => {
  it("le client modifie sa session ; le client B reçoit 404 et rien ne bouge", async () => {
    const s = sid();
    await create(s);
    const own = await session.call("PATCH", `${URL}/${s}`, { actor: "clientA", body: { currentStep: 3 } });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    const foreign = await session.call("PATCH", `${URL}/${s}`, { actor: "clientB", body: { currentStep: 5 } });
    expect(foreign.status).toBe(404);
    expectCleanError(foreign);
    expect((await rowOf(s)).currentStep).toBe(3);
  });

  it("technicien refusé (403)", async () => {
    const s = sid();
    await create(s);
    expect((await session.call("PATCH", `${URL}/${s}`, { actor: "technician", body: { currentStep: 2 } })).status).toBe(403);
  });

  it("corps invalide : 400 errors[]", async () => {
    const s = sid();
    await create(s);
    expectValidation(await session.call("PATCH", `${URL}/${s}`, { actor: "clientA", body: { currentStep: 99 } }));
  });
});

describe.each([
  { label: "complete", path: (s: string) => `${URL}/${s}/complete`, status: "completed" },
  { label: "abandon", path: (s: string) => `${URL}/${s}/abandon`, status: "abandoned" },
  { label: "active abandon", path: (s: string) => `/api/workflows/active/${s}/abandon`, status: "abandoned" },
])("R2 : PATCH $label", { timeout: 120000 }, ({ path, status }) => {
  it("le client A clôt sa session ; le client B reçoit 404 et la session reste en cours", async () => {
    const s = sid();
    await create(s);
    const foreign = await session.call("PATCH", path(s), { actor: "clientB" });
    expect(foreign.status, JSON.stringify(foreign.body)).toBe(404);
    expectCleanError(foreign);
    expect((await rowOf(s)).status).toBe("in_progress");
    const own = await session.call("PATCH", path(s), { actor: "clientA" });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect((await rowOf(s)).status).toBe(status);
  });

  it("technicien refusé (403), session intacte", async () => {
    const s = sid();
    await create(s);
    const res = await session.call("PATCH", path(s), { actor: "technician" });
    expect(res.status).toBe(403);
    expect((await rowOf(s)).status).toBe("in_progress");
  });
});

describe("R2 : clôture d'une session selon son statut", { timeout: 120000 }, () => {
  it("complete sur une session abandonnée : 409 lisible, le statut reste abandonné", async () => {
    const s = sid();
    await create(s);
    expect((await session.call("PATCH", `${URL}/${s}/abandon`, { actor: "clientA" })).status).toBe(200);
    const res = await session.call("PATCH", `${URL}/${s}/complete`, { actor: "clientA" });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expectCleanError(res);
    expect((await rowOf(s)).status).toBe("abandoned");
  });

  it("complete rejoué sur une session déjà terminée : 200, statut inchangé", async () => {
    const s = sid();
    await create(s);
    expect((await session.call("PATCH", `${URL}/${s}/complete`, { actor: "clientA" })).status).toBe(200);
    const again = await session.call("PATCH", `${URL}/${s}/complete`, { actor: "clientA" });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await rowOf(s)).status).toBe("completed");
  });
});

describe("R2 : documents de session", { timeout: 120000 }, () => {
  const upload = (s: string, actor: Actor, workflowId: number, fields: Record<string, string> = { documentType: "carte_grise" }) => {
    uploadDirs.push(s);
    const form = new FormData();
    form.append("workflowId", String(workflowId));
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("document", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-doc.pdf");
    return session.raw("POST", `/api/workflows/${s}/documents`, actor, form);
  };

  it("POST : le client A téléverse, le client B et le technicien sont refusés (403), un corps invalide donne 400 errors[]", async () => {
    const s = sid();
    await create(s);
    const wf = (await rowOf(s)).id;

    const own = await upload(s, "clientA", wf);
    expect(own.status, await own.clone().text()).toBe(201);

    const foreign = await upload(s, "clientB", wf);
    expect(foreign.status).toBe(403);
    expectCleanError({ body: await foreign.json() });

    expect((await upload(s, "technician", wf)).status).toBe(403);

    const invalid = await upload(s, "clientA", wf, {});
    expectValidation({ status: invalid.status, body: await invalid.json() });
  });

  it("DELETE : le client B et le technicien sont refusés (403), le client A supprime (204)", async () => {
    const s = sid();
    await create(s);
    const wf = (await rowOf(s)).id;
    const created = await upload(s, "clientA", wf);
    expect(created.status).toBe(201);
    const docId = (await created.json()).id as number;

    const foreign = await session.call("DELETE", `/api/workflows/documents/${docId}`, { actor: "clientB" });
    expect(foreign.status).toBe(403);
    expectCleanError(foreign);
    expect((await session.call("DELETE", `/api/workflows/documents/${docId}`, { actor: "technician" })).status).toBe(403);
    expect((await session.call("DELETE", `/api/workflows/documents/${docId}`, { actor: "clientA" })).status).toBe(204);
    const bad = await session.call("DELETE", `/api/workflows/documents/abc`, { actor: "clientA" });
    expect(bad.status).toBe(400);
  });
});
