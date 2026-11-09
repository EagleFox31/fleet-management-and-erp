import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../server/db";
import { storage } from "../../server/storage";
import { alerts, documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";

/**
 * POST /api/document-renewals/requests écrit la demande, puis lit les destinataires par rôle
 * pour les notifier. `getUsersByRole` lève désormais sur erreur (il renvoyait `[]`) : la
 * lecture passe par `usersByRolesBestEffort`, la demande reste créée et la réponse en 201.
 */

const ids = createIdBag();
const vehicleIds: number[] = [];
const previousBroadcast = (global as any).broadcastUpdate;
let session: Awaited<ReturnType<typeof startContractActors<"secretary">>>;

beforeAll(async () => {
  (global as any).broadcastUpdate = vi.fn();
  session = await startContractActors({ secretary: "secretary" } as const, ids.userIds);
}, 120000);

afterAll(async () => {
  vi.restoreAllMocks();
  (global as any).broadcastUpdate = previousBroadcast;
  if (vehicleIds.length > 0) {
    await db.delete(alerts).where(inArray(alerts.link, vehicleIds.map((id) => `/vehicles/${id}`)));
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.vehicleId, vehicleIds));
    await db.delete(vehicleDocuments).where(inArray(vehicleDocuments.vehicleId, vehicleIds));
  }
  await cleanupCreated(ids);
  await session?.close();
});

describe("POST /api/document-renewals/requests : destinataires illisibles", () => {
  it("reste en 201, crée la demande et notifie au moins le demandeur quand getUsersByRole lève", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);
    vehicleIds.push(vehicle.id);
    const [document] = await db
      .insert(vehicleDocuments)
      .values({
        vehicleId: vehicle.id,
        name: "TEST assurance",
        type: "assurance",
        filename: "x.pdf",
        filesize: 1,
        fileType: "application/pdf",
        filePath: "uploads/x.pdf",
        expiryDate: "2020-01-01",
      } as any)
      .returning();

    const spy = vi.spyOn(storage, "getUsersByRole").mockRejectedValue(new Error("timeout exceeded when trying to connect"));
    const res = await session.call("POST", "/api/document-renewals/requests", {
      actor: "secretary",
      body: { vehicleId: vehicle.id, vehicleDocumentId: document.id, comment: "TEST renouvellement" },
    });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    expect(res.status).toBe(201);
    const rows = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.vehicleDocumentId, document.id));
    expect(rows).toHaveLength(1);
    const notified = await db.select().from(alerts).where(eq(alerts.link, `/vehicles/${vehicle.id}`));
    expect(notified.map((a) => a.userId)).toContain(session.userIdOf("secretary"));
  }, 60000);
});
