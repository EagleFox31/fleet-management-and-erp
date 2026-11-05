import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { createTestVehicle } from "../support/factories";
import { leakText } from "../support/api-error";
import { startContractSession } from "../support/contract-session";

/**
 * GET /api/document-renewals/requests/:id/proof : le justificatif déposé au renouvellement rapide
 * était écrit sur disque mais jamais consultable. Lecture réservée aux rôles qui lisent les demandes,
 * fichier servi depuis le seul dossier des justificatifs, 404 si la demande n'en a pas ou s'il a disparu.
 */
const PROOF_DIR = path.join(process.cwd(), "uploads", "document-renewals", "proofs");
const OTHER_DIR = path.join(process.cwd(), "uploads", "documents");
const PDF = Buffer.from("%PDF-1.4 TEST justificatif");

let session: Awaited<ReturnType<typeof startContractSession<"secretary" | "technician" | "driver" | "client">>>;
const requestIds: number[] = [];
const files: string[] = [];
let withProof = 0;
let withoutProof = 0;
let missingFile = 0;
let outsideProofDir = 0;
let ownedByClient = 0;
let unlistedExtension = 0;

async function createRequest(vehicleId: number, proofFilePath: string | null) {
  const [document] = await db
    .insert(vehicleDocuments)
    .values({
      vehicleId,
      name: "TEST document",
      type: "assurance",
      filename: "test.pdf",
      filesize: 1,
      fileType: "application/pdf",
      filePath: "uploads/test-inexistant.pdf",
      expiryDate: "2026-11-20",
    })
    .returning();
  const [row] = await db
    .insert(documentRenewalRequests)
    .values({
      vehicleId,
      vehicleDocumentId: document.id,
      documentType: "assurance",
      status: "completed",
      proofFileName: proofFilePath ? "justificatif.pdf" : null,
      proofFilePath,
    })
    .returning({ id: documentRenewalRequests.id });
  requestIds.push(row.id);
  return row.id;
}

function writeFile(dir: string, name: string) {
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  fs.writeFileSync(full, PDF);
  files.push(full);
}

beforeAll(async () => {
  session = await startContractSession({ secretary: "secretary", technician: "technician", driver: "driver", client: "client" });
  const vehicle = await createTestVehicle();
  const clientVehicle = await createTestVehicle({ ownerId: session.userId("client") });
  session.ids.vehicleIds.push(vehicle.id, clientVehicle.id);

  const token = randomUUID().slice(0, 8);
  writeFile(PROOF_DIR, `TEST-proof-${token}.pdf`);
  writeFile(OTHER_DIR, `TEST-not-proof-${token}.pdf`);
  writeFile(PROOF_DIR, `TEST-proof-${token}.html`);

  withProof = await createRequest(vehicle.id, `/uploads/document-renewals/proofs/TEST-proof-${token}.pdf`);
  withoutProof = await createRequest(vehicle.id, null);
  missingFile = await createRequest(vehicle.id, `/uploads/document-renewals/proofs/TEST-absent-${token}.pdf`);
  outsideProofDir = await createRequest(vehicle.id, `/uploads/documents/TEST-not-proof-${token}.pdf`);
  ownedByClient = await createRequest(clientVehicle.id, `/uploads/document-renewals/proofs/TEST-proof-${token}.pdf`);
  unlistedExtension = await createRequest(vehicle.id, `/uploads/document-renewals/proofs/TEST-proof-${token}.html`);
}, 120000);

afterAll(async () => {
  for (const file of files) fs.rmSync(file, { force: true });
  if (requestIds.length) await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.id, requestIds));
  await session?.stop();
});

const proofUrl = (id: number | string) => `/api/document-renewals/requests/${id}/proof`;

describe("GET /api/document-renewals/requests/:id/proof", () => {
  it.each(["secretary", "technician"] as const)("%s : 200, le fichier déposé tel quel", async (actor) => {
    const res = await session.raw("GET", proofUrl(withProof), actor);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="justificatif.pdf"');
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  it("extension stockée hors liste (fichier antérieur) : téléchargé en octet-stream, jamais rendu", async () => {
    const res = await session.raw("GET", proofUrl(unlistedExtension), "secretary");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each(["driver", "client"] as const)("%s : 403, rien servi", async (actor) => {
    const res = await session.call("GET", proofUrl(withProof), { actor });
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("client propriétaire du véhicule : 403 aussi (lecture réservée au personnel concerné)", async () => {
    const res = await session.call("GET", proofUrl(ownedByClient), { actor: "client" });
    expect(res.status).toBe(403);
  });

  it("sans session : 401", async () => {
    const res = await session.call("GET", proofUrl(withProof), { actor: null });
    expect(res.status).toBe(401);
  });

  it.each([
    ["demande sans justificatif", () => withoutProof],
    ["fichier absent du disque", () => missingFile],
    ["chemin hors du dossier des justificatifs", () => outsideProofDir],
  ])("%s : 404 lisible, sans chemin disque", async (_label, id) => {
    const res = await session.call("GET", proofUrl(id()), { actor: "secretary" });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Justificatif introuvable");
    expect(res.body.requestId).toBeTruthy();
    expect(leakText(res.body)).not.toMatch(/uploads|proofs|TEST-|stack/i);
  });

  it("demande inexistante : 404", async () => {
    const res = await session.call("GET", proofUrl(2147480002), { actor: "secretary" });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe("Demande introuvable");
  });

  it.each(["12abc", "0", "1e3"])("identifiant `%s` : 400", async (raw) => {
    const res = await session.call("GET", proofUrl(raw), { actor: "secretary" });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Identifiant de demande invalide.");
  });
});
