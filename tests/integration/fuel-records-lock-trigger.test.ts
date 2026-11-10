import { readFileSync } from "node:fs";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "../../server/db";
import { FUEL_RECORDS_VALIDATED_LOCK_SQL } from "../../server/init-database";
import { withMoneyOverride } from "../../server/lib/money-override";
import { isCheckViolation, moneyLockMessageOf, pgConstraintOf } from "../../server/lib/pg-errors";
import { fuelRecords, missions } from "../../shared/schema";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Filet en base du verrou d'argent sur les pleins (lot V1, PR3) : un plein validé ne se modifie
 * plus et ne se supprime plus, quel que soit l'appelant (route, script, SQL direct). Seules
 * passent la liste blanche (updated_at, updated_by, mission_id vers NULL, annulation tracée une
 * fois) et la levée explicite par transaction (withMoneyOverride).
 * La traduction HTTP (409 lisible) est couverte par tests/unit/server/money-lock-error.test.ts.
 */
const MIGRATION = "server/db/migrations/20261110_money_lock_fuel.sql";
const CONSTRAINT = "fuel_records_validated_locked";
const ids = createIdBag();
const missionIds: number[] = [];
let vehicleId = 0;
let userId = 0;

async function makeRecord(values: Partial<typeof fuelRecords.$inferInsert> = {}) {
  const [row] = await db
    .insert(fuelRecords)
    .values({
      vehicleId,
      date: "2026-01-15",
      quantity: 40,
      cost: "33000.00",
      creditAmount: "0",
      debitAmount: "33000.00",
      stationName: "TEST-Station",
      notes: uniqueTestToken("lock"),
      validationStatus: "validated",
      ...values,
    })
    .returning();
  ids.fuelRecordIds.push(row.id);
  return row;
}

async function makeMission() {
  const [mission] = await db
    .insert(missions)
    .values({ orderNumber: uniqueTestToken("LOCK"), pickupAddress: "TEST A", deliveryAddress: "TEST B" })
    .returning();
  missionIds.push(mission.id);
  return mission;
}

const recordRow = async (id: number) => (await db.select().from(fuelRecords).where(eq(fuelRecords.id, id)))[0];
const missionRow = async (id: number) => (await db.select().from(missions).where(eq(missions.id, id)))[0];

/** L'appel est refusé par le trigger : 23514, contrainte nommée, message lisible côté serveur. */
async function expectLocked(run: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught, "écriture acceptée alors qu'elle devait être refusée").toBeDefined();
  expect(isCheckViolation(caught)).toBe(true);
  expect(pgConstraintOf(caught)).toBe(CONSTRAINT);
  expect(moneyLockMessageOf(caught)).toBeTruthy();
}

async function triggerState() {
  const res = await db.execute(sql`
    SELECT md5(pg_get_functiondef('fn_fuel_records_validated_lock()'::regprocedure)) AS fn,
           (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'fuel_records'::regclass AND tgname = 'trg_fuel_records_validated_lock')::int AS n,
           (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'fuel_records'::regclass AND tgname = 'trg_fuel_records_validated_lock') AS def,
           (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'fuel_records'::regclass AND tgname = 'trg_fuel_records_truncate_lock')::int AS nt,
           (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'fuel_records'::regclass AND tgname = 'trg_fuel_records_truncate_lock') AS deft`);
  return ((res as unknown as { rows: unknown[] }).rows ?? res)[0] as { fn: string; n: number; def: string; nt: number; deft: string | null };
}

beforeAll(async () => {
  await db.execute(sql.raw(FUEL_RECORDS_VALIDATED_LOCK_SQL));
  const user = await createTestUser({ role: "admin" });
  ids.userIds.push(user.id);
  userId = user.id;
  const vehicle = await createTestVehicle();
  ids.vehicleIds.push(vehicle.id);
  vehicleId = vehicle.id;
}, 120_000);

afterAll(async () => {
  await cleanupCreated(ids);
  if (missionIds.length) await db.delete(missions).where(inArray(missions.id, missionIds));
}, 120_000);

