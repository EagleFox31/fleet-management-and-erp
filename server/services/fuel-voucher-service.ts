import { and, eq, isNull, sql } from "drizzle-orm";
import {
  FUEL_VOUCHER_STALE_MESSAGE,
  type FuelVoucher,
  type FuelVouchersQuery,
  type FuelVoucherValidationResponse,
} from "@shared/contracts/fuel-vouchers";
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
 * Jeton de version d'un bon : `updated_at` en texte à la microseconde, calculé par Postgres (aucun
 * arrondi ni fuseau côté JavaScript). Même format en lecture (`listFuelVouchers`) et en comparaison.
 */
const VERSION_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US';

/**
 * Valide un bon de carburant (identifiant de `fuel_records`). La mise à jour est conditionnée à l'état
 * `pending` et, si l'écran l'envoie, à la `version` affichée : deux validations simultanées n'en
 * écrivent qu'une, l'autre reçoit 409, comme un bon déjà validé ou modifié depuis son affichage.
 */
export async function validateFuelVoucher(userId: number, id: number, version?: string): Promise<FuelVoucherValidationResponse> {
  const now = new Date();
  const [updated] = await db
    .update(fuelRecords)
    .set({ validationStatus: "validated", validatedBy: userId, validatedAt: now, updatedBy: userId, updatedAt: now })
    .where(
      and(
        eq(fuelRecords.id, id),
        eq(fuelRecords.validationStatus, "pending"),
        isNull(fuelRecords.deletedAt),
        version === undefined ? undefined : sql`to_char(${fuelRecords.updatedAt}, ${VERSION_FORMAT}) = ${version}`,
      ),
    )
    .returning();
  if (updated) return toResponse(updated);

  const [existing] = await db
    .select({ id: fuelRecords.id })
    .from(fuelRecords)
    .where(and(eq(fuelRecords.id, id), isNull(fuelRecords.deletedAt)))
    .limit(1);
  if (!existing) throw new AppError(404, "Bon de carburant introuvable.");
  throw new AppError(409, FUEL_VOUCHER_STALE_MESSAGE);
}

const LIST_LIMIT = 500;

type VoucherRow = {
  id: number;
  day: string | null;
  vehicle_id: number;
  vehicle_label: string | null;
  quantity: number;
  cost: string | null;
  station_name: string | null;
  validation_status: FuelVoucher["validationStatus"];
  validated_by_name: string | null;
  validated_iso: string | null;
  version: string;
};

/**
 * Bons de carburant (pleins rattachés à un véhicule ; les recharges de carte n'en sont pas),
 * les plus récents d'abord. Lecture seule, sans effet.
 */
export async function listFuelVouchers(query: FuelVouchersQuery): Promise<FuelVoucher[]> {
  const status = query.status === "all" ? sql`` : sql`AND fr.validation_status = ${query.status}`;
  const res = await db.execute(sql`
    SELECT fr.id, to_char(fr.date, 'YYYY-MM-DD') AS day, fr.vehicle_id, v.registration_number AS vehicle_label,
           fr.quantity, fr.cost, fr.station_name, fr.validation_status, u.name AS validated_by_name,
           to_char(fr.validated_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS validated_iso,
           to_char(fr.updated_at, ${VERSION_FORMAT}) AS version
      FROM fuel_records fr
      LEFT JOIN vehicles v ON v.id = fr.vehicle_id
      LEFT JOIN users u ON u.id = fr.validated_by
     WHERE fr.vehicle_id IS NOT NULL AND fr.deleted_at IS NULL ${status}
     ORDER BY fr.date DESC NULLS LAST, fr.id DESC
     LIMIT ${LIST_LIMIT}`);
  const rows = ((res as unknown as { rows?: VoucherRow[] }).rows ?? (res as unknown as VoucherRow[])) as VoucherRow[];
  return rows.map((r) => ({
    id: Number(r.id),
    date: r.day,
    vehicleId: Number(r.vehicle_id),
    vehicleLabel: r.vehicle_label,
    quantity: Number(r.quantity),
    cost: r.cost == null ? null : Number(r.cost),
    stationName: r.station_name,
    validationStatus: r.validation_status,
    validatedByName: r.validated_by_name,
    validatedAt: r.validated_iso,
    version: r.version,
  }));
}
