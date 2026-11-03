import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { fuelRecords, vehicleAcquisitionWorkflows, vehicleDocuments, workflowDocuments } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestFuelRecord, createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, deux gardes serveur :
 * - T1 carburant : POST/PATCH /api/fuel-records n'exigeaient qu'une session.
 *   Saisie réservée aux profils carburant (ni technicien, ni chauffeur) ; modification à
 *   l'auteur du plein ou à l'admin (même règle que `canEditFuelRecord`).
 * - Chemins disque : le téléversement d'un document de workflow construisait
 *   le chemin avec `sessionId` et `documentType` bruts (écriture hors de
 *   uploads/) ; les deux téléchargements servaient un chemin stocké quelconque.
 */

const ROLES: TestUserRole[] = ["admin", "technician", "logistics", "warehouse", "client", "workshop_manager"];

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<TestUserRole, string>();
const sessionUserIds = new Map<TestUserRole, number>();
const workflowIds: number[] = [];
const workflowsRoot = join(process.cwd(), "uploads", "workflows");
const uploadsSubdir = uniqueTestToken("paths");
const uploadsDir = join(process.cwd(), "uploads", uploadsSubdir);
const escapeMarker = uniqueTestToken("escape");

async function call(method: string, path: string, options: { body?: unknown; cookie?: string } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

function expectErrorContract(res: { body: any; headers: Headers }, code: string) {
  expect(res.body).toMatchObject({ code });
  expect(typeof res.body.message).toBe("string");
  expect(res.body.message.length).toBeGreaterThan(0);
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
}

async function newVehicleId() {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  return v.id;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const role of ROLES) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    sessionUserIds.set(role, user.id);
    const res = await call("POST", "/api/auth/login", { body: { username: user.username, password: TEST_USER_PASSWORD } });
    expect(res.status).toBe(200);
    cookies.set(role, res.headers.get("set-cookie")!.split(";")[0]);
  }
}, 120000);

