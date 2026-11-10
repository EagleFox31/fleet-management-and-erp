import { eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TREASURY_BASE_PATH } from "../../shared/contracts/treasury";
import { db } from "../../server/db";
import { fuelRecords, treasuryAccounts, treasuryEntries } from "../../shared/schema";
import { linkFuelConsumption } from "../../server/services/treasury-links";
import {
  FUEL_RECORD_VALIDATED_DELETE_MESSAGE,
  FUEL_RECORD_VALIDATED_EDIT_MESSAGE,
} from "../../shared/constants/fuel-record-cancel";
import { leakText } from "../support/api-error";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestFuelRecord, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";
import { deleteFuelRecordsWhere } from "../support/money-override";

/**
 * Plein validé immuable (lot V1, PR2) :
 *  - PATCH (route réelle de routes.ts) et DELETE d'un plein validé : 409 lisible, rien d'écrit ;
 *  - POST /api/fuel-records/:id/cancel : suppression douce tracée avec motif, contre-passation en
 *    trésorerie, rejeu du même motif = 200 sans nouvelle écriture ;
 *  - plein en attente : PATCH et DELETE restent possibles (non-régression).
 */

// Trésorerie coupée par défaut : sans ce drapeau, aucune ligne de contre-passation n'existe.
process.env.FEATURE_FLAGS = "finance=on";

const ACTORS = {
  admin: "admin",
  logistics: "logistics",
  workshop_manager: "workshop_manager",
  technician: "technician",
} as const;
type Actor = keyof typeof ACTORS;

const ids = createIdBag();
const ownedAccountIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;
const suffix = uniqueTestToken("fc").slice(-8);
const TECHNICAL = /SQLSTATE|violates|constraint|at \S+:\d+|select |update |ZodError|invalid_type/i;

async function record(over: { validated: boolean; debit?: string }) {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  const debit = over.debit ?? "0";
  const row = await createTestFuelRecord({
    vehicleId: v.id,
    debitAmount: debit,
    creditAmount: "0",
    cost: debit === "0" ? "500.00" : debit,
    quantity: 2,
  });
  ids.fuelRecordIds.push(row.id);
  if (over.validated) await db.update(fuelRecords).set({ validationStatus: "validated" }).where(eq(fuelRecords.id, row.id));
  return row;
}

const rowOf = async (id: number) => (await db.select().from(fuelRecords).where(eq(fuelRecords.id, id)))[0];
const linesOf = (id: number) => db.select().from(treasuryEntries).where(eq(treasuryEntries.fuelRecordId, id));
const patch = (id: number, actor: Actor, body: unknown) => session.call("PATCH", `/api/fuel-records/${id}`, { actor, body });
const del = (id: number, actor: Actor) => session.call("DELETE", `/api/fuel-records/${id}`, { actor });
const cancel = (id: number, actor: Actor, body: unknown) => session.call("POST", `/api/fuel-records/${id}/cancel`, { actor, body });

beforeAll(async () => {
  session = await startContractActors<Actor>(ACTORS, ids.userIds);
  // Un seul compte carte actif en base : on le crée, ou on reprend celui qui existe (sans le posséder).
  const created = await session.call("POST", `${TREASURY_BASE_PATH}/accounts`, {
    actor: "admin",
    body: { code: `FC${suffix}`, label: "Compte carte TEST", kind: "fuel_card", openingBalance: "0" },
  });
  if (created.status === 201) ownedAccountIds.push(created.body.id);
}, 120000);

