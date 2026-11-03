import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../server/db";
import { documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { REALTIME_EVENTS } from "../../shared/contracts/realtime-events";
import { renewalReceiptErrorOf } from "../../server/lib/renewal-receipts";
import { startContractActors } from "../support/contract-actors";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/**
 * P3-2 lot 2b : dépôt du récépissé provisoire (POST /api/document-renewals/requests/:id/receipt).
 * Écrit en base et sous uploads/document-renewals/receipts ; le véhicule supprimé emporte
 * document et demandes (cascade), les fichiers déposés sont retirés en fin de suite.
 */

const ids = createIdBag();
const spy = vi.fn();
const previousBroadcast = (global as any).broadcastUpdate;
const receiptsDir = path.join(process.cwd(), "uploads", "document-renewals", "receipts");
const outsideFile = path.join(process.cwd(), `TEST-hors-uploads-${Date.now()}.txt`);
const createdFiles = new Set<string>();

let actors: Awaited<ReturnType<typeof startContractActors<"admin" | "secretary" | "logistics" | "workshop_manager" | "technician" | "driver" | "client">>>;
let vehicleId = 0;
let documentId = 0;

const isoDay = (offsetDays: number) => {
  // Jour calendaire Africa/Douala (UTC+1, sans heure d'été), comme la route.
  const base = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Douala" }).format(new Date()) + "T00:00:00Z");
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
};

async function newRequest(status: "pending" | "in_progress" | "completed" | "rejected" = "pending") {
  const [row] = await db
    .insert(documentRenewalRequests)
    .values({ vehicleId, vehicleDocumentId: documentId, documentType: "assurance", status })
    .returning();
  return row.id;
}

async function deposit(
  requestId: number | string,
  actor: "admin" | "secretary" | "logistics" | "workshop_manager" | "technician" | "driver" | "client",
  fields: { validUntil?: string; file?: { name: string; type?: string } | null } = {},
) {
  const form = new FormData();
  if (fields.validUntil !== undefined) form.set("validUntil", fields.validUntil);
  if (fields.file !== null) {
    const file = fields.file ?? { name: "recepisse.pdf" };
    form.set("receiptFile", new Blob(["%PDF-1.4 TEST récépissé"], { type: file.type ?? "application/pdf" }), file.name);
  }
  const response = await fetch(`${actors.baseUrl}/api/document-renewals/requests/${requestId}/receipt`, {
    method: "POST",
    headers: { Cookie: actors.cookies.get(actor)! },
    body: form,
  });
  const body = await response.json().catch(() => null);
  const row = typeof requestId === "number"
    ? (await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.id, requestId)))[0]
    : undefined;
  if (row?.receiptFilePath) createdFiles.add(path.resolve(process.cwd(), row.receiptFilePath));
  return { status: response.status, body, row };
}

const waitGone = async (file: string) => {
  for (let i = 0; i < 40 && fs.existsSync(file); i += 1) await new Promise((r) => setTimeout(r, 25));
  return !fs.existsSync(file);
};

beforeAll(async () => {
  (global as any).broadcastUpdate = spy;
  actors = await startContractActors(
    { admin: "admin", secretary: "secretary", logistics: "logistics", workshop_manager: "workshop_manager", technician: "technician", driver: "driver", client: "client" },
    ids.userIds,
  );
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
  const [document] = await db
    .insert(vehicleDocuments)
    .values({ vehicleId, name: "TEST assurance", type: "assurance", filename: "t.pdf", filesize: 1, fileType: "application/pdf", filePath: "uploads/test-inexistant.pdf" })
    .returning();
  documentId = document.id;
}, 180000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  await cleanupCreated(ids);
  for (const file of createdFiles) fs.rmSync(file, { force: true });
  fs.rmSync(outsideFile, { force: true });
  await actors?.close();
});

