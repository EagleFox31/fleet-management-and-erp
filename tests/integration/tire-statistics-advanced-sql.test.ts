import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "../../server/db";
import { tireInspections, tireRotations, tires, vehicleTires, vehicles } from "../../shared/schema";
import { tiresService } from "../../server/services/tires-service-simplified";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { createTestVehicle } from "../support/factories";

/**
 * `GET /api/tires/statistics-advanced` en une seule requête SQL.
 *
 * Avant, `getTireStatisticsAdvanced` lançait cinq lectures en parallèle (stock, usure, pneus en
 * stock bas, inspections critiques, véhicules et rotations) : cinq connexions du pool pour une
 * page, assez pour saturer le pool en local (constat du 7 novembre 2026). Le calcul tient
 * désormais en une requête. Ce test garde une copie de l'ancien calcul (`legacyStatistics`,
 * recopié tel quel) et exige le même résultat, objets comme JSON servi.
 *
 * Différences admises :
 * - l'ancien calcul ne triait pas ses listes (ordre de lecture du tas), le nouveau les trie par id :
 *   les listes sont comparées triées ;
 * - bug corrigé : dans un select sur la seule table `vehicles`, Drizzle écrit `${vehicles.id}` sans
 *   préfixe (`"id"`). Dans la sous-requête sur `tire_rotations`, `vehicle_id = "id"` visait donc
 *   l'id de la rotation : les alertes « rotation dépassée » et « en approche » étaient fausses
 *   (vides en pratique). L'ancien calcul copié tel quel est identique hors rotations ; avec cette
 *   seule référence qualifiée, il est identique en tout.
 */

const ids = createIdBag();
const tireIds: number[] = [];
const vehicleTireIds: number[] = [];
const rotationIds: number[] = [];

/**
 * Ancien calcul, recopié de `tires-service-simplified.ts` avant le passage en une requête.
 * `rotationVehicleRef` : la référence au véhicule dans la sous-requête des rotations, telle
 * qu'écrite avant (`vehicles.id`, rendue `"id"`) ou qualifiée (`"vehicles"."id"`).
 */
async function legacyStatistics(rotationVehicleRef: SQL | typeof vehicles.id = vehicles.id) {
  const [stockStats, wearStats, lowStockTires, criticalWearInspections, vehiclesWithRotations] = await Promise.all([
    db
      .select({
        totalQuantity: sql<number>`SUM(${tires.stockQuantity})`,
        totalValue: sql<number>`SUM(${tires.stockQuantity} * ${tires.purchasePrice})`,
        totalTypes: sql<number>`COUNT(*)`,
      })
      .from(tires)
      .where(isNull(tires.deletedAt)),
    db
      .select({
        averageWear: sql<number>`AVG(${tireInspections.treadDepth})`,
        criticalWearCount: sql<number>`COUNT(CASE WHEN ${tireInspections.treadDepth} < 3.0 THEN 1 END)`,
      })
      .from(tireInspections)
      .leftJoin(vehicleTires, eq(tireInspections.vehicleTireId, vehicleTires.id))
      .where(eq(vehicleTires.status, "active")),
    db
      .select()
      .from(tires)
      .where(and(isNull(tires.deletedAt), sql`${tires.stockQuantity} <= ${tires.minStockLevel}`)),
    db
      .select({
        inspectionId: tireInspections.id,
        treadDepth: tireInspections.treadDepth,
        vehicleRegistration: vehicles.registrationNumber,
        tireBrand: tires.brand,
        tireModel: tires.model,
        position: vehicleTires.position,
      })
      .from(tireInspections)
      .leftJoin(vehicleTires, eq(tireInspections.vehicleTireId, vehicleTires.id))
      .leftJoin(vehicles, eq(vehicleTires.vehicleId, vehicles.id))
      .leftJoin(tires, eq(vehicleTires.tireId, tires.id))
      .where(and(sql`${tireInspections.treadDepth} < 3.0`, eq(vehicleTires.status, "active"))),
    db
      .select({
        vehicleId: vehicles.id,
        vehicleRegistration: vehicles.registrationNumber,
        currentMileage: vehicles.mileage,
        lastRotationMileage: sql<number>`(
          SELECT rotation_mileage FROM tire_rotations WHERE vehicle_id = ${rotationVehicleRef}
          ORDER BY rotation_date DESC LIMIT 1
        )`,
        nextRotationMileage: sql<number>`(
          SELECT next_rotation_mileage FROM tire_rotations WHERE vehicle_id = ${rotationVehicleRef}
          ORDER BY rotation_date DESC LIMIT 1
        )`,
      })
      .from(vehicles)
      .where(eq(vehicles.status, "operational")),
  ]);

  const actions = {
    lowStock: [] as any[],
    outOfStock: [] as any[],
    criticalWear: [] as any[],
    rotationDue: [] as any[],
    rotationApproaching: [] as any[],
  };
  for (const tire of lowStockTires) {
    if (tire.stockQuantity === 0) {
      actions.outOfStock.push({ type: "out_of_stock", message: `Stock épuisé : ${tire.brand} ${tire.model}`, tire, priority: "critical" });
    } else {
      actions.lowStock.push({
        type: "low_stock",
        message: `Stock faible : ${tire.brand} ${tire.model} (${tire.stockQuantity}/${tire.minStockLevel})`,
        tire,
        priority: "high",
      });
    }
  }
  for (const inspection of criticalWearInspections) {
    actions.criticalWear.push({
      type: "critical_wear",
      message: `Usure critique : ${inspection.vehicleRegistration} - ${(tiresService as any).translatePosition(inspection.position ?? "spare")} (${inspection.treadDepth}mm)`,
      inspection,
      priority: "critical",
    });
  }
  for (const vehicle of vehiclesWithRotations) {
    if (!vehicle.nextRotationMileage || !vehicle.currentMileage) continue;
    const mileageUntilRotation = vehicle.nextRotationMileage - vehicle.currentMileage;
    if (mileageUntilRotation <= 0) {
      actions.rotationDue.push({
        type: "rotation_due",
        message: `Rotation dépassée : ${vehicle.vehicleRegistration} (${Math.abs(mileageUntilRotation)}km de retard)`,
        vehicle,
        priority: "high",
      });
    } else if (mileageUntilRotation <= 5000) {
      actions.rotationApproaching.push({
        type: "rotation_approaching",
        message: `Rotation en approche : ${vehicle.vehicleRegistration} (dans ${mileageUntilRotation}km)`,
        vehicle,
        priority: "medium",
      });
    }
  }

  const stats = stockStats[0];
  const wear = wearStats[0];
  return {
    totalTires: stats.totalQuantity || 0,
    totalValue: stats.totalValue || 0,
    averageWear: wear.averageWear ? Number(wear.averageWear.toFixed(1)) : 0,
    lowStockCount: actions.lowStock.length,
    requiredActions: actions,
  };
}

