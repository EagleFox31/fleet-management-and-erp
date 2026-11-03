import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { DOCUMENT_RENEWAL_VIEWER_ROLES } from "../../shared/constants/roles";
import { addDaysToIsoDate, RENEWAL_RECEIPT_MAX_VALIDITY_DAYS } from "../../shared/constants/document-renewal-statuses";
import { getMissionEligibility } from "../../shared/constants/vehicle-eligibility";
import { todayUtcDateOnly } from "../../shared/lib/utc-day";
import { startContractActors } from "../support/contract-actors";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/**
 * P3-2 lot 2b, durcissement : pas de chemin disque dans les réponses ni les diffusions, portée
 * des événements, borne haute de validité (J+90), jour UTC unique, diffusion au mieux,
 * extension tirée du type MIME, deux dépôts simultanés.
 */

const ids = createIdBag();
const spy = vi.fn();
const previousBroadcast = (global as any).broadcastUpdate;
const receiptsDir = path.join(process.cwd(), "uploads", "document-renewals", "receipts");
const createdFiles = new Set<string>();

let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "client" | "driver">>>;
let vehicleId = 0;
let documentId = 0;

const isoDay = (offsetDays: number) => addDaysToIsoDate(todayUtcDateOnly(), offsetDays);
const listing = () => new Set(fs.existsSync(receiptsDir) ? fs.readdirSync(receiptsDir) : []);

async function newRequest(status: "pending" | "in_progress" = "pending") {
  const [row] = await db
    .insert(documentRenewalRequests)
    .values({ vehicleId, vehicleDocumentId: documentId, documentType: "assurance", status })
    .returning();
  return row.id;
}

async function deposit(requestId: number, fields: { validUntil: string; name?: string; type?: string }) {
  const form = new FormData();
  form.set("validUntil", fields.validUntil);
  form.set("receiptFile", new Blob(["%PDF-1.4 TEST"], { type: fields.type ?? "application/pdf" }), fields.name ?? "recepisse.pdf");
  const response = await fetch(`${actors.baseUrl}/api/document-renewals/requests/${requestId}/receipt`, {
    method: "POST",
    headers: { Cookie: actors.cookies.get("admin")! },
    body: form,
  });
  const body = await response.json().catch(() => null);
  const [row] = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.id, requestId));
  if (row?.receiptFilePath) createdFiles.add(path.resolve(process.cwd(), row.receiptFilePath));
  return { status: response.status, body, row };
}

beforeAll(async () => {
  (global as any).broadcastUpdate = spy;
  actors = await startContractActors({ admin: "admin", client: "client", driver: "driver" }, ids.userIds);
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  const [document] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId, name: "TEST assurance", type: "assurance", filename: "t.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/test-inexistant.pdf" })
    .returning();
  documentId = document.id;
}, 180000);

afterEach(() => {
  vi.useRealTimers();
  (global as any).broadcastUpdate = spy;
});

afterAll(async () => {
  vi.useRealTimers();
  (global as any).broadcastUpdate = previousBroadcast;
  await cleanupCreated(ids);
  for (const file of createdFiles) fs.rmSync(file, { force: true });
  await actors?.close();
});

describe("récépissé : durcissement", { timeout: 180000 }, () => {
  it("PATCH status d'une demande avec récépissé : ni réponse ni diffusion ne portent de chemin disque, diffusion limitée aux rôles lecteurs", async () => {
    const id = await newRequest();
    expect((await deposit(id, { validUntil: isoDay(5) })).status).toBe(201);
    await db.update(documentRenewalRequests).set({ proofFilePath: "/uploads/document-renewals/proofs/x.pdf", proofFileName: "x.pdf" }).where(eq(documentRenewalRequests.id, id));
    spy.mockClear();
    const response = await fetch(`${actors.baseUrl}/api/document-renewals/requests/${id}/status`, {
      method: "PATCH",
      headers: { Cookie: actors.cookies.get("admin")!, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toMatch(/FilePath/);
    expect(body.receiptFileName).toBe("recepisse.pdf");
    const events = spy.mock.calls.filter(([event]) => event === "document_renewal_request_status_updated");
    expect(events).toHaveLength(1);
    const [, data] = events[0];
    expect(JSON.stringify(data.payload)).not.toMatch(/FilePath/);
    expect(data.scope.type).toBe("roles");
    expect([...data.scope.roles].sort()).toEqual([...DOCUMENT_RENEWAL_VIEWER_ROLES].sort());
    expect(data.scope.roles).not.toContain("client");
    expect(data.scope.roles).not.toContain("driver");
  });

  it("borne haute : J+90 accepté, J+91 refusé en 400 sans fichier restant", async () => {
    const id = await newRequest();
    const before = listing();
    const refused = await deposit(id, { validUntil: isoDay(RENEWAL_RECEIPT_MAX_VALIDITY_DAYS + 1) });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/90 jours/);
    expect(refused.row!.receiptFilePath).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    expect([...listing()].filter((name) => !before.has(name))).toEqual([]);
    expect((await deposit(id, { validUntil: isoDay(RENEWAL_RECEIPT_MAX_VALIDITY_DAYS) })).status).toBe(201);
  });

  it("jour UTC unique : à 23:30Z, un récépissé daté du jour est accepté par la route et valable pour l'éligibilité", async () => {
    const id = await newRequest();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-03T23:30:00Z"));
    const res = await deposit(id, { validUntil: "2026-11-03" });
    expect(res.status).toBe(201);
    const eligibility = getMissionEligibility({ status: "operational", insuranceExpiry: "2026-10-01", receipts: { insurance: "2026-11-03" } }, new Date());
    expect(eligibility.eligible).toBe(true);
    // Une demi-heure plus tard, le jour UTC change : refus de la route, éligibilité de nouveau bloquée.
    vi.setSystemTime(new Date("2026-11-04T00:30:00Z"));
    const next = await newRequest();
    expect((await deposit(next, { validUntil: "2026-11-03" })).status).toBe(400);
    expect(getMissionEligibility({ status: "operational", insuranceExpiry: "2026-10-01", receipts: { insurance: "2026-11-03" } }, new Date()).eligible).toBe(false);
  });

  it("diffusion en échec : 201, fichier et ligne conservés", async () => {
    const id = await newRequest();
    (global as any).broadcastUpdate = () => {
      throw new Error("diffusion indisponible");
    };
    const res = await deposit(id, { validUntil: isoDay(4) });
    expect(res.status).toBe(201);
    expect(res.row!.receiptFilePath).toBeTruthy();
    expect(fs.existsSync(path.resolve(process.cwd(), res.row!.receiptFilePath!))).toBe(true);
  });

  it("l'extension du fichier rangé vient du type MIME, jamais du nom envoyé", async () => {
    const id = await newRequest();
    const res = await deposit(id, { validUntil: isoDay(4), name: "script.php.html", type: "image/png" });
    expect(res.status).toBe(201);
    expect(res.row!.receiptFilePath).toMatch(/\.png$/);
    expect(res.row!.receiptFilePath).not.toMatch(/\.(php|html)/);
  });

  it("deux dépôts simultanés : l'un remplace l'autre, un seul fichier reste référencé", async () => {
    const id = await newRequest();
    const before = listing();
    const [a, b] = await Promise.all([
      deposit(id, { validUntil: isoDay(3), name: "a.pdf" }),
      deposit(id, { validUntil: isoDay(6), name: "b.pdf" }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    const [row] = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.id, id));
    await new Promise((r) => setTimeout(r, 300));
    const added = [...listing()].filter((name) => !before.has(name));
    expect(added).toEqual([path.basename(row.receiptFilePath!)]);
  });
});
