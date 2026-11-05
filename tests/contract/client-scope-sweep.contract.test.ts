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

/**
 * Balayage de la cloison client (AGENTS.md §11, decision #255) : pour chaque route ouverte a un client
 * qui vise un objet, la reponse pour l'objet d'un autre client et pour un identifiant absent est
 * identique (statut, message, code). Complete `client-unknown-vs-foreign` (8 lectures vehicule et le
 * telechargement de document) avec les autres lectures. Une route ajoutee a la cloison s'ajoute a la table.
 *
 * `attendu` : statut commun. Famille vehicule = 403 ; famille ordre de travail = 404 (convention en vigueur) ;
 * verification de plaque = 200 `{exists:false}` dans les deux cas.
 */
type Kind = "vehicle" | "plate" | "workOrder" | "wfDocument" | "wfSession";
type Method = "GET" | "DELETE";
type Row = { label: string; kind: Kind; path: (id: string | number) => string; attendu: number; method?: Method; lecturePropre?: boolean };

const SWEEP: Row[] = [
  { label: "documents d'un vehicule", kind: "vehicle", path: (id) => `/api/vehicles/${id}/documents`, attendu: 403 },
  { label: "historique de statut", kind: "vehicle", path: (id) => `/api/vehicles/${id}/status-history`, attendu: 403 },
  { label: "historique du kilometrage", kind: "vehicle", path: (id) => `/api/vehicles/${id}/mileage/history`, attendu: 403 },
  { label: "pleins d'un vehicule", kind: "vehicle", path: (id) => `/api/fuel-records/vehicle/${id}`, attendu: 403 },
  { label: "verification de plaque", kind: "plate", path: (id) => `/api/vehicles/check/${id}`, attendu: 200 },
  { label: "document de workflow (lecture)", kind: "wfDocument", path: (id) => `/api/workflows/documents/${id}`, attendu: 403 },
  { label: "document de workflow (suppression)", kind: "wfDocument", method: "DELETE", lecturePropre: false, path: (id) => `/api/workflows/documents/${id}`, attendu: 403 },
  { label: "documents d'une session de workflow", kind: "wfSession", path: (id) => `/api/workflows/${id}/documents`, attendu: 200 },
  { label: "etat d'un brouillon d'acquisition", kind: "wfSession", path: (id) => `/api/workflows/vehicle-acquisition/${id}`, attendu: 200 },
  { label: "ordre de travail", kind: "workOrder", path: (id) => `/api/work-orders/${id}`, attendu: 404 },
  { label: "lignes de travail", kind: "workOrder", path: (id) => `/api/work-orders/${id}/items`, attendu: 404 },
  { label: "pieces de l'ordre de travail", kind: "workOrder", path: (id) => `/api/work-orders/${id}/parts`, attendu: 404 },
  { label: "rotations de pneus", kind: "workOrder", path: (id) => `/api/work-orders/${id}/tire-rotations`, attendu: 404 },
  { label: "demandes de pieces en attente", kind: "workOrder", path: (id) => `/api/work-orders/${id}/pending-part-requirements`, attendu: 404 },
];

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
let foreign: Record<Kind, string | number> = { vehicle: 0, plate: "", workOrder: 0, wfDocument: 0, wfSession: "" };
let own: Record<Kind, string | number> = { vehicle: 0, plate: "", workOrder: 0, wfDocument: 0, wfSession: "" };
const absent: Record<Kind, string | number> = { vehicle: ABSENT, plate: ABSENT_PLATE, workOrder: ABSENT, wfDocument: ABSENT, wfSession: `${token}-session-absente` };

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
    return { vehicle: v.id, plate: v.registrationNumber, workOrder: wo.id, wfDocument: doc.id, wfSession: sessionId } as Record<Kind, string | number>;
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

const shape = (res: { status: number; body: any }) => ({ status: res.status, message: res.body?.message, code: res.body?.code, exists: res.body?.exists });

describe("balayage : un client ne distingue pas l'etranger de l'inexistant", { timeout: 120000 }, () => {
  for (const row of SWEEP) {
    const method = row.method ?? "GET";
    it(`${method} ${row.label} : objet d'un autre et objet absent donnent la meme reponse (${row.attendu})`, async () => {
      const other = await session.call(method, row.path(foreign[row.kind]), { actor: "client" });
      const none = await session.call(method, row.path(absent[row.kind]), { actor: "client" });
      expect(other.status, row.path(foreign[row.kind])).toBe(row.attendu);
      expect(shape(none), row.path(absent[row.kind])).toEqual(shape(other));
    });
  }

  for (const row of SWEEP.filter((r) => r.lecturePropre !== false && (r.method ?? "GET") === "GET")) {
    it(`${row.label} : le client lit son propre objet (200)`, async () => {
      const res = await session.call("GET", row.path(own[row.kind]), { actor: "client" });
      expect(res.status, row.path(own[row.kind])).toBe(200);
    });
  }

  it("le personnel ne recoit jamais d'erreur serveur sur un identifiant absent", async () => {
    for (const row of SWEEP.filter((r) => (r.method ?? "GET") === "GET")) {
      const res = await session.call("GET", row.path(absent[row.kind]), { actor: "admin" });
      expect([200, 404], row.path(absent[row.kind])).toContain(res.status);
    }
  });
});