afterAll(async () => {
  const conditions = [
    ids.fuelRecordIds.length ? inArray(treasuryEntries.fuelRecordId, ids.fuelRecordIds) : undefined,
    ownedAccountIds.length ? inArray(treasuryEntries.accountId, ownedAccountIds) : undefined,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (conditions.length) await db.delete(treasuryEntries).where(or(...conditions));
  if (ids.vehicleIds.length) await deleteFuelRecordsWhere(inArray(fuelRecords.vehicleId, ids.vehicleIds));
  await cleanupCreated(ids);
  if (ownedAccountIds.length) await db.delete(treasuryAccounts).where(inArray(treasuryAccounts.id, ownedAccountIds));
  await session?.close();
}, 120000);

describe("plein validé : PATCH et DELETE refusés en 409", { timeout: 120000 }, () => {
  it("PATCH (route de routes.ts) : 409 lisible, ligne intacte", async () => {
    const r = await record({ validated: true });
    const res = await patch(r.id, "admin", { notes: "correction tardive" });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(FUEL_RECORD_VALIDATED_EDIT_MESSAGE);
    expect(leakText(res.body)).not.toMatch(TECHNICAL);
    expect((await rowOf(r.id)).notes).toBe(r.notes);
  });

  it("DELETE d'un plein physique validé : 409, ligne conservée", async () => {
    const r = await record({ validated: true });
    const res = await del(r.id, "workshop_manager");
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(FUEL_RECORD_VALIDATED_DELETE_MESSAGE);
    expect(leakText(res.body)).not.toMatch(TECHNICAL);
    expect(await rowOf(r.id)).toBeDefined();
  });

  it("DELETE d'un plein validé qui a mouvementé la carte : 409, pas de suppression douce", async () => {
    const r = await record({ validated: true, debit: "1234.00" });
    const res = await del(r.id, "logistics");
    expect(res.status).toBe(409);
    expect(res.body.message).toBe(FUEL_RECORD_VALIDATED_DELETE_MESSAGE);
    expect((await rowOf(r.id)).deletedAt).toBeNull();
  });
});

describe("plein en attente : non-régression", { timeout: 120000 }, () => {
  it("PATCH reste possible", async () => {
    const r = await record({ validated: false });
    const res = await patch(r.id, "admin", { notes: "corrigé" });
    expect(res.status).toBe(200);
    expect((await rowOf(r.id)).notes).toBe("corrigé");
  });

  it("DELETE reste possible (plein physique)", async () => {
    const r = await record({ validated: false });
    const res = await del(r.id, "workshop_manager");
    expect(res.status).toBe(204);
    expect(await rowOf(r.id)).toBeUndefined();
  });

  it("le PATCH n'écrit pas cancellation_reason", async () => {
    const r = await record({ validated: false });
    const res = await patch(r.id, "admin", { notes: "x", cancellationReason: "forgé" });
    expect(res.status).toBe(200);
    expect((await rowOf(r.id)).cancellationReason).toBeNull();
  });
});

describe("POST /api/fuel-records/:id/cancel", { timeout: 120000 }, () => {
  it("annule, trace le motif, contre-passe en trésorerie ; le rejeu répond 200 sans rien réécrire", async () => {
    const r = await record({ validated: true, debit: "1500.00" });
    const stored = await rowOf(r.id);
    await db.transaction((tx) => linkFuelConsumption(tx as never, stored, session.userIdOf("admin")));
    expect(await linesOf(r.id)).toHaveLength(1);

    const res = await cancel(r.id, "logistics", { reason: "  Doublon de saisie  " });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(r.id);
    const row = await rowOf(r.id);
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.deletedBy).toBe(session.userIdOf("logistics"));
    expect(row.cancellationReason).toBe("Doublon de saisie");
    const lines = await linesOf(r.id);
    expect(lines.map((l) => l.requestKey).sort()).toEqual([`fuel:${r.id}`, `fuel:${r.id}:reverse`].sort());

    const again = await cancel(r.id, "logistics", { reason: "Doublon de saisie" });
    expect(again.status).toBe(200);
    expect((await rowOf(r.id)).deletedAt?.getTime()).toBe(row.deletedAt?.getTime());
    expect(await linesOf(r.id)).toHaveLength(2);
  });

  it("motif différent sur un plein déjà annulé : 409", async () => {
    const r = await record({ validated: true, debit: "100.00" });
    expect((await cancel(r.id, "admin", { reason: "Erreur de montant" })).status).toBe(200);
    const res = await cancel(r.id, "admin", { reason: "Autre motif" });
    expect(res.status).toBe(409);
    expect(leakText(res.body)).not.toMatch(TECHNICAL);
  });

  it.each([{}, { reason: "" }, { reason: "ab" }, { reason: "   " }])("motif %j : 400, plein intact", async (body) => {
    const r = await record({ validated: true, debit: "100.00" });
    const res = await cancel(r.id, "admin", body);
    expect(res.status).toBe(400);
    expect(leakText(res.body)).not.toMatch(TECHNICAL);
    expect((await rowOf(r.id)).deletedAt).toBeNull();
  });

  it("technicien : 403 ; chef d'atelier sur un plein qui a mouvementé la carte : 403, plein intact", async () => {
    const r = await record({ validated: true, debit: "100.00" });
    expect((await cancel(r.id, "technician", { reason: "Motif valable" })).status).toBe(403);
    const res = await cancel(r.id, "workshop_manager", { reason: "Motif valable" });
    expect(res.status).toBe(403);
    expect(leakText(res.body)).not.toMatch(TECHNICAL);
    const row = await rowOf(r.id);
    expect(row.deletedAt).toBeNull();
    expect(row.cancellationReason).toBeNull();
  });

  it("plein physique validé : le chef d'atelier peut l'annuler", async () => {
    const r = await record({ validated: true });
    expect((await cancel(r.id, "workshop_manager", { reason: "Saisi sur le mauvais camion" })).status).toBe(200);
  });

  it("plein en attente : 409 (il se supprime) ; plein absent : 404", async () => {
    const r = await record({ validated: false });
    expect((await cancel(r.id, "admin", { reason: "Motif valable" })).status).toBe(409);
    expect((await cancel(2147483000, "admin", { reason: "Motif valable" })).status).toBe(404);
  });
});
