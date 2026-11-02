import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../server/db";
import {
  activityLogs,
  tireInspections,
  tireRotationDetails,
  tireRotations,
  tires,
  vehicleTires,
  workOrders,
} from "../../shared/schema";
import { getDefaultTireFormValues } from "../../shared/tire-form";
import { cleanupCreated, createIdBag } from "../support/cleanup";
import { startContractActors } from "../support/contract-actors";
import { createTestVehicle } from "../support/factories";
import { uniqueTestToken } from "../support/ids";

/**
 * Parcours P5 (docs/qa/PLAN_COUVERTURE_MODULES.md) : cycle de vie d'UN pneu, de l'entrée en stock à
 * la suppression de la fiche, par HTTP avec le rôle de chaque étape et le même pneu d'un bout à l'autre.
 *
 *   entrée en stock (magasinier) -> montage (chef d'atelier) -> inspection (technicien)
 *   -> rotation -> démontage vers le stock (usagé +1) -> remontage de l'usagé
 *   -> démontage au rebut -> suppression douce (admin) -> historique conservé
 *
 * Chaque étape existe déjà isolément dans `tires-rbac` et `tires-used-stock`, sur des lignes préparées
 * en base. Ce fichier ne prouve que le chaînage : le compteur de stock reste juste à chaque maillon,
 * et l'historique (montages, inspection) survit à la suppression de la fiche.
 */

const ACTORS = {
  admin: "admin",
  warehouse: "warehouse",
  workshopManager: "workshop_manager",
  technician: "technician",
} as const;
type Actor = keyof typeof ACTORS;
const ids = createIdBag();
const tireIds: number[] = [];
let session: Awaited<ReturnType<typeof startContractActors<Actor>>>;

async function tireRow(id: number) {
  const [row] = await db.select().from(tires).where(eq(tires.id, id));
  return row;
}

beforeAll(async () => {
  session = await startContractActors(ACTORS, ids.userIds);
}, 60000);

afterAll(async () => {
  try {
    if (ids.vehicleIds.length > 0) {
      const mounted = await db.select({ id: vehicleTires.id }).from(vehicleTires).where(inArray(vehicleTires.vehicleId, ids.vehicleIds));
      const mountedIds = mounted.map((row) => row.id);
      if (mountedIds.length > 0) {
        await db.delete(tireInspections).where(inArray(tireInspections.vehicleTireId, mountedIds));
        await db.delete(tireRotationDetails).where(inArray(tireRotationDetails.vehicleTireId, mountedIds));
      }
      await db.delete(tireRotations).where(inArray(tireRotations.vehicleId, ids.vehicleIds));
      await db.delete(workOrders).where(inArray(workOrders.vehicleId, ids.vehicleIds));
      await db.delete(vehicleTires).where(inArray(vehicleTires.vehicleId, ids.vehicleIds));
    }
    if (tireIds.length > 0) {
      await db.delete(vehicleTires).where(inArray(vehicleTires.tireId, tireIds));
      await db.delete(tires).where(inArray(tires.id, tireIds));
    }
    if (ids.userIds.length > 0) {
      await db.delete(activityLogs).where(inArray(activityLogs.userId, ids.userIds));
    }
    await cleanupCreated(ids);
  } finally {
    await session?.close();
  }
}, 60000);