describe("trigger fuel_records_validated_locked", { timeout: 60_000 }, () => {
  it("plein validé : modifier un montant ou une quantité est refusé", async () => {
    const record = await makeRecord();
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET cost = 1 WHERE id = ${record.id}`));
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET quantity = 1 WHERE id = ${record.id}`));
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET debit_amount = 1 WHERE id = ${record.id}`));
    await expectLocked(() => db.update(fuelRecords).set({ notes: "retouche" }).where(eq(fuelRecords.id, record.id)));
    const after = await recordRow(record.id);
    expect(after.cost).toBe("33000.00");
    expect(after.quantity).toBe(40);
  });

  it("plein validé : la suppression physique est refusée", async () => {
    const record = await makeRecord();
    await expectLocked(() => db.execute(sql`DELETE FROM fuel_records WHERE id = ${record.id}`));
    expect(await recordRow(record.id)).toBeDefined();
  });

  it("plein en attente : modification et suppression libres", async () => {
    const record = await makeRecord({ validationStatus: "pending" });
    await db.execute(sql`UPDATE fuel_records SET cost = 1, quantity = 2, debit_amount = 1 WHERE id = ${record.id}`);
    expect((await recordRow(record.id)).cost).toBe("1.00");
    await db.execute(sql`DELETE FROM fuel_records WHERE id = ${record.id}`);
    expect(await recordRow(record.id)).toBeUndefined();
  });

  it("validation pending -> validated permise ; retour validated -> pending refusé", async () => {
    const record = await makeRecord({ validationStatus: "pending" });
    // Même écriture que fuel-voucher-service.ts (statut, auteur, date).
    await db
      .update(fuelRecords)
      .set({ validationStatus: "validated", validatedBy: userId, validatedAt: new Date() })
      .where(eq(fuelRecords.id, record.id));
    expect((await recordRow(record.id)).validationStatus).toBe("validated");
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET validation_status = 'pending' WHERE id = ${record.id}`));
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET validated_by = NULL WHERE id = ${record.id}`));
  });

  it("updated_at et updated_by restent libres", async () => {
    const record = await makeRecord();
    await db.execute(sql`UPDATE fuel_records SET updated_at = now(), updated_by = ${userId} WHERE id = ${record.id}`);
    expect((await recordRow(record.id)).updatedBy).toBe(userId);
  });

  it("annulation tracée : passe une fois, puis plus rien ne bouge", async () => {
    const record = await makeRecord();
    // Mêmes colonnes que FuelService.cancelFuelRecord.
    await db
      .update(fuelRecords)
      .set({ deletedAt: new Date(), deletedBy: userId, cancellationReason: "Plein saisi deux fois", updatedBy: userId, updatedAt: new Date() })
      .where(eq(fuelRecords.id, record.id));
    expect((await recordRow(record.id)).cancellationReason).toBe("Plein saisi deux fois");
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET cancellation_reason = 'autre motif' WHERE id = ${record.id}`));
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET deleted_at = NULL, deleted_by = NULL, cancellation_reason = NULL WHERE id = ${record.id}`));
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET deleted_at = now() WHERE id = ${record.id}`));
  });

  it("annulation : motif absent, vide ou de 501 caractères refusé", async () => {
    const record = await makeRecord();
    const cancel = (reason: string | null) =>
      db.execute(sql`UPDATE fuel_records SET deleted_at = now(), deleted_by = ${userId}, cancellation_reason = ${reason} WHERE id = ${record.id}`);
    await expectLocked(() => cancel(null));
    await expectLocked(() => cancel("   "));
    await expectLocked(() => cancel("x".repeat(501)));
    await cancel("x".repeat(500));
    expect((await recordRow(record.id)).deletedAt).not.toBeNull();
  });

  it("mission_id : vers NULL seulement par la clé étrangère (suppression de la mission), jamais en direct", async () => {
    const [m1, m2] = [await makeMission(), await makeMission()];
    const record = await makeRecord({ missionId: m1.id });
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET mission_id = ${m2.id} WHERE id = ${record.id}`));
    // Détacher en direct sortirait le plein du budget de la mission sans annulation tracée.
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET mission_id = NULL WHERE id = ${record.id}`));
    expect((await recordRow(record.id)).missionId).toBe(m1.id);
    // ON DELETE SET NULL de la clé étrangère : la mission part, le plein reste, validé.
    await db.delete(missions).where(eq(missions.id, m1.id));
    const after = await recordRow(record.id);
    expect(after.missionId).toBeNull();
    expect(after.validationStatus).toBe("validated");
    await expectLocked(() => db.execute(sql`UPDATE fuel_records SET mission_id = ${m2.id} WHERE id = ${record.id}`));
  });

  it("withMoneyOverride lève le verrou pour sa seule transaction", async () => {
    const record = await makeRecord();
    await db.transaction(async (tx) => {
      await withMoneyOverride(tx, "test du verrou de plein");
      await tx.execute(sql`UPDATE fuel_records SET cost = 12345 WHERE id = ${record.id}`);
    });
    expect((await recordRow(record.id)).cost).toBe("12345.00");
    // Après le COMMIT, la levée a disparu : une nouvelle transaction est de nouveau refusée.
    await expectLocked(() =>
      db.transaction(async (tx) => {
        await tx.execute(sql`UPDATE fuel_records SET cost = 1 WHERE id = ${record.id}`);
      }),
    );
    // Même chose sur la connexion qui a porté la levée : set_config(..., true) est borné à la transaction.
    await expectLocked(() =>
      db.transaction(async (tx) => {
        await withMoneyOverride(tx, "test du verrou de plein");
        await tx.execute(sql`COMMIT`);
        await tx.execute(sql`BEGIN`);
        await tx.execute(sql`UPDATE fuel_records SET cost = 2 WHERE id = ${record.id}`);
      }),
    );
    expect((await recordRow(record.id)).cost).toBe("12345.00");
  });

  it("TRUNCATE refusé ; permis sous withMoneyOverride (transaction annulée ensuite)", async () => {
    await makeRecord();
    // Deux clés étrangères visent fuel_records : un TRUNCATE nu est déjà refusé par Postgres, la voie
    // ouverte est CASCADE. Chaque essai tourne dans une transaction toujours annulée : la base partagée
    // n'est jamais vidée, même si le trigger manque.
    const ROLLBACK = new Error("annulation volontaire du test");
    const truncateThenRollback = (override: boolean) =>
      db.transaction(async (tx) => {
        if (override) await withMoneyOverride(tx, "test du verrou de plein");
        await tx.execute(sql`TRUNCATE fuel_records CASCADE`);
        const [{ n }] = (await tx.execute(sql`SELECT count(*)::int AS n FROM fuel_records`)).rows as { n: number }[];
        expect(n).toBe(0);
        throw ROLLBACK;
      });
    await expectLocked(() => truncateThenRollback(false));
    await expect(truncateThenRollback(true)).rejects.toBe(ROLLBACK);
    expect(ids.fuelRecordIds.length).toBeGreaterThan(0);
    expect(await recordRow(ids.fuelRecordIds[ids.fuelRecordIds.length - 1])).toBeDefined();
  });

  it("verrou de table indisponible : la migration attend 5 s au plus, puis renonce sans erreur", async () => {
    const before = await triggerState();
    const holder = await pool.connect();
    let outcome = "";
    let migration: Promise<unknown> = Promise.resolve();
    try {
      // ROW EXCLUSIVE (une écriture en cours) bloque CREATE TRIGGER (SHARE ROW EXCLUSIVE).
      await holder.query("BEGIN");
      await holder.query("LOCK TABLE fuel_records IN ROW EXCLUSIVE MODE");
      migration = pool.query(readFileSync(MIGRATION, "utf8"));
      outcome = await Promise.race([
        migration.then(() => "terminée", () => "en erreur"),
        new Promise<string>((resolve) => setTimeout(() => resolve("bloquée"), 15_000)),
      ]);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await migration.catch(() => undefined);
    }
    expect(outcome).toBe("terminée");
    expect(await triggerState()).toEqual(before);
  });

  it("non-régression : le trigger AFTER de mission recalcule toujours le réel carburant", async () => {
    const mission = await makeMission();
    const record = await makeRecord({ missionId: mission.id, debitAmount: "3000.00", quantity: 4 });
    const before = await missionRow(mission.id);
    expect(Number(before.actualFuelCost)).toBe(3000);
    expect(Number(before.actualFuelQuantity)).toBe(4);
    await db
      .update(fuelRecords)
      .set({ deletedAt: new Date(), deletedBy: userId, cancellationReason: "Erreur de saisie" })
      .where(eq(fuelRecords.id, record.id));
    const after = await missionRow(mission.id);
    expect(Number(after.actualFuelCost)).toBe(0);
    expect(Number(after.actualFuelQuantity)).toBe(0);
  });

  it("idempotent : migration et SQL d'init rejoués deux fois, même définition, un seul trigger, aucune donnée touchée", async () => {
    const migration = readFileSync(MIGRATION, "utf8");
    const countBefore = await db.execute(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE validation_status = 'validated')::int AS v FROM fuel_records`);
    const first = await triggerState();
    expect(first.n).toBe(1);
    expect(first.def).toMatch(/BEFORE DELETE OR UPDATE ON public\.fuel_records FOR EACH ROW/);
    expect(first.nt).toBe(1);
    expect(first.deft).toMatch(/BEFORE TRUNCATE ON public\.fuel_records FOR EACH STATEMENT/);
    for (let i = 0; i < 2; i++) {
      await db.execute(sql.raw(migration));
      await db.execute(sql.raw(FUEL_RECORDS_VALIDATED_LOCK_SQL));
    }
    expect(await triggerState()).toEqual(first);
    const countAfter = await db.execute(sql`SELECT count(*)::int AS n, count(*) FILTER (WHERE validation_status = 'validated')::int AS v FROM fuel_records`);
    expect(countAfter.rows).toEqual(countBefore.rows);
  });
});