afterAll(async () => {
  // Disque d'abord : un ménage base qui échoue ne doit pas laisser de fichier.
  rmSync(uploadsDir, { recursive: true, force: true });
  // Sans le correctif, le téléversement écrivait à la racine du projet ou de uploads/.
  rmSync(join(process.cwd(), escapeMarker), { recursive: true, force: true });
  for (const entry of readdirSync(join(process.cwd(), "uploads"))) {
    if (entry.startsWith(escapeMarker)) rmSync(join(process.cwd(), "uploads", entry), { force: true });
  }
  if (existsSync(workflowsRoot)) {
    for (const entry of readdirSync(workflowsRoot)) {
      if (entry.startsWith("TEST-")) rmSync(join(workflowsRoot, entry), { recursive: true, force: true });
    }
  }
  // Documents de workflow : supprimés en cascade avec le workflow, avant les utilisateurs.
  if (workflowIds.length > 0) {
    await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("T1 carburant : saisie d'un plein", { timeout: 60000 }, () => {
  const body = (vehicleId: number) => ({ vehicleId, date: "2026-10-01", quantity: 40, cost: 30000, mileage: 1000, notes: uniqueTestToken("fuel") });

  for (const role of ["client", "warehouse", "technician"] as const) {
    it(`${role} : POST -> 403 au contrat, aucun plein créé`, async () => {
      const vehicleId = await newVehicleId();
      const res = await call("POST", "/api/fuel-records", { cookie: cookies.get(role), body: body(vehicleId) });
      // Sans la garde, le plein est créé : il doit partir avant son auteur.
      if (res.status === 201) ids.fuelRecordIds.push(res.body.id);
      expect(res.status).toBe(403);
      expectErrorContract(res, "FORBIDDEN");
      expect(await db.select().from(fuelRecords).where(eq(fuelRecords.vehicleId, vehicleId))).toHaveLength(0);
    });
  }

  it("non-régression : le logisticien saisit un plein, attribué à lui", async () => {
    const vehicleId = await newVehicleId();
    const res = await call("POST", "/api/fuel-records", { cookie: cookies.get("logistics"), body: body(vehicleId) });
    expect(res.status).toBe(201);
    ids.fuelRecordIds.push(res.body.id);
    expect(res.body.createdBy).toBe(sessionUserIds.get("logistics"));
  });
});

describe("T1 carburant : modification d'un plein", { timeout: 60000 }, () => {
  it("un autre profil que l'auteur -> 403, plein inchangé", async () => {
    const record = await createTestFuelRecord({ vehicleId: await newVehicleId(), createdBy: sessionUserIds.get("admin") });
    ids.fuelRecordIds.push(record.id);
    const res = await call("PATCH", `/api/fuel-records/${record.id}`, { cookie: cookies.get("logistics"), body: { quantity: 1 } });
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
    const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id));
    expect(row.quantity).toBe(record.quantity);
  });

  it("client -> 403 avant toute lecture du plein", async () => {
    const record = await createTestFuelRecord({ vehicleId: await newVehicleId(), createdBy: sessionUserIds.get("client") });
    ids.fuelRecordIds.push(record.id);
    const res = await call("PATCH", `/api/fuel-records/${record.id}`, { cookie: cookies.get("client"), body: { quantity: 1 } });
    expect(res.status).toBe(403);
  });

  it("non-régression : l'auteur modifie son plein", async () => {
    const record = await createTestFuelRecord({ vehicleId: await newVehicleId(), createdBy: sessionUserIds.get("logistics") });
    ids.fuelRecordIds.push(record.id);
    const res = await call("PATCH", `/api/fuel-records/${record.id}`, { cookie: cookies.get("logistics"), body: { quantity: 42 } });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id));
    expect(row.quantity).toBe(42);
  });

  it("non-régression : l'admin modifie le plein d'un autre", async () => {
    const record = await createTestFuelRecord({ vehicleId: await newVehicleId(), createdBy: sessionUserIds.get("logistics") });
    ids.fuelRecordIds.push(record.id);
    const res = await call("PATCH", `/api/fuel-records/${record.id}`, { cookie: cookies.get("admin"), body: { quantity: 43 } });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/fuel-records/:id (server/api, sous verrou carte)", { timeout: 60000 }, () => {
  it("chef d'atelier : 204, plein supprimé", async () => {
    const record = await createTestFuelRecord({ vehicleId: await newVehicleId(), createdBy: sessionUserIds.get("admin") });
    ids.fuelRecordIds.push(record.id);
    const res = await call("DELETE", "/api/fuel-records/" + record.id, { cookie: cookies.get("workshop_manager") });
    expect(res.status).toBe(204);
    expect(await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id))).toHaveLength(0);
  });

  it("logisticien -> 403 au contrat, plein conservé", async () => {
    const record = await createTestFuelRecord({ vehicleId: await newVehicleId(), createdBy: sessionUserIds.get("logistics") });
    ids.fuelRecordIds.push(record.id);
    const res = await call("DELETE", "/api/fuel-records/" + record.id, { cookie: cookies.get("logistics") });
    expect(res.status).toBe(403);
    expectErrorContract(res, "FORBIDDEN");
    expect(await db.select().from(fuelRecords).where(eq(fuelRecords.id, record.id))).toHaveLength(1);
  });

  it("id inconnu -> 404 au contrat", async () => {
    const res = await call("DELETE", "/api/fuel-records/2147483000", { cookie: cookies.get("admin") });
    expect(res.status).toBe(404);
    expectErrorContract(res, "NOT_FOUND");
  });

  it("id illisible -> 400 au contrat", async () => {
    const res = await call("DELETE", "/api/fuel-records/abc", { cookie: cookies.get("admin") });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
  });
});

