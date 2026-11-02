import { afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../server/db";
import { fuelAnomalyResolutions, fuelRecords, vehicles } from "../../shared/schema";
import {
  fuelAnomalyResolutionService as svc,
  TANK_OVERFLOW_TOLERANCE_PERCENT,
  toleranceSqlLiteral,
} from "../../server/services/fuel-anomaly-resolution-service";
import { storage } from "../../server/storage";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestUser, createTestVehicle } from "../support/factories";

/**
 * FUEL3 : règles `tank-overflow` et `odometer-regression`, limites exactes.
 * Dates en 2090 : la liste est triée par date décroissante et plafonnée à 500, les lignes de
 * ces tests sont donc toujours en tête, quelles que soient les données de la base.
 */
const ids = createIdBag();
const keys: string[] = [];

afterEach(async () => {
  if (keys.length) await db.delete(fuelAnomalyResolutions).where(inArray(fuelAnomalyResolutions.anomalyKey, keys));
  keys.length = 0;
  await cleanupCreated(ids);
  ids.userIds.length = 0;
  ids.vehicleIds.length = 0;
  ids.fuelRecordIds.length = 0;
});

async function vehicle(tankCapacityL: number | null = null) {
  const v = await createTestVehicle();
  ids.vehicleIds.push(v.id);
  if (tankCapacityL !== null) await db.update(vehicles).set({ tankCapacityL }).where(eq(vehicles.id, v.id));
  return v;
}

async function fill(v: { id: number } | null, o: { date?: string | null; quantity?: number; mileage?: number | null; fuelType?: "diesel" | "electric"; fullTank?: boolean }) {
  const [row] = await db
    .insert(fuelRecords)
    .values({
      vehicleId: v?.id,
      date: o.date === undefined ? "2090-01-01" : o.date,
      quantity: o.quantity ?? 50,
      mileage: o.mileage === undefined ? null : o.mileage,
      fuelType: o.fuelType ?? "diesel",
      fullTank: o.fullTank ?? true,
    })
    .returning();
  ids.fuelRecordIds.push(row.id);
  return row;
}

async function anomaliesOf(vehicleId: number, rule: "tank-overflow" | "odometer-regression") {
  return (await svc.list()).filter((a) => a.vehicleId === vehicleId && a.rule === rule);
}

describe("règle tank-overflow", () => {
  it("la tolérance est de 5 % (constante réglable)", () => {
    expect(TANK_OVERFLOW_TOLERANCE_PERCENT).toBe(5);
  });

  it("égal à la capacité, égal à la tolérance : rien ; juste au-dessus : anomalie", async () => {
    const v = await vehicle(100);
    const equalCapacity = await fill(v, { quantity: 100, date: "2090-01-01" });
    const equalTolerance = await fill(v, { quantity: 105, date: "2090-01-02" });
    const above = await fill(v, { quantity: 105.5, date: "2090-01-03" });
    const found = await anomaliesOf(v.id, "tank-overflow");
    expect(found.map((a) => a.fuelRecordId)).toEqual([above.id]);
    expect(found[0]).toMatchObject({
      anomalyKey: `tank-overflow:${above.id}`,
      rule: "tank-overflow",
      quantity: 105.5,
      averageQuantity: 100,
      threshold: 105,
      tankCapacityL: 100,
      status: "open",
    });
    expect([equalCapacity.id, equalTolerance.id]).not.toContain(found[0].fuelRecordId);
  }, 30_000);

  it("tolérance décimale : littéral SQL sans troncature, valeur invalide refusée", () => {
    expect(toleranceSqlLiteral(5)).toBe("5");
    expect(toleranceSqlLiteral(2.5)).toBe("2.5");
    expect(() => toleranceSqlLiteral(Number.NaN)).toThrow();
    expect(() => toleranceSqlLiteral(-1)).toThrow();
  });

  it("muette sans capacité renseignée", async () => {
    const v = await vehicle(null);
    await fill(v, { quantity: 9999 });
    expect(await anomaliesOf(v.id, "tank-overflow")).toEqual([]);
  }, 30_000);

  it("ignore un plein électrique et un plein sans véhicule", async () => {
    const v = await vehicle(100);
    await fill(v, { quantity: 500, fuelType: "electric" });
    const orphan = await fill(null, { quantity: 500 });
    expect(await anomaliesOf(v.id, "tank-overflow")).toEqual([]);
    expect((await svc.list()).some((a) => a.fuelRecordId === orphan.id)).toBe(false);
  }, 30_000);

  it("un plein partiel est jugé sur la quantité servie, comme les pleins complets", async () => {
    const v = await vehicle(100);
    const partial = await fill(v, { quantity: 120, fullTank: false });
    expect((await anomaliesOf(v.id, "tank-overflow")).map((a) => a.fuelRecordId)).toEqual([partial.id]);
  }, 30_000);
});