describe("P5 : cycle de vie d'un pneu", { timeout: 180000 }, () => {
  it("entrée en stock, montage, inspection, rotation, démontage, remontage de l'usagé, rebut, suppression : stock juste à chaque étape, historique conservé", async () => {
    const vehicle = await createTestVehicle();
    ids.vehicleIds.push(vehicle.id);

    // 1. Entrée en stock par le magasinier : 1 pneu neuf, fiche à son nom.
    const created = await session.call("POST", "/api/tires", {
      actor: "warehouse",
      body: {
        ...getDefaultTireFormValues(),
        brand: "TEST-MARQUE",
        model: uniqueTestToken("p5"),
        manufacturingWeek: "10",
        stockQuantity: 1,
        purchasePrice: 250000,
        supplier: "TEST fournisseur",
        location: "TEST rayon",
      },
    });
    expect(created.status).toBe(201);
    const tireId = created.body.id as number;
    tireIds.push(tireId);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 1, usedStockQuantity: 0, createdBy: session.userIdOf("warehouse") });

    // 2. Montage par le chef d'atelier : neuf -1, la pose est tracée « neuf ».
    const mount = await session.call("POST", `/api/vehicles/${vehicle.id}/tires`, {
      actor: "workshopManager",
      body: { tireId, position: "front_left", installationDate: "2026-10-30", installationMileage: 1000 },
    });
    expect(mount.status).toBe(201);
    const firstMountId = mount.body.id as number;
    expect(mount.body).toMatchObject({ status: "active", stockSource: "new" });
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 0, usedStockQuantity: 0 });

    // 3. Pneu monté : fiche non supprimable (409), puis inspection par le technicien, à son nom.
    expect((await session.call("DELETE", `/api/tires/${tireId}`, { actor: "admin" })).status).toBe(409);
    const inspection = await session.call("POST", "/api/tire-inspections", {
      actor: "technician",
      body: { vehicleTireId: firstMountId, inspectionDate: "2026-10-31", inspectionMileage: 1500, condition: "good" },
    });
    expect(inspection.status).toBe(201);
    expect(inspection.body).toMatchObject({ vehicleTireId: firstMountId, inspectedBy: session.userIdOf("technician") });

    // 4. Rotation planifiée par le chef d'atelier : le stock ne bouge pas.
    const rotation = await session.call("POST", "/api/tire-rotations", {
      actor: "workshopManager",
      body: { rotation: { vehicleId: vehicle.id, rotationDate: "2026-11-01", rotationMileage: 5000, rotationType: "front_to_back" } },
    });
    expect(rotation.status).toBe(201);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 0, usedStockQuantity: 0 });

    // 5. Démontage vers le stock : le pneu a roulé, il revient en usagé (+1), le neuf reste à 0.
    const removed = await session.call("PATCH", `/api/vehicle-tires/${firstMountId}/remove`, {
      actor: "workshopManager",
      body: { destination: "stock", removalMileage: 6000, removalReason: "Rotation terminée" },
    });
    expect(removed.status).toBe(200);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 0, usedStockQuantity: 1 });

    // 6. Sans source explicite, le remontage ne prend pas l'usagé (neuf à 0 : 409) ; avec, il le prend.
    const implicit = await session.call("POST", `/api/vehicles/${vehicle.id}/tires`, {
      actor: "workshopManager",
      body: { tireId, position: "front_left", installationDate: "2026-11-02", installationMileage: 6000 },
    });
    expect(implicit.status, JSON.stringify(implicit.body)).toBe(409);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 0, usedStockQuantity: 1 });
    const remount = await session.call("POST", `/api/vehicles/${vehicle.id}/tires`, {
      actor: "workshopManager",
      body: { tireId, position: "front_left", installationDate: "2026-11-02", installationMileage: 6000, stockSource: "used" },
    });
    expect(remount.status, JSON.stringify(remount.body)).toBe(201);
    expect(remount.body).toMatchObject({ status: "active", stockSource: "used" });
    const secondMountId = remount.body.id as number;
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 0, usedStockQuantity: 0 });

    // 7. Démontage au rebut (usé) : motif enregistré, aucun retour en stock.
    const scrapped = await session.call("PATCH", `/api/vehicle-tires/${secondMountId}/remove`, {
      actor: "workshopManager",
      body: { destination: "scrap", scrapReason: "worn", removalMileage: 60000 },
    });
    expect(scrapped.status).toBe(200);
    expect(await tireRow(tireId)).toMatchObject({ stockQuantity: 0, usedStockQuantity: 0 });

    // 8. Suppression douce par l'admin (plus monté) : la fiche sort du stock mais reste en base.
    expect((await session.call("DELETE", `/api/tires/${tireId}`, { actor: "warehouse" })).status).toBe(403);
    expect((await session.call("DELETE", `/api/tires/${tireId}`, { actor: "admin" })).status).toBe(204);
    const row = await tireRow(tireId);
    expect(row.deletedAt).not.toBeNull();
    expect(row.updatedBy).toBe(session.userIdOf("admin"));
    expect((await session.call("GET", `/api/tires/${tireId}`, { actor: "warehouse" })).status).toBe(404);

    // 9. Historique intact : les deux montages (démonté, usé) et l'inspection survivent à la suppression.
    const history = await db.select().from(vehicleTires).where(eq(vehicleTires.tireId, tireId));
    expect(history.map((h) => [h.id, h.status, h.stockSource]).sort()).toEqual(
      [
        [firstMountId, "removed", "new"],
        [secondMountId, "worn", "used"],
      ].sort(),
    );
    const inspections = await db.select().from(tireInspections).where(eq(tireInspections.vehicleTireId, firstMountId));
    expect(inspections).toHaveLength(1);
  });
});
