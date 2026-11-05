import type { Request } from "express";
import { eq } from "drizzle-orm";
import { vehicles } from "@shared/schema";
import { db } from "../db";
import { AppError } from "./app-error";
import { OUT_OF_SCOPE_MESSAGE } from "./client-scope";
import { canReadVehicleSubresources } from "./vehicle-retired";

const vehicleRow = (id: number) => async () =>
  (await db.select({ ownerId: vehicles.ownerId, deletedAt: vehicles.deletedAt }).from(vehicles).where(eq(vehicles.id, id)).limit(1))[0];

/**
 * Cloison client d'une lecture rattachée à un véhicule : 403 hors périmètre ou véhicule retiré,
 * même message dans les deux cas (le retrait ne se devine pas). Le personnel passe sans lecture.
 * Lève : reconnue comme garde par `tests/support/route-guard-scan.ts`, à condition d'être attendue.
 */
export async function assertVehicleSubresourcesReadable(req: Request, vehicleId: number): Promise<void> {
  if (!(await canReadVehicleSubresources(req.user, vehicleRow(vehicleId)))) throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
}