const sortKey = (action: any) => action.tire?.id ?? action.inspection?.inspectionId ?? action.vehicle?.vehicleId;
function sorted<T extends { requiredActions: Record<string, any[]> }>(stats: T): T {
  const requiredActions = Object.fromEntries(
    Object.entries(stats.requiredActions).map(([key, list]) => [key, [...list].sort((a, b) => sortKey(a) - sortKey(b))]),
  );
  return { ...stats, requiredActions };
}

beforeAll(async () => {
  const due = await createTestVehicle({ mileage: 100000 });
  const approaching = await createTestVehicle({ mileage: 100000 });
  const parked = await createTestVehicle({ mileage: 100000, status: "maintenance" });
  ids.vehicleIds.push(due.id, approaching.id, parked.id);

  const seeded = await db
    .insert(tires)
    .values([
      { brand: "TEST-stat", model: "épuisé", size: "315/80R22.5", stockQuantity: 0, minStockLevel: 2, purchasePrice: "185000.50" },
      { brand: "TEST-stat", model: "bas", size: "315/80R22.5", stockQuantity: 1, minStockLevel: 2, purchasePrice: "99999.99",
        manufactureDate: "2025-03-14", dotCode: "DOT1125", notes: "note" },
      { brand: "TEST-stat", model: "ok", size: "295/80R22.5", stockQuantity: 9, minStockLevel: 2, purchasePrice: null },
      { brand: "TEST-stat", model: "supprimé", size: "295/80R22.5", stockQuantity: 0, minStockLevel: 2,
        purchasePrice: "1000", deletedAt: new Date("2026-11-01T08:30:15.123Z") },
    ])
    .returning();
  tireIds.push(...seeded.map((t) => t.id));
  const [, low, ok] = seeded;

  const mounted = await db
    .insert(vehicleTires)
    .values([
      { vehicleId: due.id, tireId: low.id, position: "front_left", installationDate: "2026-01-10", installationMileage: 90000, status: "active" },
      { vehicleId: due.id, tireId: ok.id, position: "rear_right_inner", installationDate: "2026-01-10", installationMileage: 90000, status: "active" },
      { vehicleId: approaching.id, tireId: ok.id, position: "spare", installationDate: "2026-01-10", installationMileage: 90000, status: "removed" },
    ])
    .returning();
  vehicleTireIds.push(...mounted.map((vt) => vt.id));
  const [frontLeft, rearInner, removed] = mounted;

  await db.insert(tireInspections).values([
    { vehicleTireId: frontLeft.id, inspectionDate: "2026-10-01", inspectionMileage: 99000, condition: "poor", treadDepth: 2.7 },
    { vehicleTireId: rearInner.id, inspectionDate: "2026-10-01", inspectionMileage: 99000, condition: "good", treadDepth: 8.3 },
    { vehicleTireId: rearInner.id, inspectionDate: "2026-10-02", inspectionMileage: 99100, condition: "good", treadDepth: null },
    { vehicleTireId: removed.id, inspectionDate: "2026-10-01", inspectionMileage: 99000, condition: "poor", treadDepth: 1.1 },
  ]);

  const rotations = await db
    .insert(tireRotations)
    .values([
      { vehicleId: due.id, rotationDate: "2026-05-01", rotationMileage: 80000, rotationType: "front_to_back", nextRotationMileage: 90000 },
      { vehicleId: due.id, rotationDate: "2026-08-01", rotationMileage: 85000, rotationType: "front_to_back", nextRotationMileage: 98000 },
      { vehicleId: approaching.id, rotationDate: "2026-08-01", rotationMileage: 92000, rotationType: "cross_rotation", nextRotationMileage: 103000 },
      { vehicleId: parked.id, rotationDate: "2026-08-01", rotationMileage: 50000, rotationType: "cross_rotation", nextRotationMileage: 60000 },
    ])
    .returning();
  rotationIds.push(...rotations.map((r) => r.id));
}, 120000);

