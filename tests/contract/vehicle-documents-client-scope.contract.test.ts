import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { createServer, type Server } from "http";
import { join } from "path";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { vehicleAcquisitionWorkflows, vehicleDocuments, vehicles, workflowDocuments } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD, type TestUserRole } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Niveau C, cloison entre clients sur les documents de véhicule.
 *
 * Règle du commanditaire : tout le personnel (tous rôles sauf `client`) voit les
 * documents de tous les véhicules ; un client ne voit que ceux de ses véhicules
 * (`vehicles.ownerId`) et des sessions d'acquisition qu'il a créées. Avant le
 * correctif, ces routes n'exigeaient qu'une session : un client lisait et
 * téléchargeait les documents de n'importe quel véhicule (ids séquentiels).
 */

type Actor = "admin" | "technician" | "clientA" | "clientB";
const ACTORS: Record<Actor, TestUserRole> = { admin: "admin", technician: "technician", clientA: "client", clientB: "client" };

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const cookies = new Map<Actor, string>();
const userIds = new Map<Actor, number>();
const workflowIds: number[] = [];
const uploadsSubdir = uniqueTestToken("scope");
const uploadsDir = join(process.cwd(), "uploads", uploadsSubdir);

// Véhicule, document et workflow de chaque client.
const fixture = {} as Record<
  "A" | "B",
  { vehicleId: number; documentId: number; sessionId: string; workflowId: number; workflowDocumentId: number }
>;

async function call(method: string, path: string, options: { body?: unknown; actor?: Actor } = {}) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(options.actor ? { Cookie: cookies.get(options.actor)! } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Téléchargement : le corps est le fichier.
  }
  return { status: response.status, body, headers: response.headers };
}

function expectForbidden(res: { status: number; body: any; headers: Headers }) {
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ code: "FORBIDDEN" });
  expect(res.body.message).toMatch(/n'appartient pas à votre compte/);
  expect(res.body.requestId).toBe(res.headers.get("x-request-id"));
}

/** Refus par le rôle : un client ne fait aucune saisie d'exploitation, même sur son véhicule. */
function expectStaffOnly(res: { status: number; body: any }) {
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ code: "FORBIDDEN" });
}

async function seedClient(key: "A" | "B", ownerId: number) {
  const vehicle = await createTestVehicle({ ownerId });
  ids.vehicleIds.push(vehicle.id);
  // Carte grise expirée : le véhicule figure dans les listes d'expiration.
  await db.update(vehicles).set({ licensePlateExpiry: "2020-01-01" }).where(eq(vehicles.id, vehicle.id));

  const filePath = join(uploadsDir, `${key}.pdf`);
  writeFileSync(filePath, `TEST-${key}`);
  const [document] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId: vehicle.id, name: `TEST doc ${key}`, type: "autre", filename: `${key}.pdf`, filesize: 6, fileType: "application/pdf", filePath })
    .returning();

  const sessionId = uniqueTestToken(`wf${key}`);
  const [workflow] = await db.insert(vehicleAcquisitionWorkflows).values({ userId: ownerId, sessionId, workflowData: {} }).returning();
  workflowIds.push(workflow.id);
  const [workflowDocument] = await db
    .insert(workflowDocuments)
    .values({
      workflowId: workflow.id,
      sessionId,
      documentType: "autre",
      originalName: `${key}.pdf`,
      storedName: `${key}.pdf`,
      filePath,
      fileSize: 6,
      mimeType: "application/pdf",
      uploadedBy: ownerId,
    })
    .returning();

  fixture[key] = { vehicleId: vehicle.id, documentId: document.id, sessionId, workflowId: workflow.id, workflowDocumentId: workflowDocument.id };
}

