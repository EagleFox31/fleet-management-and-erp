import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicleAcquisitionWorkflows, workflowDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { uniqueTestToken } from "../support/ids";

/**
 * Cloison client (AGENTS.md §11, decision #255) sur les documents du workflow d'acquisition : un client
 * ne distingue pas le document d'une session d'un autre client d'un identifiant absent. Meme statut,
 * meme message, meme code. Le personnel garde le 404 pour l'absent.
 */
const ACTORS = { admin: "admin", client: "client", other: "client" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const token = uniqueTestToken("wfu");
const uploadsDir = join(process.cwd(), "uploads", token);
const workflowIds: number[] = [];
const documentIds: number[] = [];
const ABSENT = 2_000_000_000;
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let foreignDocument = 0;

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  const sessionId = uniqueTestToken("wfs");
  const [workflow] = await db.insert(vehicleAcquisitionWorkflows).values({ userId: session.userIdOf("other"), sessionId, workflowData: {} }).returning();
  workflowIds.push(workflow.id);
  mkdirSync(uploadsDir, { recursive: true });
  const filePath = join(uploadsDir, "d.pdf");
  writeFileSync(filePath, "TEST");
  const [doc] = await db
    .insert(workflowDocuments)
    .values({ workflowId: workflow.id, sessionId, documentType: "autre", originalName: "d.pdf", storedName: "d.pdf", filePath, fileSize: 4, mimeType: "application/pdf", uploadedBy: session.userIdOf("other") })
    .returning();
  documentIds.push(doc.id);
  foreignDocument = doc.id;
}, 60000);

afterAll(async () => {
  try {
    if (documentIds.length > 0) await db.delete(workflowDocuments).where(inArray(workflowDocuments.id, documentIds));
    if (workflowIds.length > 0) await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
    rmSync(uploadsDir, { recursive: true, force: true });
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

const shape = (res: { status: number; body: any }) => ({ status: res.status, message: res.body?.message, code: res.body?.code });

describe("documents de workflow : un client ne distingue pas l'etranger de l'inexistant", { timeout: 60000 }, () => {
  for (const method of ["GET", "DELETE"] as const) {
    it(`${method} /api/workflows/documents/:id : document d'un autre et document absent donnent la meme reponse 403`, async () => {
      const absent = await session.call(method, `/api/workflows/documents/${ABSENT}`, { actor: "client" });
      const foreign = await session.call(method, `/api/workflows/documents/${foreignDocument}`, { actor: "client" });
      expect(foreign.status).toBe(403);
      expect(shape(absent)).toEqual(shape(foreign));
    });
  }

  it("le personnel garde le 404 pour un document absent", async () => {
    expect((await session.call("GET", `/api/workflows/documents/${ABSENT}`, { actor: "admin" })).status).toBe(404);
    expect((await session.call("DELETE", `/api/workflows/documents/${ABSENT}`, { actor: "admin" })).status).toBe(404);
  });
});
