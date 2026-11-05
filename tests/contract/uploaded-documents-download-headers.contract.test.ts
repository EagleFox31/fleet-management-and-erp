import { mkdirSync, rmSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { join } from "path";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicleAcquisitionWorkflows, vehicleDocuments, workflowDocuments } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Fichiers téléversés servis par l'API (documents véhicule, documents d'acquisition) :
 * toujours en pièce jointe, avec `nosniff`, et un type pris dans la liste blanche du
 * téléversement. Un type déclaré hors liste, ou incohérent avec l'extension du fichier,
 * part en `application/octet-stream` : le navigateur ne rend rien sur l'origine de l'application.
 */

let server: Server;
let baseUrl = "";
let adminCookie = "";
let clientCookie = "";
let adminId = 0;
const ids = createIdBag();
const workflowIds: number[] = [];
const uploadsSubdir = uniqueTestToken("dlhdr");
const uploadsDir = join(process.cwd(), "uploads", uploadsSubdir);

function stored(name: string, content = "TEST"): string {
  mkdirSync(uploadsDir, { recursive: true });
  writeFileSync(join(uploadsDir, name), content);
  return join("uploads", uploadsSubdir, name);
}

async function get(path: string, cookie = adminCookie): Promise<Response> {
  return fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie } });
}

async function login(username: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: TEST_USER_PASSWORD }),
  });
  expect(res.status).toBe(200);
  return res.headers.get("set-cookie")!.split(";")[0];
}

/** Chemin stocké tel quel (sans fichier créé) : hors de uploads/, ou absent du disque. */
type StoredPathOverride = string | undefined;

async function vehicleDocument(fileName: string, fileType: string, filename = fileName, filePath?: StoredPathOverride): Promise<number> {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  const [row] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId: vehicle.id, name: "TEST doc", type: "autre", filename, filesize: 4, fileType, filePath: filePath ?? stored(fileName) })
    .returning();
  return row.id;
}

async function workflowDocument(fileName: string, mimeType: string, originalName = fileName, filePath?: StoredPathOverride): Promise<number> {
  const [workflow] = await db
    .insert(vehicleAcquisitionWorkflows)
    .values({ userId: adminId, sessionId: uniqueTestToken("TEST-dl"), workflowData: {} })
    .returning();
  workflowIds.push(workflow.id);
  const [row] = await db
    .insert(workflowDocuments)
    .values({
      workflowId: workflow.id,
      sessionId: workflow.sessionId,
      documentType: "autre",
      originalName,
      storedName: fileName,
      filePath: filePath ?? stored(fileName),
      fileSize: 4,
      mimeType,
    })
    .returning();
  return row.id;
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  const admin = await createTestUser({ role: "admin" });
  ids.userIds.push(admin.id);
  adminId = admin.id;
  adminCookie = await login(admin.username);
  const client = await createTestUser({ role: "client" });
  ids.userIds.push(client.id);
  clientCookie = await login(client.username);
}, 120000);

afterAll(async () => {
  rmSync(uploadsDir, { recursive: true, force: true });
  if (workflowIds.length > 0) {
    await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}, 120000);

const ROUTES = [
  { label: "GET /api/documents/:id/download", create: vehicleDocument, url: (id: number) => `/api/documents/${id}/download` },
  { label: "GET /api/workflows/documents/:documentId", create: workflowDocument, url: (id: number) => `/api/workflows/documents/${id}` },
] as const;

describe.each(ROUTES)("$label : en-têtes du fichier servi", { timeout: 60000 }, ({ create, url }) => {
  it("PDF déclaré : servi en pièce jointe, nosniff, type conservé", async () => {
    const id = await create(`${uniqueTestToken("f")}.pdf`, "application/pdf", "carte grise.pdf");
    const res = await get(url(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toMatch(/^application\/pdf\b/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-disposition")).toContain("carte grise.pdf");
    expect(await res.text()).toBe("TEST");
  });

  it("type déclaré hors liste (HTML) : octet-stream, jamais rendu", async () => {
    const id = await create(`${uniqueTestToken("f")}.html`, "text/html");
    const res = await get(url(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/octet-stream\b/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("type en liste mais extension incohérente (PDF déclaré, fichier .svg) : octet-stream", async () => {
    const id = await create(`${uniqueTestToken("f")}.svg`, "application/pdf");
    const res = await get(url(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/octet-stream\b/);
  });

  it("image/jpg déclaré : servi en image/jpeg", async () => {
    const id = await create(`${uniqueTestToken("f")}.jpg`, "image/jpg");
    const res = await get(url(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^image\/jpeg\b/);
  });
});

/** Id au-delà de toute séquence de test, mais dans l'int4 : la ligne n'existe pas. */
const UNKNOWN_ID = 2147483000;

describe.each(ROUTES)("$label : erreurs", { timeout: 60000 }, ({ create, url }) => {
  it("id inconnu : 404 pour le personnel, 403 pour un client (pas d'indice d'existence)", async () => {
    const staff = await get(url(UNKNOWN_ID));
    expect(staff.status).toBe(404);
    const client = await get(url(UNKNOWN_ID), clientCookie);
    expect(client.status).toBe(403);
  });

  it("chemin stocké hors de uploads/ : 404, sans chemin dans la réponse", async () => {
    const outside = join(process.cwd(), "package.json");
    const id = await create("package.json", "application/pdf", "package.json", outside);
    const res = await get(url(id));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).not.toContain("package.json");
    expect(text).not.toContain(process.cwd());
    expect(text).not.toMatch(/[\\/]uploads?[\\/]/);
  });

  it("fichier absent du disque : 404 au contrat d'erreur", async () => {
    const missing = join("uploads", uploadsSubdir, `${uniqueTestToken("absent")}.pdf`);
    const id = await create("absent.pdf", "application/pdf", "absent.pdf", missing);
    const res = await get(url(id));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(typeof body.message).toBe("string");
    expect(body.requestId).toBe(res.headers.get("x-request-id"));
    expect(JSON.stringify(body)).not.toContain(uploadsSubdir);
  });
});
