import { and, eq } from "drizzle-orm";
import type { FuelVoucherValidationResponse } from "@shared/contracts/fuel-vouchers";
import { fuelRecords } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";

function toResponse(row: typeof fuelRecords.$inferSelect): FuelVoucherValidationResponse {
  return {
    id: row.id,
    validationStatus: row.validationStatus,
    validatedBy: row.validatedBy ?? null,
    validatedAt: row.validatedAt ? row.validatedAt.toISOString() : null,
  };
}

/**
 * Valide un bon de carburant (identifiant de `fuel_records`). Idempotent : un bon déjà validé est
 * renvoyé tel quel, sans réécrire l'auteur ni la date. La mise à jour est conditionnée à l'état
 * `pending`, donc deux validations simultanées n'en écrivent qu'une.
 */
export async function validateFuelVoucher(userId: number, id: number): Promise<FuelVoucherValidationResponse> {
  const [updated] = await db
    .update(fuelRecords)
    .set({ validationStatus: "validated", validatedBy: userId, validatedAt: new Date() })
    .where(and(eq(fuelRecords.id, id), eq(fuelRecords.validationStatus, "pending")))
    .returning();
  if (updated) return toResponse(updated);

  const [existing] = await db.select().from(fuelRecords).where(eq(fuelRecords.id, id)).limit(1);
  if (!existing) throw new AppError(404, "Bon de carburant introuvable.");
  return toResponse(existing);
}