describe("document de workflow : chemin disque", { timeout: 60000 }, () => {
  async function newWorkflow(sessionId = uniqueTestToken("wf")) {
    const [row] = await db
      .insert(vehicleAcquisitionWorkflows)
      .values({ userId: sessionUserIds.get("admin")!, sessionId, workflowData: {} })
      .returning();
    workflowIds.push(row.id);
    return row;
  }

  async function upload(sessionSegment: string, fields: { documentType: string; workflowId: number }, fileName = "carte.pdf") {
    const form = new FormData();
    form.append("documentType", fields.documentType);
    form.append("workflowId", String(fields.workflowId));
    form.append("document", new Blob(["TEST"], { type: "application/pdf" }), fileName);
    const response = await fetch(`${baseUrl}/api/workflows/${sessionSegment}/documents`, {
      method: "POST",
      headers: { Cookie: cookies.get("admin")! },
      body: form,
    });
    return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
  }

  it("sessionId remontant hors de uploads/workflows -> 400, aucun fichier écrit", async () => {
    const workflow = await newWorkflow();
    // Express décode %2F : le paramètre reçu vaut "../../<marqueur>".
    const res = await upload(`..%2F..%2F${escapeMarker}`, { documentType: "carte_grise", workflowId: workflow.id });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    expect(existsSync(join(process.cwd(), escapeMarker))).toBe(false);
    expect(await db.select().from(workflowDocuments).where(eq(workflowDocuments.workflowId, workflow.id))).toHaveLength(0);
  });

  it("documentType hors liste (préfixe du nom de fichier) -> 400", async () => {
    const workflow = await newWorkflow();
    const res = await upload(workflow.sessionId, { documentType: `../../${escapeMarker}`, workflowId: workflow.id });
    expect(res.status).toBe(400);
    expectErrorContract(res, "VALIDATION");
    expect(await db.select().from(workflowDocuments).where(eq(workflowDocuments.workflowId, workflow.id))).toHaveLength(0);
  });

  it("non-régression : téléversement normal rangé sous uploads/workflows/<session>, puis téléchargé", async () => {
    const workflow = await newWorkflow();
    const res = await upload(workflow.sessionId, { documentType: "carte_grise", workflowId: workflow.id }, "carte d'origine.pdf");
    expect(res.status).toBe(201);
    expect(res.body.filePath).toMatch(new RegExp(`^/uploads/workflows/${workflow.sessionId}/carte_grise_\\d+_\\w*\\.pdf$`));
    expect(readdirSync(join(workflowsRoot, workflow.sessionId))).toHaveLength(1);

    const download = await fetch(`${baseUrl}/api/workflows/documents/${res.body.id}`, { headers: { Cookie: cookies.get("admin")! } });
    expect(download.status).toBe(200);
    expect(await download.text()).toBe("TEST");
  });

  it("chemin stocké hors de uploads/ : le téléchargement répond 404 au lieu de servir le fichier", async () => {
    const workflow = await newWorkflow();
    const [doc] = await db
      .insert(workflowDocuments)
      .values({
        workflowId: workflow.id,
        sessionId: workflow.sessionId,
        documentType: "autre",
        originalName: "package.json",
        storedName: "package.json",
        filePath: "/package.json",
        fileSize: 1,
        mimeType: "application/json",
      })
      .returning();
    const res = await call("GET", `/api/workflows/documents/${doc.id}`, { cookie: cookies.get("admin") });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/documents/:id/download : chemin stocké", { timeout: 60000 }, () => {
  async function newDocument(filePath: string) {
    const [row] = await db
      .insert(vehicleDocuments)
      .values({
        vehicleId: await newVehicleId(),
        name: "TEST doc",
        type: "autre",
        filename: "doc.pdf",
        filesize: 4,
        fileType: "application/pdf",
        filePath,
      })
      .returning();
    return row;
  }

  it("fichier hors de uploads/ (package.json) -> 404", async () => {
    const doc = await newDocument(join(process.cwd(), "package.json"));
    const res = await call("GET", `/api/documents/${doc.id}/download`, { cookie: cookies.get("admin") });
    expect(res.status).toBe(404);
  });

  it("chemin remontant depuis uploads/ -> 404", async () => {
    const doc = await newDocument("uploads/../package.json");
    const res = await call("GET", `/api/documents/${doc.id}/download`, { cookie: cookies.get("admin") });
    expect(res.status).toBe(404);
  });

  it("non-régression : les deux formes stockées sous uploads/ sont servies", async () => {
    mkdirSync(uploadsDir, { recursive: true });
    const name = `${uniqueTestToken("file")}.pdf`;
    writeFileSync(join(uploadsDir, name), "TEST");
    for (const stored of [join("uploads", uploadsSubdir, name), `/uploads/${uploadsSubdir}/${name}`]) {
      const doc = await newDocument(stored);
      const res = await fetch(`${baseUrl}/api/documents/${doc.id}/download`, { headers: { Cookie: cookies.get("admin")! } });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("TEST");
    }
  });
});
