import { existsSync, rmSync } from "fs";
import { join } from "path";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { alerts, documentRenewalCenters, documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { startContractActors } from "../support/contract-actors";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";
import { broadcastAlertCreated } from "../../server/api/document-renewals.routes";

/**
 * Cloison (AGENTS.md §11) des trames émises par le renouvellement rapide.
 * `vehicle_updated` partait en broadcast : tout client connecté recevait véhicule, type de
 * papier et échéance d'un véhicule qui n'est pas le sien. Attendu : le personnel et le
 * propriétaire du véhicule, jamais un client tiers.
 *
 * Les trames sont capturées à `broadcastUpdate`, puis leur portée est résolue comme
 * `server/index.ts` la résout (broadcast : tout le monde ; user : par id ; roles : par rôle),
 * pour deux comptes client distincts.
 */

type Captured = { eventType: string; scope?: { type: string; userIds?: number[]; roles?: string[] } };
type Recipient = { userId: number; role: string };

// normalizeScope (server/index.ts) retombe sur broadcast pour une portée absente, vide ou inconnue.
const isEffectiveBroadcast = (scope: Captured["scope"]): boolean => {
  if (!scope || scope.type === "broadcast") return true;
  if (scope.type === "user") return !(scope.userIds ?? []).some((id) => Number.isInteger(id) && id > 0);
  if (scope.type === "roles") return !(scope.roles ?? []).some((role) => typeof role === "string" && role.trim().length > 0);
  return true;
};

const reaches = (scope: Captured["scope"], recipient: Recipient): boolean => {
  if (isEffectiveBroadcast(scope)) return true;
  if (scope!.type === "user") return (scope!.userIds ?? []).includes(recipient.userId);
  return (scope!.roles ?? []).map((role) => role.trim().toLowerCase()).includes(recipient.role);
};

const ids = createIdBag();
const captured: Captured[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
const proofPaths: string[] = [];
let registration = "";

let actors: Awaited<ReturnType<typeof startContractActors<"secretary" | "owner" | "stranger" | "driver">>>;

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn((eventType: string, data: { scope?: Captured["scope"] }) => {
    captured.push({ eventType, scope: data?.scope });
  });
  actors = await startContractActors({ secretary: "secretary", owner: "client", stranger: "client", driver: "driver" }, ids.userIds);
}, 180000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (registration) await db.delete(alerts).where(like(alerts.message, `%${registration}%`));
  if (ids.vehicleIds.length > 0) {
    const requests = await db
      .delete(documentRenewalRequests)
      .where(inArray(documentRenewalRequests.vehicleId, ids.vehicleIds))
      .returning({ centerId: documentRenewalRequests.centerId, proofFilePath: documentRenewalRequests.proofFilePath });
    for (const row of requests) if (row.proofFilePath) proofPaths.push(row.proofFilePath);
    const centerIds = requests.map((row) => row.centerId).filter((id): id is number => typeof id === "number");
    if (centerIds.length > 0) await db.delete(documentRenewalCenters).where(inArray(documentRenewalCenters.id, centerIds));
  }
  await cleanupCreated(ids);
  for (const proofPath of proofPaths) rmSync(join(process.cwd(), proofPath.replace(/^\//, "")), { force: true });
  await actors?.close();
});

describe("Renouvellement rapide : portée des trames temps réel (§11)", { timeout: 180000 }, () => {
  it("vehicle_updated atteint le personnel et le propriétaire, pas un client tiers ; aucune trame en broadcast", async () => {
    const ownerId = actors.userIdOf("owner");
    const vehicle = await createTestVehicle({ ownerId });
    ids.vehicleIds.push(vehicle.id);
    registration = vehicle.registrationNumber;
    const [document] = await db
      .insert(vehicleDocuments)
      .values({
        vehicleId: vehicle.id,
        name: "TEST assurance",
        type: "assurance",
        filename: "test.pdf",
        filesize: 1,
        fileType: "application/pdf",
        filePath: "uploads/test-inexistant.pdf",
        expiryDate: "2026-11-10",
      })
      .returning();

    const form = new FormData();
    form.append("vehicleId", String(vehicle.id));
    form.append("vehicleDocumentId", String(document.id));
    form.append("comment", "TEST renouvellement");
    form.append("centerName", `TEST-centre-${vehicle.registrationNumber}`);
    form.append("newExpiryDate", "2028-01-31");
    form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-justificatif.pdf");

    captured.length = 0;
    const response = await fetch(`${actors.baseUrl}/api/document-renewals/quick-renew`, {
      method: "POST",
      headers: { Cookie: actors.cookies.get("secretary")! },
      body: form,
    });
    expect(response.status, JSON.stringify(await response.clone().json().catch(() => null))).toBe(200);

    const owner: Recipient = { userId: ownerId, role: "client" };
    const stranger: Recipient = { userId: actors.userIdOf("stranger"), role: "client" };
    const driver: Recipient = { userId: actors.userIdOf("driver"), role: "driver" };
    const secretary: Recipient = { userId: actors.userIdOf("secretary"), role: "secretary" };

    const vehicleUpdated = captured.filter((frame) => frame.eventType === "vehicle_updated");
    expect(vehicleUpdated.length).toBeGreaterThan(0);
    expect(vehicleUpdated.some((frame) => reaches(frame.scope, secretary))).toBe(true);
    expect(vehicleUpdated.some((frame) => reaches(frame.scope, owner))).toBe(true);

    // Aucune trame n'atteint le client tiers ni le chauffeur, aucune ne part en broadcast effectif.
    expect(captured.filter((frame) => reaches(frame.scope, stranger)).map((frame) => frame.eventType)).toEqual([]);
    expect(captured.filter((frame) => reaches(frame.scope, driver)).map((frame) => frame.eventType)).toEqual([]);
    expect(captured.filter((frame) => isEffectiveBroadcast(frame.scope))).toEqual([]);
  });
  it("un échec de diffusion ne renvoie pas 500 et garde le justificatif", async () => {
    const vehicle = await createTestVehicle({ ownerId: actors.userIdOf("owner") });
    ids.vehicleIds.push(vehicle.id);
    const [document] = await db
      .insert(vehicleDocuments)
      .values({
        vehicleId: vehicle.id,
        name: "TEST assurance",
        type: "assurance",
        filename: "test.pdf",
        filesize: 1,
        fileType: "application/pdf",
        filePath: "uploads/test-inexistant.pdf",
        expiryDate: "2026-11-10",
      })
      .returning();

    const form = new FormData();
    form.append("vehicleId", String(vehicle.id));
    form.append("vehicleDocumentId", String(document.id));
    form.append("comment", "TEST renouvellement");
    form.append("centerName", `TEST-centre-${vehicle.registrationNumber}`);
    form.append("newExpiryDate", "2028-01-31");
    form.append("proofFile", new Blob(["%PDF-1.4 TEST"], { type: "application/pdf" }), "TEST-justificatif.pdf");

    // Le centre est créé avant l'écriture (résolveur) ; les trois autres trames partent après.
    const FAILING_EVENTS = [
      "document_renewal_center_changed",
      "document_renewal_quick_completed",
      "vehicle_document_updated",
      "vehicle_updated",
    ];
    const spy = (global as any).broadcastUpdate;
    (global as any).broadcastUpdate = (eventType: string) => {
      if (FAILING_EVENTS.includes(eventType)) throw new Error("TEST socket indisponible");
    };
    try {
      const response = await fetch(`${actors.baseUrl}/api/document-renewals/quick-renew`, {
        method: "POST",
        headers: { Cookie: actors.cookies.get("secretary")! },
        body: form,
      });
      expect(response.status).toBe(200);
    } finally {
      (global as any).broadcastUpdate = spy;
    }

    const [request] = await db
      .select({ proofFilePath: documentRenewalRequests.proofFilePath })
      .from(documentRenewalRequests)
      .where(eq(documentRenewalRequests.vehicleDocumentId, document.id));
    expect(request?.proofFilePath).toBeTruthy();
    expect(existsSync(join(process.cwd(), request!.proofFilePath!.replace(/^\//, "")))).toBe(true);
  });
  it("alert_created sans destinataire : personnel seulement, ni client ni chauffeur", () => {
    captured.length = 0;
    broadcastAlertCreated({ id: 1, userId: null, title: "TEST", type: "maintenance", priority: "high", link: null, message: "TEST" });
    expect(captured).toHaveLength(1);
    const [frame] = captured;
    expect(isEffectiveBroadcast(frame.scope)).toBe(false);
    expect(reaches(frame.scope, { userId: actors.userIdOf("stranger"), role: "client" })).toBe(false);
    expect(reaches(frame.scope, { userId: actors.userIdOf("driver"), role: "driver" })).toBe(false);
    expect(reaches(frame.scope, { userId: actors.userIdOf("secretary"), role: "secretary" })).toBe(true);
  });
});