describe("règle odometer-regression", () => {
  it("kilométrage égal : rien ; plus bas que le plein précédent : anomalie", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-01-01", mileage: 1000 });
    await fill(v, { date: "2090-01-02", mileage: 1000 });
    const lower = await fill(v, { date: "2090-01-03", mileage: 999 });
    const found = await anomaliesOf(v.id, "odometer-regression");
    expect(found.map((a) => a.fuelRecordId)).toEqual([lower.id]);
    expect(found[0]).toMatchObject({
      anomalyKey: `odometer-regression:${lower.id}`,
      mileage: 999,
      previousMileage: 1000,
      averageQuantity: 1000,
      threshold: 1000,
      status: "open",
    });
  }, 30_000);

  it("premier plein d'un véhicule : jamais d'anomalie", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-01-01", mileage: 10 });
    expect(await anomaliesOf(v.id, "odometer-regression")).toEqual([]);
  }, 30_000);

  it("kilométrage nul ou 0 = absent : ni anomalie, ni référence ; le précédent est le dernier connu", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-02-01", mileage: 5000 });
    await fill(v, { date: "2090-02-02", mileage: 0 });
    await fill(v, { date: "2090-02-03", mileage: null });
    const regressed = await fill(v, { date: "2090-02-04", mileage: 4999 });
    const found = await anomaliesOf(v.id, "odometer-regression");
    expect(found.map((a) => a.fuelRecordId)).toEqual([regressed.id]);
    expect(found[0].previousMileage).toBe(5000);
  }, 30_000);

  it("saisie hors ordre : l'ordre est celui de la date, pas de la saisie", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-03-03", mileage: 300 });
    await fill(v, { date: "2090-03-01", mileage: 100 });
    const middle = await fill(v, { date: "2090-03-02", mileage: 50 });
    const found = await anomaliesOf(v.id, "odometer-regression");
    expect(found.map((a) => a.fuelRecordId)).toEqual([middle.id]);
    expect(found[0].previousMileage).toBe(100);
  }, 30_000);

  it("même date : départage par id", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-04-01", mileage: 200 });
    const second = await fill(v, { date: "2090-04-01", mileage: 150 });
    expect((await anomaliesOf(v.id, "odometer-regression")).map((a) => a.fuelRecordId)).toEqual([second.id]);
  }, 30_000);

  it("compare au plein précédent, pas au maximum historique", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-05-01", mileage: 900 });
    const dropped = await fill(v, { date: "2090-05-02", mileage: 100 });
    await fill(v, { date: "2090-05-03", mileage: 150 });
    expect((await anomaliesOf(v.id, "odometer-regression")).map((a) => a.fuelRecordId)).toEqual([dropped.id]);
  }, 30_000);

  it("pic isolé : le plein fautif est le pic, pas le plein suivant qui retrouve la série", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-08-01", mileage: 1000 });
    const spike = await fill(v, { date: "2090-08-02", mileage: 99999 });
    await fill(v, { date: "2090-08-03", mileage: 1100 });
    await fill(v, { date: "2090-08-04", mileage: 1200 });
    const found = await anomaliesOf(v.id, "odometer-regression");
    expect(found.map((a) => a.fuelRecordId)).toEqual([spike.id]);
    expect(found[0]).toMatchObject({
      anomalyKey: `odometer-regression:${spike.id}`,
      date: "2090-08-02",
      mileage: 99999,
      previousMileage: 1000,
      nextMileage: 1100,
      averageQuantity: 1000,
      threshold: 1100,
    });
  }, 30_000);

  it("chute sous la série d'avant : le plein courant reste le fautif, sans nextMileage", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-09-01", mileage: 1000 });
    await fill(v, { date: "2090-09-02", mileage: 2000 });
    const dropped = await fill(v, { date: "2090-09-03", mileage: 500 });
    const found = await anomaliesOf(v.id, "odometer-regression");
    expect(found.map((a) => a.fuelRecordId)).toEqual([dropped.id]);
    expect(found[0].previousMileage).toBe(2000);
    expect(found[0]).not.toHaveProperty("nextMileage");
  }, 30_000);

  it("ignore un plein électrique et un plein sans véhicule ; les véhicules ne se mélangent pas", async () => {
    const v = await vehicle();
    const other = await vehicle();
    await fill(v, { date: "2090-06-01", mileage: 1000 });
    await fill(v, { date: "2090-06-02", mileage: 10, fuelType: "electric" });
    const orphan = await fill(null, { date: "2090-06-03", mileage: 1 });
    await fill(other, { date: "2090-06-04", mileage: 5 });
    expect(await anomaliesOf(v.id, "odometer-regression")).toEqual([]);
    expect(await anomaliesOf(other.id, "odometer-regression")).toEqual([]);
    expect((await svc.list()).some((a) => a.fuelRecordId === orphan.id)).toBe(false);
  }, 30_000);

  it("plein sans date : exclu de la comparaison", async () => {
    const v = await vehicle();
    await fill(v, { date: "2090-07-01", mileage: 1000 });
    await fill(v, { date: null, mileage: 10 });
    expect(await anomaliesOf(v.id, "odometer-regression")).toEqual([]);
  }, 30_000);
});

