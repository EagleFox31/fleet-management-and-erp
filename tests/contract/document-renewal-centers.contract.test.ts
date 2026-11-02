import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { documentRenewalCenters, documentRenewalRequests, vehicleDocuments } from "../../shared/schema";
import {
  DOCUMENT_RENEWAL_CENTERS_PATH,
  documentRenewalCenterActivePath,
  documentRenewalCenterPath,
} from "../../shared/contracts/document-renewal-centers";
import { REALTIME_EVENTS } from "../../shared/contracts/realtime-events";
import { startContractActors } from "../support/contract-actors";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/** DOC1 : gestion des centres de renouvellement (écriture, désactivation, garde des demandes). */
const ids = createIdBag();
const SUFFIX = Date.now().toString(36);
const centerIds: number[] = [];
const spy = vi.fn();
const previousBroadcast = (global as any).broadcastUpdate;
type Actor = "admin" | "secretary" | "logistics" | "workshop_manager" | "technician" | "driver" | "client";
let harness: Awaited<ReturnType<typeof startContractActors<Actor>>>;
let vehicleDocumentId = 0;
let vehicleId = 0;

const call = (method: string, path: string, actor?: Actor, body?: unknown) => harness.call(method, path, { actor, body });

async function createCenter(name: string, documentType: string | null = "assurance") {
  const res = await call("POST", DOCUMENT_RENEWAL_CENTERS_PATH, "secretary", { name, documentType });
  if (res.body?.id) centerIds.push(res.body.id);
  return res;
}

beforeAll(async () => {
  harness = await startContractActors(
    { admin: "admin", secretary: "secretary", logistics: "logistics", workshop_manager: "workshop_manager", technician: "technician", driver: "driver", client: "client" },
    ids.userIds,
  );
  const vehicle = await createTestVehicle();
  vehicleId = vehicle.id;
  ids.vehicleIds.push(vehicle.id);
  const [doc] = await db
    .insert(vehicleDocuments)
    .values({
      vehicleId,
      name: "TEST assurance centres",
      type: "assurance",
      filename: "test.pdf",
      filesize: 1,
      fileType: "application/pdf",
      filePath: "uploads/test-inexistant.pdf",
    })
    .returning();
  vehicleDocumentId = doc.id;
  (global as any).broadcastUpdate = spy;
}, 180000);

afterAll(async () => {
  (global as any).broadcastUpdate = previousBroadcast;
  if (centerIds.length) {
    await db.delete(documentRenewalRequests).where(inArray(documentRenewalRequests.centerId, centerIds));
    await db.delete(documentRenewalCenters).where(inArray(documentRenewalCenters.id, centerIds));
  }
  await cleanupCreated(ids);
  await harness.close();
});

describe("centres de renouvellement : écriture", { timeout: 180000 }, () => {
  it("401 sans session, 403 hors rôles écrivains, sur les trois routes", async () => {
    const body = { name: `TEST refus ${SUFFIX}` };
    for (const [method, path] of [
      ["POST", DOCUMENT_RENEWAL_CENTERS_PATH],
      ["PATCH", documentRenewalCenterPath(1)],
      ["PATCH", documentRenewalCenterActivePath(1)],
    ] as const) {
      expect((await call(method, path, undefined, body)).status).toBe(401);
      for (const actor of ["technician", "driver", "client"] as const) {
        expect((await call(method, path, actor, body)).status, `${method} ${path} ${actor}`).toBe(403);
      }
    }
  });

  it("les quatre rôles écrivains créent un centre (201) et l'événement part en rôles", async () => {
    spy.mockClear();
    for (const actor of ["admin", "secretary", "logistics", "workshop_manager"] as const) {
      const res = await call("POST", DOCUMENT_RENEWAL_CENTERS_PATH, actor, {
        name: `TEST centre ${actor} ${SUFFIX}`,
        documentType: "visite_technique",
        accreditationNumber: "  AGR-1  ",
      });
      expect(res.status, actor).toBe(201);
      centerIds.push(res.body.id);
      expect(res.body).toMatchObject({ isActive: true, accreditationNumber: "AGR-1", address: null, contact: null });
    }
    expect(spy).toHaveBeenCalledTimes(4);
    const [event, data] = spy.mock.calls[0];
    expect(event).toBe("document_renewal_center_changed");
    expect(data.scope).toEqual(REALTIME_EVENTS.document_renewal_center_changed.scope);
    expect(data.payload).toEqual({ id: centerIds[centerIds.length - 4] });
  });

  it("400 Zod : nom absent ou trop court, type inconnu, champ inattendu, corps vide en PATCH", async () => {
    expect((await call("POST", DOCUMENT_RENEWAL_CENTERS_PATH, "admin", {})).status).toBe(400);
    expect((await call("POST", DOCUMENT_RENEWAL_CENTERS_PATH, "admin", { name: "A" })).status).toBe(400);
    expect((await call("POST", DOCUMENT_RENEWAL_CENTERS_PATH, "admin", { name: "TEST type", documentType: "permis" })).status).toBe(400);
    expect((await call("POST", DOCUMENT_RENEWAL_CENTERS_PATH, "admin", { name: "TEST champ", isActive: false })).status).toBe(400);
    const created = await createCenter(`TEST zod ${SUFFIX}`);
    expect((await call("PATCH", documentRenewalCenterPath(created.body.id), "admin", {})).status).toBe(400);
    expect((await call("PATCH", documentRenewalCenterActivePath(created.body.id), "admin", { isActive: "oui" })).status).toBe(400);
  });

  it("409 sur un nom déjà pris pour le même type, sans tenir compte de la casse ; type différent refusé aussi par l'unicité SQL", async () => {
    const first = await createCenter(`TEST doublon ${SUFFIX}`, "taxe");
    expect(first.status).toBe(201);
    const same = await call("POST", DOCUMENT_RENEWAL_CENTERS_PATH, "admin", { name: `test DOUBLON ${SUFFIX}`, documentType: "taxe" });
    expect(same.status).toBe(409);
    expect(JSON.stringify(same.body)).not.toMatch(/duplicate|constraint|sql/i);
    // L'unicité SQL porte sur le nom seul : même nom sous un autre type = 409 aussi (voir rapport).
    const otherType = await call("POST", DOCUMENT_RENEWAL_CENTERS_PATH, "admin", { name: `TEST doublon ${SUFFIX}`, documentType: "assurance" });
    expect(otherType.status).toBe(409);
  });

  it("PATCH modifie les champs, refuse un nom pris (409), 404 si inconnu", async () => {
    const a = await createCenter(`TEST patch A ${SUFFIX}`);
    const b = await createCenter(`TEST patch B ${SUFFIX}`);
    const ok = await call("PATCH", documentRenewalCenterPath(a.body.id), "logistics", { address: "Douala", contact: null });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ id: a.body.id, name: `TEST patch A ${SUFFIX}`, address: "Douala", contact: null });
    expect((await call("PATCH", documentRenewalCenterPath(a.body.id), "logistics", { name: b.body.name })).status).toBe(409);
    // Se renommer vers son propre nom n'est pas un doublon.
    expect((await call("PATCH", documentRenewalCenterPath(a.body.id), "logistics", { name: a.body.name })).status).toBe(200);
    expect((await call("PATCH", documentRenewalCenterPath(999999999), "admin", { address: "x" })).status).toBe(404);
    expect((await call("PATCH", `${DOCUMENT_RENEWAL_CENTERS_PATH}/abc`, "admin", { address: "x" })).status).toBe(404);
  });
});

