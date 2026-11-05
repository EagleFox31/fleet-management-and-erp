import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { vehicleAcquisitionWorkflows, workflowDocuments, workOrders } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { SWEEP_ROUTES as SWEEP, type SweepKind, type SweepRoute } from "../support/client-scope-sweep-table";

/**
 * Balayage de la cloison client (AGENTS.md §11, decision #255) : pour chaque route ouverte a un client
 * qui vise un objet, la reponse pour l'objet d'un autre client et pour un identifiant absent est
 * identique (statut, message, code). Complete `client-unknown-vs-foreign` (8 lectures vehicule et le
 * telechargement de document) avec les autres lectures. Une route ajoutee a la cloison s'ajoute a la table.
 *
 * `attendu` : statut commun. Famille vehicule = 403 ; famille ordre de travail = 404 (convention en vigueur) ;
 * verification de plaque = 200 `{exists:false}` dans les deux cas.
 */
type Kind = SweepKind;
const pathOf = (row: SweepRoute, id: string | number) => row.template.replace(":id", String(id));

const ACTORS = { admin: "admin", client: "client", other: "client" } as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const token = uniqueTestToken("swp");
const workOrderIds: number[] = [];
const ABSENT = 2_000_000_000;
const ABSENT_PLATE = `${token}-absente`;
const uploadsDir = join(process.cwd(), "uploads", token);
const workflowIds: number[] = [];
const documentIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let foreign: Record<Kind, string | number> = { vehicle: 0, plate: "", workOrder: 0, wfDocument: 0, wfSession: "", user: 0 };
let own: Record<Kind, string | number> = { vehicle: 0, plate: "", workOrder: 0, wfDocument: 0, wfSession: "", user: 0 };
const absent: Record<Kind, string | number> = { vehicle: ABSENT, plate: ABSENT_PLATE, workOrder: ABSENT, wfDocument: ABSENT, wfSession: `${token}-session-absente`, user: ABSENT };

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
  // Objets d'un autre client (`other`) : l'etranger appartient bien a quelqu'un. Objets du client : lecture positive.
  const make = async (owner: Actor, suffix: string) => {
    const v = await createTestVehicle({ registrationNumber: `${token}-${suffix}`, ownerId: session.userIdOf(owner) });
    ids.vehicleIds.push(v.id);
    const [wo] = await db
      .insert(workOrders)
      .values({ vehicleId: v.id, title: uniqueTestToken("ot-swp"), status: "pending" as const, priority: "medium" as const })
      .returning();
    workOrderIds.push(wo.id);
    const sessionId = `${token}-s-${suffix}`;
    const [workflow] = await db.insert(vehicleAcquisitionWorkflows).values({ userId: session.userIdOf(owner), sessionId, workflowData: {} }).returning();
    workflowIds.push(workflow.id);
    mkdirSync(uploadsDir, { recursive: true });
    const filePath = join(uploadsDir, `${suffix}.pdf`);
    writeFileSync(filePath, "TEST");
    const [doc] = await db
      .insert(workflowDocuments)
      .values({ workflowId: workflow.id, sessionId, documentType: "autre", originalName: `${suffix}.pdf`, storedName: `${suffix}.pdf`, filePath, fileSize: 4, mimeType: "application/pdf", uploadedBy: session.userIdOf(owner) })
      .returning();
    documentIds.push(doc.id);
    return { vehicle: v.id, plate: v.registrationNumber, workOrder: wo.id, wfDocument: doc.id, wfSession: sessionId, user: session.userIdOf(owner) } as Record<Kind, string | number>;
  };
  foreign = await make("other", "etranger");
  own = await make("client", "propre");
}, 60000);

afterAll(async () => {
  try {
    if (documentIds.length > 0) await db.delete(workflowDocuments).where(inArray(workflowDocuments.id, documentIds));
    if (workflowIds.length > 0) await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
    rmSync(uploadsDir, { recursive: true, force: true });
    if (workOrderIds.length > 0) await db.delete(workOrders).where(inArray(workOrders.id, workOrderIds));
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

const shape = (res: { status: number; body: any }, withBody: boolean) => ({
  status: res.status,
  message: res.body?.message,
  code: res.body?.code,
  exists: res.body?.exists,
  ...(withBody ? { body: res.body } : {}),
});

describe("balayage : un client ne distingue pas l'etranger de l'inexistant", { timeout: 120000 }, () => {
  for (const row of SWEEP) {
    it(`${row.method} ${row.label} : objet d'un autre et objet absent donnent la meme reponse (${row.attendu})`, async () => {
      const other = await session.call(row.method, pathOf(row, foreign[row.kind]), { actor: "client" });
      const none = await session.call(row.method, pathOf(row, absent[row.kind]), { actor: "client" });
      expect(other.status, pathOf(row, foreign[row.kind])).toBe(row.attendu);
      expect(shape(none, !!row.comparerCorps), pathOf(row, absent[row.kind])).toEqual(shape(other, !!row.comparerCorps));
    });
  }

  for (const row of SWEEP.filter((r) => r.lecturePropre !== false && r.method === "GET")) {
    it(`${row.label} : le client lit son propre objet (200)`, async () => {
      const res = await session.call("GET", pathOf(row, own[row.kind]), { actor: "client" });
      expect(res.status, pathOf(row, own[row.kind])).toBe(200);
      if (row.comparerCorps) {
        expect(row.corpsPropre, `${row.label} : corpsPropre est obligatoire`).toBeTruthy();
        expect(JSON.stringify(res.body), `${row.label} : le corps doit porter l'objet propre`).toContain(row.corpsPropre as string);
      }
    });
  }

  it("le personnel ne recoit jamais d'erreur serveur sur un identifiant absent", async () => {
    for (const row of SWEEP.filter((r) => r.method === "GET")) {
      const res = await session.call("GET", pathOf(row, absent[row.kind]), { actor: "admin" });
      expect([200, 400, 403, 404], pathOf(row, absent[row.kind])).toContain(res.status);
    }
  });
});