describe("traitement des nouvelles règles", () => {
  it("la décision existante s'applique à la clé <règle>:<id de plein>", async () => {
    const user = await createTestUser();
    ids.userIds.push(user.id);
    const v = await vehicle(100);
    const over = await fill(v, { quantity: 200 });
    const key = `tank-overflow:${over.id}`;
    keys.push(key);
    await svc.resolve(key, { status: "justified", comment: "Deux réservoirs" }, user.id);
    const [a] = await anomaliesOf(v.id, "tank-overflow");
    expect(a).toMatchObject({ anomalyKey: key, status: "justified", comment: "Deux réservoirs" });
  }, 30_000);
});

describe("compteur véhicules sans capacité", () => {
  it("compte les véhicules à capacité vide, hors véhicules retirés", async () => {
    const before = await svc.vehiclesWithoutTankCapacity();
    const v = await vehicle(null);
    expect(await svc.vehiclesWithoutTankCapacity()).toBe(before + 1);
    await db.update(vehicles).set({ tankCapacityL: 80 }).where(eq(vehicles.id, v.id));
    expect(await svc.vehiclesWithoutTankCapacity()).toBe(before);
    await db.update(vehicles).set({ tankCapacityL: null, deletedAt: new Date() }).where(eq(vehicles.id, v.id));
    expect(await svc.vehiclesWithoutTankCapacity()).toBe(before);
  }, 30_000);

  it("ignore les véhicules électriques (la règle tank-overflow les exclut déjà)", async () => {
    const before = await svc.vehiclesWithoutTankCapacity();
    const v = await vehicle(null);
    expect(await svc.vehiclesWithoutTankCapacity()).toBe(before + 1);
    await db.update(vehicles).set({ fuelType: "electric" }).where(eq(vehicles.id, v.id));
    expect(await svc.vehiclesWithoutTankCapacity()).toBe(before);
  }, 30_000);
});

describe("storage.updateVehicle : une contrainte CHECK remonte au lieu d'être avalée", () => {
  it("capacité 0 : l'erreur 23514 est levée (la route la traduit en 400)", async () => {
    const v = await vehicle(50);
    await expect(storage.updateVehicle(v.id, { tankCapacityL: 0 })).rejects.toMatchObject({
      code: "23514",
      constraint: "vehicles_tank_capacity_l_positive",
    });
    const [row] = await db.select({ c: vehicles.tankCapacityL }).from(vehicles).where(eq(vehicles.id, v.id));
    expect(row.c).toBe(50);
  }, 30_000);
});