describe("centres de renouvellement : désactivation", { timeout: 180000 }, () => {
  it("un centre désactivé disparaît du GET des choix, includeInactive le montre aux écrivains, réactivé il revient", async () => {
    const name = `TEST cycle ${SUFFIX}`;
    const created = await createCenter(name, "carte_grise");
    const id = created.body.id;
    const inChoices = async (query = "", actor: "secretary" | "technician" = "secretary") => {
      const res = await call("GET", `${DOCUMENT_RENEWAL_CENTERS_PATH}${query}`, actor);
      expect(res.status).toBe(200);
      return (res.body as Array<{ id: number }>).some((row) => row.id === id);
    };
    expect(await inChoices()).toBe(true);

    spy.mockClear();
    const off = await call("PATCH", documentRenewalCenterActivePath(id), "secretary", { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("document_renewal_center_changed");

    expect(await inChoices()).toBe(false);
    expect(await inChoices("?documentType=carte_grise")).toBe(false);
    expect(await inChoices("?includeInactive=1")).toBe(true);
    expect(await inChoices("?includeInactive=1&documentType=carte_grise")).toBe(true);
    // Lecture simple ouverte au technicien, mais pas la vue des désactivés.
    expect(await inChoices("", "technician")).toBe(false);
    expect((await call("GET", `${DOCUMENT_RENEWAL_CENTERS_PATH}?includeInactive=1`, "technician")).status).toBe(403);
    expect((await call("GET", `${DOCUMENT_RENEWAL_CENTERS_PATH}?includeInactive=1`, "driver")).status).toBe(403);

    expect((await call("PATCH", documentRenewalCenterActivePath(id), "secretary", { isActive: true })).status).toBe(200);
    expect(await inChoices()).toBe(true);
    expect((await call("PATCH", documentRenewalCenterActivePath(999999999), "admin", { isActive: false })).status).toBe(404);
  });

  it("une demande vers un centre désactivé est refusée (409), par id comme par nom ; les demandes existantes gardent leur nom", async () => {
    const name = `TEST garde ${SUFFIX}`;
    const created = await createCenter(name, "assurance");
    const id = created.body.id;
    const requestBody = { vehicleId, vehicleDocumentId, comment: "Renouvellement test", centerId: id };

    const ok = await call("POST", "/api/document-renewals/requests", "secretary", requestBody);
    expect(ok.status).toBe(201);
    const requestId = ok.body.requestId ?? ok.body.request?.id ?? ok.body.id;
    expect(requestId).toBeTruthy();
    await db.update(documentRenewalRequests).set({ status: "rejected" }).where(eq(documentRenewalRequests.id, requestId));

    expect((await call("PATCH", documentRenewalCenterActivePath(id), "secretary", { isActive: false })).status).toBe(200);

    const refusedById = await call("POST", "/api/document-renewals/requests", "secretary", requestBody);
    expect(refusedById.status).toBe(409);
    const refusedByName = await call("POST", "/api/document-renewals/requests", "secretary", {
      vehicleId,
      vehicleDocumentId,
      comment: "Renouvellement test",
      centerName: name,
    });
    expect(refusedByName.status).toBe(409);

    const [kept] = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.id, requestId));
    expect(kept.centerId).toBe(id);
    expect(kept.centerNameSnapshot).toBe(name);

    expect((await call("PATCH", documentRenewalCenterActivePath(id), "secretary", { isActive: true })).status).toBe(200);
    const rejected = await db.select().from(documentRenewalRequests).where(eq(documentRenewalRequests.id, requestId));
    expect(rejected[0].centerNameSnapshot).toBe(name);
  });
});
