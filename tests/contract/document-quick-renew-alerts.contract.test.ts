import { createServer, type Server } from "http";
import { rmSync } from "fs";
import { join } from "path";
import { and, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import { alerts, documentRenewalCenters, documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { documentExpiryDedupeKey } from "../../server/services/document-expiry-rule";
import { getContractApp } from "../support/app";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle, TEST_USER_PASSWORD } from "../support/factories";

/**
 * DOC3 : un renouvellement rapide met à jour l'échéance du document et lève
 * les alertes d'échéance de CE document (clés `doc_expiry:<statut>:<id>:<date>`).
 * Les alertes d'un autre document restent en place.
 */

let server: Server;
let baseUrl = "";
const ids = createIdBag();
const centerIds: number[] = [];
const proofPaths: string[] = [];
const registrations: string[] = [];

beforeAll(async () => {
  const app = await getContractApp();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(async () => {
  for (const registration of registrations) {
    await db.delete(alerts).where(like(alerts.message, `%${registration}%`));
  }
  // Le centre créé référence l'utilisateur (createdBy) et la demande référence le centre.
  if (ids.vehicleIds.length > 0) {
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleId, ids.vehicleIds));
  }
  if (centerIds.length > 0) {
    await db.delete(documentRenewalCenters).where(inArray(documentRenewalCenters.id, centerIds));
  }
  await cleanupCreated(ids);
  for (const proofPath of proofPaths) {
    rmSync(join(process.cwd(), proofPath.replace(/^\//, "")), { force: true });
  }
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function insertDocument(vehicleId: number, expiryDate: string) {
  const [document] = await db
    .insert(vehicleDocuments)
    .values({
      vehicleId,
      name: "TEST assurance",
      type: "assurance",
      filename: "test.pdf",
      filesize: 1,
      fileType: "application/pdf",
      filePath: "uploads/test-inexistant.pdf",
      expiryDate,
    })
    .returning();
  return document;
}

describe("DOC3 : renouvellement rapide d'un document", { timeout: 180000 }, () => {
  it("met à jour l'échéance et lève les alertes d'échéance du document, pas celles des autres", async () => {
    const secretary = await createTestUser({ role: "secretary" });
    ids.userIds.push(secretary.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    registrations.push(vehicle.registrationNumber);

    const oldExpiry = "2026-11-10";
    const renewed = await insertDocument(vehicle.id, oldExpiry);
    const other = await insertDocument(vehicle.id, oldExpiry);

    const alertRow = (dedupeKey: string) => ({
      userId: secretary.id,
      title: "TEST échéance",
      message: `TEST ${vehicle.registrationNumber}`,
      type: "maintenance" as const,
      priority: "high" as const,
      topic: "documents",
      dedupeKey,
    });
    await db.insert(alerts).values([
      alertRow(documentExpiryDedupeKey(renewed.id, oldExpiry, "due")),
      alertRow(documentExpiryDedupeKey(renewed.id, "2026-10-01", "expired")),
      alertRow(documentExpiryDedupeKey(other.id, oldExpiry, "due")),
    ]);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: secretary.username, password: TEST_USER_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];

    const form = new FormData();
    form.append("vehicleId", String(vehicle.id));
    form.append("vehicleDocumentId", String(renewed.id));
    form.append("comment", "TEST renouvellement");
    form.append("centerName", `TEST-centre-${vehicle.registrationNumber}`);
    form.append("newExpiryDate", "2028-01-31");
    form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-justificatif.pdf");

    const response = await fetch(`${baseUrl}/api/document-renewals/quick-renew`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    const [request] = await db
      .select()
      .from(documentRenewalRequests)
      .where(eq(documentRenewalRequests.vehicleDocumentId, renewed.id));
    if (request?.centerId) centerIds.push(request.centerId);
    if (request?.proofFilePath) proofPaths.push(request.proofFilePath);
    expect(response.status).toBe(200);

    const [document] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, renewed.id));
    expect(String(document.expiryDate).slice(0, 10)).toBe("2028-01-31");
    expect(request.status).toBe("completed");

    const remaining = await db
      .select({ dedupeKey: alerts.dedupeKey })
      .from(alerts)
      .where(and(eq(alerts.userId, secretary.id), like(alerts.dedupeKey, "doc_expiry:%")));
    expect(remaining.map((row) => row.dedupeKey)).toEqual([documentExpiryDedupeKey(other.id, oldExpiry, "due")]);
  });

  it("P4 : alerte d'échéance -> demande -> en cours -> renouvelé : document à jour, demande close, alerte levée", async () => {
    const secretary = await createTestUser({ role: "secretary" });
    ids.userIds.push(secretary.id);
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    registrations.push(vehicle.registrationNumber);

    const oldExpiry = "2026-11-15";
    const document = await insertDocument(vehicle.id, oldExpiry);
    await db.insert(alerts).values({
      userId: secretary.id,
      title: "TEST échéance",
      message: `TEST ${vehicle.registrationNumber}`,
      type: "maintenance",
      priority: "medium",
      topic: "documents",
      dedupeKey: documentExpiryDedupeKey(document.id, oldExpiry, "due"),
    });

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: secretary.username, password: TEST_USER_PASSWORD }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const json = { "Content-Type": "application/json", Cookie: cookie };
    const centerName = `TEST-centre-p4-${vehicle.registrationNumber}`;

    const created = await fetch(`${baseUrl}/api/document-renewals/requests`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ vehicleId: vehicle.id, vehicleDocumentId: document.id, comment: "TEST demande", centerName }),
    });
    const [request] = await db
      .select()
      .from(documentRenewalRequests)
      .where(eq(documentRenewalRequests.vehicleDocumentId, document.id));
    if (request?.centerId) centerIds.push(request.centerId);
    expect(created.status).toBeLessThan(300);
    expect(request.status).toBe("pending");

    const started = await fetch(`${baseUrl}/api/document-renewals/requests/${request.id}/status`, {
      method: "PATCH",
      headers: json,
      body: JSON.stringify({ status: "in_progress" }),
    });
    expect(started.status).toBe(200);

    const form = new FormData();
    form.append("requestId", String(request.id));
    form.append("vehicleId", String(vehicle.id));
    form.append("vehicleDocumentId", String(document.id));
    form.append("comment", "TEST renouvellement");
    form.append("centerName", centerName);
    form.append("newExpiryDate", "2027-11-15");
    form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-justificatif.pdf");
    const renewed = await fetch(`${baseUrl}/api/document-renewals/quick-renew`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form,
    });
    const requests = await db
      .select()
      .from(documentRenewalRequests)
      .where(eq(documentRenewalRequests.vehicleDocumentId, document.id));
    for (const row of requests) if (row.proofFilePath) proofPaths.push(row.proofFilePath);
    expect(renewed.status).toBe(200);

    // Une seule demande : celle ouverte est close, pas doublée.
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ id: request.id, status: "completed", completedBy: secretary.id });
    const [updated] = await db.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, document.id));
    expect(String(updated.expiryDate).slice(0, 10)).toBe("2027-11-15");

    const mine = await db.select().from(alerts).where(eq(alerts.userId, secretary.id));
    expect(mine.filter((row) => row.dedupeKey?.startsWith("doc_expiry:"))).toEqual([]);
    expect(mine.some((row) => row.message.includes(vehicle.registrationNumber) && row.title.endsWith("renouvelé"))).toBe(true);
  });
});