describe("dépôt du récépissé provisoire", { timeout: 180000 }, () => {
  it("201 : range le fichier sous uploads/, trace le déposant et diffuse au personnel seulement", async () => {
    const id = await newRequest();
    spy.mockClear();
    const res = await deposit(id, "secretary", { validUntil: isoDay(10) });
    expect(res.status).toBe(201);
    expect(res.row).toMatchObject({ receiptValidUntil: isoDay(10), receiptUploadedBy: actors.userIdOf("secretary") });
    expect(res.row!.receiptFilePath).toMatch(/^uploads\/document-renewals\/receipts\/recepisse-[\w-]+\.pdf$/);
    expect(fs.existsSync(path.resolve(process.cwd(), res.row!.receiptFilePath!))).toBe(true);
    expect(res.row!.receiptUploadedAt).toBeInstanceOf(Date);
    // Aucun chemin disque dans la réponse.
    expect(res.body).not.toHaveProperty("receiptFilePath");
    expect(res.body.receiptFileName).toBe("recepisse.pdf");

    const events = spy.mock.calls.filter(([event]) => event === "document_renewal_receipt_uploaded");
    expect(events).toHaveLength(1);
    const [, data] = events[0];
    expect(data.scope).toEqual(REALTIME_EVENTS.document_renewal_receipt_uploaded.scope);
    expect(data.scope.roles).not.toContain("client");
    expect(data.scope.roles).not.toContain("driver");
    expect(data.entityId).toBe(id);
    expect(JSON.stringify(data.payload)).not.toContain("receiptFilePath");
  });

  it("les quatre rôles écrivains déposent ; technicien, chauffeur et client reçoivent 403 sans rien écrire", async () => {
    const id = await newRequest("in_progress");
    for (const actor of ["admin", "logistics", "workshop_manager"] as const) {
      expect((await deposit(id, actor, { validUntil: isoDay(5) })).status, actor).toBe(201);
    }
    const fresh = await newRequest();
    for (const actor of ["technician", "driver", "client"] as const) {
      const res = await deposit(fresh, actor, { validUntil: isoDay(5) });
      expect(res.status, actor).toBe(403);
      expect(res.row!.receiptFilePath).toBeNull();
    }
  });

  it("remplacer un récépissé retire l'ancien fichier", async () => {
    const id = await newRequest();
    const first = await deposit(id, "admin", { validUntil: isoDay(3), file: { name: "premier.pdf" } });
    const oldFile = path.resolve(process.cwd(), first.row!.receiptFilePath!);
    expect(fs.existsSync(oldFile)).toBe(true);
    const second = await deposit(id, "admin", { validUntil: isoDay(9), file: { name: "second.pdf" } });
    expect(second.status).toBe(201);
    expect(second.row!.receiptFilePath).not.toBe(first.row!.receiptFilePath);
    expect(second.row!.receiptValidUntil).toBe(isoDay(9));
    expect(await waitGone(oldFile)).toBe(true);
  });

  it("400 : date de validité passée, illisible ou absente, fichier absent ou d'un format refusé ; le fichier reçu est retiré", async () => {
    const id = await newRequest();
    const before = new Set(fs.existsSync(receiptsDir) ? fs.readdirSync(receiptsDir) : []);
    const past = await deposit(id, "admin", { validUntil: isoDay(-1) });
    expect(past.status).toBe(400);
    expect(past.body.message).toMatch(/déjà passée/);
    expect(past.row!.receiptFilePath).toBeNull();
    expect((await deposit(id, "admin", { validUntil: "31/12/2099" })).status).toBe(400);
    expect((await deposit(id, "admin", {})).status).toBe(400);
    expect((await deposit(id, "admin", { validUntil: isoDay(2), file: null })).status).toBe(400);
    expect((await deposit(id, "admin", { validUntil: isoDay(2), file: { name: "virus.exe", type: "application/x-msdownload" } })).status).toBe(400);
    expect((await deposit("abc", "admin", { validUntil: isoDay(2) })).status).toBe(400);
    await new Promise((r) => setTimeout(r, 200));
    const leftovers = fs.readdirSync(receiptsDir).filter((name) => !before.has(name));
    expect(leftovers).toEqual([]);
  });

  it("le jour même est accepté (date de validité incluse)", async () => {
    const id = await newRequest();
    expect((await deposit(id, "admin", { validUntil: isoDay(0) })).status).toBe(201);
  });

  it("404 : demande introuvable ; 409 : demande terminée ou rejetée", async () => {
    expect((await deposit(2147483000, "admin", { validUntil: isoDay(4) })).status).toBe(404);
    for (const status of ["completed", "rejected"] as const) {
      const id = await newRequest(status);
      const res = await deposit(id, "admin", { validUntil: isoDay(4) });
      expect(res.status, status).toBe(409);
      expect(res.row!.receiptFilePath).toBeNull();
    }
  });

  it("chemin : nom de fichier hostile rangé sous uploads/, ancien chemin hors uploads/ jamais supprimé", async () => {
    const id = await newRequest();
    const hostile = await deposit(id, "admin", { validUntil: isoDay(4), file: { name: "../../../etc/passwd.pdf" } });
    expect(hostile.status).toBe(201);
    const stored = path.resolve(process.cwd(), hostile.row!.receiptFilePath!);
    expect(path.relative(receiptsDir, stored).startsWith("..")).toBe(false);

    // Un chemin hérité hors de uploads/ (ici un fichier à la racine) n'est pas supprimé au remplacement.
    fs.writeFileSync(outsideFile, "ne pas supprimer");
    await db
      .update(documentRenewalRequests)
      .set({ receiptFilePath: path.basename(outsideFile) })
      .where(eq(documentRenewalRequests.id, id));
    expect((await deposit(id, "admin", { validUntil: isoDay(6) })).status).toBe(201);
    await new Promise((r) => setTimeout(r, 200));
    expect(fs.existsSync(outsideFile)).toBe(true);
  });

  it("400 CHECK : un récépissé à moitié renseigné devient une erreur lisible, sans texte SQL", async () => {
    const id = await newRequest();
    let violation: unknown;
    try {
      await db.update(documentRenewalRequests).set({ receiptValidUntil: isoDay(2) }).where(eq(documentRenewalRequests.id, id));
    } catch (error) {
      violation = error;
    }
    expect(violation).toBeDefined();
    const translated = renewalReceiptErrorOf(violation);
    expect(translated).not.toBeNull();
    expect(translated!.status).toBe(400);
    expect(translated!.message).not.toMatch(/check|constraint|violates|document_renewal_requests/i);
    expect(renewalReceiptErrorOf(new Error("autre"))).toBeNull();
  });
});
