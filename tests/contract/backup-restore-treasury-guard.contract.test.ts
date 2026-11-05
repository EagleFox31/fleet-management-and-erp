import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  assertRestoreKeepsTreasuryConsistent,
  RESTORE_TREASURY_CONFLICT_MESSAGE,
} from "../../server/services/backup-import-service";
import { fuelRecords, treasuryAccounts, treasuryEntries, vehicles } from "../../shared/schema";
import { startContractSession } from "../support/contract-session";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * La sauvegarde ne contient pas la trésorerie : restaurer effacerait les pleins sous leurs écritures.
 * Drapeau finance actif et écriture liée à un plein : 409 avant toute écriture. Drapeau coupé : le
 * contrôle laisse passer, la restauration reste celle d'avant. La restauration réelle n'est appelée
 * que lorsque le refus est d'abord prouvé : sinon elle viderait la base partagée.
 */

type Actor = "admin";
let session: Awaited<ReturnType<typeof startContractSession<Actor>>>;
let vehicleId = 0;
let fuelId = 0;

async function withFlags<T>(flags: string, fn: () => Promise<T>): Promise<T> {
  const before = process.env.FEATURE_FLAGS;
  process.env.FEATURE_FLAGS = flags;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.FEATURE_FLAGS;
    else process.env.FEATURE_FLAGS = before;
  }
}

beforeAll(async () => {
  session = await startContractSession<Actor>({ admin: "admin" });
  const adminId = session.userId("admin");
  const vehicle = await createTestVehicle();
  vehicleId = vehicle.id;
  session.ids.vehicleIds.push(vehicle.id);
  const [fuel] = await db
    .insert(fuelRecords)
    .values({ vehicleId: vehicle.id, date: "2037-03-04", quantity: 10, stationName: uniqueTestToken("restore") })
    .returning();
  fuelId = fuel.id;
  session.ids.fuelRecordIds.push(fuel.id);
  const [account] = await db
    .insert(treasuryAccounts)
    .values({ code: uniqueTestToken("RST"), label: "Compte restauration", kind: "bank", createdBy: adminId, updatedBy: adminId })
    .returning();
  await db.insert(treasuryEntries).values({
    accountId: account.id,
    entryDate: "2037-03-04",
    label: "Plein lié",
    direction: "out",
    amount: "8000",
    category: "carburant",
    fuelRecordId: fuel.id,
    createdBy: adminId,
    updatedBy: adminId,
  });
}, 180000);

afterAll(async () => {
  await session?.stop();
});

describe("restauration de sauvegarde et trésorerie", () => {
  it("drapeau finance actif, plein écrit au journal : 409 lisible, rien n'est effacé", async () => {
    await withFlags("finance=on", async () => {
      // Le refus est prouvé avant l'appel HTTP : sans lui, la restauration viderait la base partagée.
      await expect(assertRestoreKeepsTreasuryConsistent(db)).rejects.toMatchObject({ status: 409 });

      const res = await session.call("POST", "/api/admin/import-backup", { actor: "admin" });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(RESTORE_TREASURY_CONFLICT_MESSAGE);
    });
    expect(await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, vehicleId))).toHaveLength(1);
    expect(await db.select({ id: fuelRecords.id }).from(fuelRecords).where(eq(fuelRecords.id, fuelId))).toHaveLength(1);
    const [entry] = await db.select().from(treasuryEntries).where(eq(treasuryEntries.fuelRecordId, fuelId));
    expect(entry?.fuelRecordId).toBe(fuelId);
  });

  it("drapeau finance coupé : le contrôle laisse passer, la restauration est inchangée", async () => {
    await withFlags("finance=off", async () => {
      await expect(assertRestoreKeepsTreasuryConsistent(db)).resolves.toBeUndefined();
    });
  });
});