/** Document de workflow à usage unique, avec son propre fichier : une suppression n'affecte pas les autres tests. */
async function seedWorkflowDocument(key: "A" | "B", name: string, originalName = name) {
  const filePath = join(uploadsDir, name);
  writeFileSync(filePath, `TEST-${name}`);
  const [document] = await db
    .insert(workflowDocuments)
    .values({
      workflowId: fixture[key].workflowId,
      sessionId: fixture[key].sessionId,
      documentType: "autre",
      originalName,
      storedName: name,
      filePath,
      fileSize: 6,
      mimeType: "application/pdf",
      uploadedBy: userIds.get(`client${key}`)!,
    })
    .returning();
  return { id: document.id, filePath };
}

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  for (const [actor, role] of Object.entries(ACTORS) as [Actor, TestUserRole][]) {
    const user = await createTestUser({ role });
    ids.userIds.push(user.id);
    userIds.set(actor, user.id);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: user.username, password: TEST_USER_PASSWORD }),
    });
    expect(res.status).toBe(200);
    cookies.set(actor, res.headers.get("set-cookie")!.split(";")[0]);
  }

  mkdirSync(uploadsDir, { recursive: true });
  await seedClient("A", userIds.get("clientA")!);
  await seedClient("B", userIds.get("clientB")!);
}, 60000);