afterAll(async () => {
  if (vehicleTireIds.length) {
    await db.delete(tireInspections).where(inArray(tireInspections.vehicleTireId, vehicleTireIds));
    await db.delete(vehicleTires).where(inArray(vehicleTires.id, vehicleTireIds));
  }
  if (rotationIds.length) await db.delete(tireRotations).where(inArray(tireRotations.id, rotationIds));
  if (tireIds.length) await db.delete(tires).where(inArray(tires.id, tireIds));
  await cleanupCreated(ids);
});

describe("statistiques avancées des pneus en une requête", { timeout: 120000 }, () => {
  const withoutRotations = (stats: any) => ({
    ...stats,
    requiredActions: { ...stats.requiredActions, rotationDue: undefined, rotationApproaching: undefined },
  });

  it("même résultat que l'ancien calcul en cinq requêtes, objets et JSON servi", async () => {
    const legacy = sorted(await legacyStatistics(sql`"vehicles"."id"`));
    const current = sorted(await tiresService.getTireStatisticsAdvanced());

    expect(current).toEqual(legacy);
    expect(JSON.parse(JSON.stringify(current))).toEqual(JSON.parse(JSON.stringify(legacy)));
  });

  it("ancien calcul copié tel quel : identique hors rotations, et rotations fausses (bug corrigé)", async () => {
    const legacy = sorted(await legacyStatistics());
    const current = sorted(await tiresService.getTireStatisticsAdvanced());

    expect(withoutRotations(current)).toEqual(withoutRotations(legacy));
    const seededDue = (stats: any) => stats.requiredActions.rotationDue.some((a: any) => a.vehicle.vehicleId === ids.vehicleIds[0]);
    expect(seededDue(legacy)).toBe(false);
    expect(seededDue(current)).toBe(true);
  });

  it("les données seedées sont bien couvertes (la comparaison ne porte pas sur des listes vides)", async () => {
    const stats = await tiresService.getTireStatisticsAdvanced();
    const actions = stats.requiredActions;
    const lowTire = actions.lowStock.find((a: any) => a.tire.id === tireIds[1])?.tire;
    expect(lowTire).toMatchObject({ purchasePrice: "99999.99", manufactureDate: "2025-03-14", stockQuantity: 1 });
    expect(lowTire.createdAt).toBeInstanceOf(Date);
    expect(actions.outOfStock.some((a: any) => a.tire.id === tireIds[0])).toBe(true);
    expect(actions.outOfStock.some((a: any) => a.tire.id === tireIds[3])).toBe(false);
    expect(actions.criticalWear.map((a: any) => a.inspection.treadDepth)).toContain(2.7);
    expect(actions.criticalWear.map((a: any) => a.inspection.treadDepth)).not.toContain(1.1);
    expect(actions.rotationDue.some((a: any) => a.vehicle.vehicleId === ids.vehicleIds[0])).toBe(true);
    expect(actions.rotationApproaching.some((a: any) => a.vehicle.vehicleId === ids.vehicleIds[1])).toBe(true);
    expect(typeof stats.totalTires).toBe("string");
    expect(typeof stats.totalValue).toBe("string");
  });

  it("une seule requête, donc une seule connexion du pool", async () => {
    const execute = vi.spyOn(db, "execute");
    const select = vi.spyOn(db, "select");
    try {
      await tiresService.getTireStatisticsAdvanced();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(select).not.toHaveBeenCalled();
    } finally {
      execute.mockRestore();
      select.mockRestore();
    }
  });
});
