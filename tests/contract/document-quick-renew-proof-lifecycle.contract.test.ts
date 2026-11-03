import { createServer, type Server } from "http";
import { existsSync, readdirSync, rmSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { alerts, documentRenewalCenters, documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * Cycle de vie du justificatif de POST /api/document-renewals/quick-renew.
 *
 * Règle : tant que le renouvellement n'est pas enregistré, tout refus ou échec
 * supprime le fichier téléversé (sinon il reste orphelin dans uploads/). Une fois
 * le document et la demande écrits, le fichier est référencé par la demande et
 * ne doit plus être supprimé, même si une notification échoue ensuite.
 * Un refus après lecture du document ne modifie pas son échéance.
 */

const PROOF_DIR = join(process.cwd(), "uploads", "document-renewals", "proofs");

let server: Server;
let baseUrl = "";
let cookie = "";
const ids = createIdBag();
const registrations: string[] = [];
const prefixes: string[] = [];
const centerNames: string[] = [];

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const secretary = await createTestUser({ role: "secretary" });
  ids.userIds.push(secretary.id);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: secretary.username, password: TEST_USER_PASSWORD }),
  });
  expect(login.status).toBe(200);
  cookie = login.headers.get("set-cookie")!.split(";")[0];
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  for (const registration of registrations) {
    await db.delete(alerts).where(like(alerts.message, `%${registration}%`));
  }
  if (ids.vehicleIds.length > 0) {
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleId, ids.vehicleIds));
  }
  // Le centre est résolu (et créé au besoin) avant les contrôles du document : refus compris.
  if (centerNames.length > 0) {
    await db.delete(documentRenewalCenters).where(inArray(documentRenewalCenters.name, centerNames));
  }
  await cleanupCreated(ids);
  for (const prefix of prefixes) for (const file of proofFiles(prefix)) rmSync(join(PROOF_DIR, file), { force: true });
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

/** Fichiers du dossier des justificatifs issus d'un nom d'origine donné (multer garde le nom de base). */
function proofFiles(prefix: string): string[] {
  return existsSync(PROOF_DIR) ? readdirSync(PROOF_DIR).filter((name) => name.startsWith(prefix)) : [];
}

async function setup(type: "assurance" | "visite_technique" = "assurance") {
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  registrations.push(vehicle.registrationNumber);
  const [document] = await db
    .insert(vehicleDocuments)
    .values({
      vehicleId: vehicle.id,
      name: "TEST document",
      type,
      filename: "test.pdf",
      filesize: 1,
      fileType: "application/pdf",
      filePath: "uploads/test-inexistant.pdf",
      expiryDate: "2026-11-20",
    })
    .returning();
  const prefix = `TEST-proof-${randomUUID().slice(0, 8)}`;
  prefixes.push(prefix);
  return { vehicle, document, prefix };
}

async function quickRenew(fields: Record<string, string>, prefix: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), `${prefix}.pdf`);
  return fetch(`${baseUrl}/api/document-renewals/quick-renew`, { method: "POST", headers: { Cookie: cookie }, body: form });
}

function baseFields(vehicleId: number, documentId: number) {
  const centerName = `TEST-centre-${randomUUID().slice(0, 8)}`;
  centerNames.push(centerName);
  return {
    vehicleId: String(vehicleId),
    vehicleDocumentId: String(documentId),
    comment: "TEST renouvellement",
    centerName,
    newExpiryDate: "2028-03-31",
  };
}

async function expiryOf(documentId: number) {
  const [row] = await db.select({ expiryDate: vehicleDocuments.expiryDate }).from(vehicleDocuments).where(eq(vehicleDocuments.id, documentId));
  return String(row.expiryDate).slice(0, 10);
}

describe("renouvellement rapide : cycle de vie du justificatif", { timeout: 180000 }, () => {
  it("document introuvable : 404 et justificatif supprimé", async () => {
    const { vehicle, document, prefix } = await setup();
    const response = await quickRenew({ ...baseFields(vehicle.id, document.id), vehicleDocumentId: "999999999" }, prefix);
    expect(response.status).toBe(404);
    expect(proofFiles(prefix)).toEqual([]);
  });

  it("visite technique sans référence : 400 et justificatif supprimé", async () => {
    const { vehicle, document, prefix } = await setup("visite_technique");
    const response = await quickRenew(baseFields(vehicle.id, document.id), prefix);
    expect(response.status).toBe(400);
    expect(proofFiles(prefix)).toEqual([]);
  });

  it("demande introuvable : 404, justificatif supprimé, échéance du document inchangée", async () => {
    const { vehicle, document, prefix } = await setup();
    const response = await quickRenew({ ...baseFields(vehicle.id, document.id), requestId: "999999999" }, prefix);
    expect(response.status).toBe(404);
    expect(proofFiles(prefix)).toEqual([]);
    expect(await expiryOf(document.id)).toBe("2026-11-20");
  });

  it("demande d'un autre document : 400, justificatif supprimé, échéance du document inchangée", async () => {
    const { vehicle, document, prefix } = await setup();
    const other = await setup();
    const [foreign] = await db
      .insert(documentRenewalRequests)
      .values({
        vehicleId: other.vehicle.id,
        vehicleDocumentId: other.document.id,
        documentType: "assurance",
        status: "pending",
        requestedBy: ids.userIds[0],
      })
      .returning();
    const response = await quickRenew({ ...baseFields(vehicle.id, document.id), requestId: String(foreign.id) }, prefix);
    expect(response.status).toBe(400);
    expect(proofFiles(prefix)).toEqual([]);
    expect(await expiryOf(document.id)).toBe("2026-11-20");
  });

  it("échec d'une notification après enregistrement : 200, justificatif conservé et référencé", async () => {
    const { vehicle, document, prefix } = await setup();
    vi.spyOn(storage, "createAlert").mockRejectedValue(new Error("TEST panne des alertes"));
    const response = await quickRenew(baseFields(vehicle.id, document.id), prefix);
    expect(response.status).toBe(200);
    const [request] = await db
      .select({ proofFilePath: documentRenewalRequests.proofFilePath, status: documentRenewalRequests.status })
      .from(documentRenewalRequests)
      .where(eq(documentRenewalRequests.vehicleDocumentId, document.id));
    expect(request.status).toBe("completed");
    expect(request.proofFilePath).toMatch(new RegExp(`/${prefix}`));
    expect(proofFiles(prefix)).toHaveLength(1);
    expect(await expiryOf(document.id)).toBe("2028-03-31");
  });
});