afterAll(async () => {
  // Disque d'abord : il ne dépend pas de la base.
  if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
  // Documents de workflow : supprimés en cascade avec le workflow, avant les utilisateurs.
  if (workflowIds.length > 0) {
    await db.delete(vehicleAcquisitionWorkflows).where(inArray(vehicleAcquisitionWorkflows.id, workflowIds));
  }
  await cleanupCreated(ids);
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

describe("documents d'un véhicule : cloison entre clients", { timeout: 60000 }, () => {
  it("un client est refusé sur le véhicule d'un autre client (liste, par type, téléchargement)", async () => {
    expectForbidden(await call("GET", `/api/vehicles/${fixture.B.vehicleId}/documents`, { actor: "clientA" }));
    expectForbidden(await call("GET", `/api/vehicles/${fixture.B.vehicleId}/documents/autre`, { actor: "clientA" }));
    expectForbidden(await call("GET", `/api/documents/${fixture.B.documentId}/download`, { actor: "clientA" }));
  });

  it("un client lit et télécharge les documents de son véhicule", async () => {
    const list = await call("GET", `/api/vehicles/${fixture.A.vehicleId}/documents`, { actor: "clientA" });
    expect(list.status).toBe(200);
    expect(list.body.map((d: any) => d.id)).toContain(fixture.A.documentId);

    const byType = await call("GET", `/api/vehicles/${fixture.A.vehicleId}/documents/autre`, { actor: "clientA" });
    expect(byType.status).toBe(200);
    expect(byType.body.map((d: any) => d.id)).toContain(fixture.A.documentId);

    const download = await call("GET", `/api/documents/${fixture.A.documentId}/download`, { actor: "clientA" });
    expect(download.status).toBe(200);
    expect(download.body).toBe("TEST-A");
  });

  it("le personnel lit les documents de tout véhicule", async () => {
    for (const actor of ["admin", "technician"] as const) {
      const list = await call("GET", `/api/vehicles/${fixture.B.vehicleId}/documents`, { actor });
      expect(list.status).toBe(200);
      expect(list.body.map((d: any) => d.id)).toContain(fixture.B.documentId);
      const download = await call("GET", `/api/documents/${fixture.B.documentId}/download`, { actor });
      expect(download.status).toBe(200);
      expect(download.body).toBe("TEST-B");
    }
  });
});

describe("listes de documents : filtrées sur le propriétaire pour un client", { timeout: 60000 }, () => {
  it("GET /api/vehicles/documents/all : le client ne voit que ses documents, le personnel voit tout", async () => {
    const own = await call("GET", "/api/vehicles/documents/all", { actor: "clientA" });
    expect(own.status).toBe(200);
    expect(own.body.map((d: any) => d.id)).toContain(fixture.A.documentId);
    expect(own.body.every((d: any) => d.vehicleId === fixture.A.vehicleId)).toBe(true);

    const all = await call("GET", "/api/vehicles/documents/all", { actor: "technician" });
    expect(all.body.map((d: any) => d.id)).toEqual(expect.arrayContaining([fixture.A.documentId, fixture.B.documentId]));
  });

  it("documents expirés, statut et statistiques : limités aux véhicules du client", async () => {
    const expired = await call("GET", "/api/vehicles/expired-docs", { actor: "clientA" });
    expect(expired.status).toBe(200);
    expect(expired.body.map((v: any) => v.id)).toEqual([fixture.A.vehicleId]);

    const withStatus = await call("GET", "/api/vehicles/all-with-status", { actor: "clientA" });
    expect(withStatus.body.map((v: any) => v.id)).toEqual([fixture.A.vehicleId]);

    const expiring = await call("GET", "/api/vehicles/expiring-docs", { actor: "clientA" });
    expect(expiring.body.nonRenseignes.map((v: any) => v.id)).toEqual([fixture.A.vehicleId]);

    const stats = await call("GET", "/api/vehicles/document-stats", { actor: "clientA" });
    expect(stats.body).toMatchObject({ total: 1, expiredCarteGrise: 1 });

    const staff = await call("GET", "/api/vehicles/expired-docs", { actor: "admin" });
    expect(staff.body.map((v: any) => v.id)).toEqual(expect.arrayContaining([fixture.A.vehicleId, fixture.B.vehicleId]));
  });
});

describe("écritures sur un véhicule : cloison entre clients", { timeout: 60000 }, () => {
  it("un client ne modifie ni le kilométrage ni la position du véhicule d'un autre client", async () => {
    const [before] = await db.select().from(vehicles).where(eq(vehicles.id, fixture.B.vehicleId));
    expectStaffOnly(await call("PUT", `/api/vehicles/${fixture.B.vehicleId}/mileage`, { actor: "clientA", body: { kilometers: 999999 } }));
    expectStaffOnly(await call("PUT", `/api/vehicles/${fixture.B.vehicleId}/maintenance-position`, { actor: "clientA", body: { position: "TEST" } }));
    const [after] = await db.select().from(vehicles).where(eq(vehicles.id, fixture.B.vehicleId));
    expect(after.mileage).toBe(before.mileage);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("un client ne saisit pas le kilométrage ni la position de son propre véhicule", async () => {
    const [before] = await db.select().from(vehicles).where(eq(vehicles.id, fixture.A.vehicleId));
    expectStaffOnly(await call("PUT", `/api/vehicles/${fixture.A.vehicleId}/mileage`, { actor: "clientA", body: { kilometers: 999999 } }));
    expectStaffOnly(await call("PUT", `/api/vehicles/${fixture.A.vehicleId}/maintenance-position`, { actor: "clientA", body: { position: "TEST" } }));
    const [after] = await db.select().from(vehicles).where(eq(vehicles.id, fixture.A.vehicleId));
    expect(after.mileage).toBe(before.mileage);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });

  it("non-régression : le personnel met à jour le kilométrage de tout véhicule", async () => {
    const res = await call("PUT", `/api/vehicles/${fixture.B.vehicleId}/mileage`, { actor: "admin", body: { kilometers: 100500 } });
    expect(res.status).toBe(200);
  });

  it("un kilométrage en baisse est refusé en 400 lisible", async () => {
    const res = await call("PUT", `/api/vehicles/${fixture.B.vehicleId}/mileage`, { actor: "admin", body: { kilometers: 100 } });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("inférieur au kilométrage actuel");
  });

  it("un véhicule qui n'existe pas donne 404, pas 500", async () => {
    const missing = 2_000_000_000;
    const mileage = await call("PUT", `/api/vehicles/${missing}/mileage`, { actor: "admin", body: { kilometers: 10 } });
    expect(mileage.status).toBe(404);
    expect(mileage.body.message).toBe("Véhicule introuvable.");
    const position = await call("PUT", `/api/vehicles/${missing}/maintenance-position`, { actor: "admin", body: { position: "TEST" } });
    expect(position.status).toBe(404);
  });
});

describe("documents de workflow : cloison entre clients", { timeout: 60000 }, () => {
  it("un client ne voit pas les documents de la session d'un autre client", async () => {
    const res = await call("GET", `/api/workflows/${fixture.B.sessionId}/documents`, { actor: "clientA" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("réutiliser le sessionId d'un autre client n'ouvre pas ses documents", async () => {
    const [own] = await db
      .insert(vehicleAcquisitionWorkflows)
      .values({ userId: userIds.get("clientA")!, sessionId: fixture.B.sessionId, workflowData: {} })
      .returning();
    workflowIds.push(own.id);
    const res = await call("GET", `/api/workflows/${fixture.B.sessionId}/documents`, { actor: "clientA" });
    expect(res.body.map((d: any) => d.id)).not.toContain(fixture.B.workflowDocumentId);
  });

  it("un client est refusé au téléchargement du document de workflow d'un autre client", async () => {
    expectForbidden(await call("GET", `/api/workflows/documents/${fixture.B.workflowDocumentId}`, { actor: "clientA" }));
  });

  it("l'auteur de la session et le personnel lisent ses documents", async () => {
    for (const actor of ["clientB", "admin"] as const) {
      const list = await call("GET", `/api/workflows/${fixture.B.sessionId}/documents`, { actor });
      expect(list.body.map((d: any) => d.id)).toContain(fixture.B.workflowDocumentId);
      const download = await call("GET", `/api/workflows/documents/${fixture.B.workflowDocumentId}`, { actor });
      expect(download.status).toBe(200);
      expect(download.body).toBe("TEST-B");
    }
  });
});

describe("suppression d'un document de workflow : cloison entre clients", { timeout: 60000 }, () => {
  it("un client ne supprime pas le document de la session d'un autre client", async () => {
    const document = await seedWorkflowDocument("B", "del-B.pdf");
    expectForbidden(await call("DELETE", `/api/workflows/documents/${document.id}`, { actor: "clientA" }));
    const [still] = await db.select().from(workflowDocuments).where(eq(workflowDocuments.id, document.id));
    expect(still).toBeDefined();
    expect(existsSync(document.filePath)).toBe(true);
  });

  it("l'auteur de la session et le personnel suppriment ; un document absent donne 404 au personnel, 403 au client (comme un document étranger)", async () => {
    for (const actor of ["clientB", "admin"] as const) {
      const document = await seedWorkflowDocument("B", `del-${actor}.pdf`);
      const res = await call("DELETE", `/api/workflows/documents/${document.id}`, { actor });
      expect(res.status).toBe(204);
      expect(existsSync(document.filePath)).toBe(false);
      const again = await call("DELETE", `/api/workflows/documents/${document.id}`, { actor });
      expect(again.status).toBe(actor === "admin" ? 404 : 403);
    }
  });
});

describe("téléchargement d'un document de workflow : nom d'origine dans l'en-tête", { timeout: 60000 }, () => {
  /** Nom de fichier lu dans Content-Disposition : `filename*` (UTF-8) prime sur `filename`. */
  function filenameOf(header: string | null): string | undefined {
    const extended = header?.match(/filename\*=UTF-8''([^;]+)/i);
    if (extended) return decodeURIComponent(extended[1]);
    return header?.match(/filename="([^"]*)"/)?.[1];
  }

  it("un nom hors Latin-1 est servi en 200 et restitué intact (avant : 500)", async () => {
    const original = "Carte grise 车辆 Ω.pdf";
    const document = await seedWorkflowDocument("B", "cd-unicode.pdf", original);
    const download = await call("GET", `/api/workflows/documents/${document.id}`, { actor: "clientB" });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(filenameOf(download.headers.get("content-disposition"))).toBe(original);
  });

  it("un guillemet ou un retour à la ligne dans le nom ne sort pas du paramètre filename", async () => {
    for (const [stored, original] of [
      ["cd-quote.pdf", 'devis".pdf; filename="autre.exe'],
      ["cd-crlf.pdf", "a\r\nX-Injecte: 1.pdf"],
    ]) {
      const document = await seedWorkflowDocument("B", stored, original);
      const download = await call("GET", `/api/workflows/documents/${document.id}`, { actor: "clientB" });
      expect(download.status).toBe(200);
      const header = download.headers.get("content-disposition")!;
      expect(header.match(/filename="/g)).toHaveLength(1);
      expect(download.headers.get("x-injecte")).toBeNull();
      expect(filenameOf(header)).toBe(original);
    }
  });

  it("non-régression : un nom ASCII simple reste un filename entre guillemets", async () => {
    const document = await seedWorkflowDocument("B", "cd-ascii.pdf", "facture-2026.pdf");
    const download = await call("GET", `/api/workflows/documents/${document.id}`, { actor: "clientB" });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="facture-2026.pdf"');
  });
});
