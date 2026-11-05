import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { missionOperations, missions, vehicles } from "@shared/schema";
import {
  OPERATION_RECAP_STATUSES,
  recapStatusOf,
  type MissionOperationBody,
  type MissionOperationRow,
  type MissionOperationsResponse,
  type OperationRecapStatus,
} from "@shared/contracts/mission-operations";

type Raw = Record<string, unknown>;

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

/** Colonnes `timestamp` sans fuseau, lues en texte UTC : jamais réinterprétées à l'heure locale du serveur. */
const iso = (v: unknown): string | null => (v ? String(v) : null);
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export type MissionOperationsFilter = { clientId?: number; month?: string };

/**
 * Une ligne par mission (avec ses colonnes de suivi, vides si rien n'est saisi), filtrée par client et
 * par mois de chargement prévu. La facture retenue est la plus récente non annulée de la mission.
 */
export async function listMissionOperations(filter: MissionOperationsFilter): Promise<MissionOperationsResponse> {
  const where = [sql`TRUE`];
  if (filter.clientId) where.push(sql`m.client_id = ${filter.clientId}`);
  if (filter.month) where.push(sql`to_char(COALESCE(o.loading_date, m.pickup_date), 'YYYY-MM') = ${filter.month}`);
  const result = await db.execute(sql`
    SELECT m.id AS mission_id, m.order_number, m.client_id, c.name AS client_name,
           m.pickup_address, m.delivery_address, m.status AS mission_status,
           inv.invoice_number, inv.status AS invoice_status,
           o.trailer_vehicle_id, o.container_number, o.bl_number, o.sector, to_char(o.loading_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS loading_date,
           to_char(o.departure_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS departure_date, to_char(o.return_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS return_date, to_char(o.unloading_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS unloading_date, o.goods_nature, o.comment
    FROM missions m
    LEFT JOIN clients c ON c.id = m.client_id
    LEFT JOIN mission_operations o ON o.mission_id = m.id
    LEFT JOIN LATERAL (
      SELECT ci.invoice_number, ci.status FROM client_invoices ci
      WHERE ci.mission_id = m.id AND ci.status <> 'cancelled'
      ORDER BY ci.id DESC LIMIT 1
    ) inv ON TRUE
    WHERE ${sql.join(where, sql` AND `)}
    ORDER BY c.name NULLS LAST, COALESCE(o.loading_date, m.pickup_date) DESC NULLS LAST, m.id DESC
  `);
  const recap = Object.fromEntries(OPERATION_RECAP_STATUSES.map((s) => [s, 0])) as Record<OperationRecapStatus, number>;
  const rows = rowsOf<Raw>(result).map((r): MissionOperationRow => {
    const recapStatus = recapStatusOf({
      missionStatus: str(r.mission_status),
      invoiceStatus: str(r.invoice_status),
      returnDate: iso(r.return_date),
    });
    recap[recapStatus] += 1;
    return {
      missionId: Number(r.mission_id),
      orderNumber: String(r.order_number),
      clientId: r.client_id === null ? null : Number(r.client_id),
      clientName: str(r.client_name),
      pickupAddress: String(r.pickup_address),
      deliveryAddress: String(r.delivery_address),
      missionStatus: String(r.mission_status),
      invoiceNumber: str(r.invoice_number),
      invoiceStatus: str(r.invoice_status),
      recapStatus,
      trailerVehicleId: r.trailer_vehicle_id === null ? null : Number(r.trailer_vehicle_id),
      containerNumber: str(r.container_number),
      blNumber: str(r.bl_number),
      sector: str(r.sector),
      loadingDate: iso(r.loading_date),
      departureDate: iso(r.departure_date),
      returnDate: iso(r.return_date),
      unloadingDate: iso(r.unloading_date),
      goodsNature: str(r.goods_nature),
      comment: str(r.comment),
    };
  });
  return { rows, recap };
}

const DATE_KEYS = ["loadingDate", "departureDate", "returnDate", "unloadingDate"] as const;
const TEXT_KEYS = ["containerNumber", "blNumber", "sector", "goodsNature", "comment"] as const;

/** Ne garde que les champs fournis ; une chaîne vide efface. Rejouer le même corps ne change rien. */
function valuesOf(body: MissionOperationBody) {
  const values: Partial<typeof missionOperations.$inferInsert> = {};
  if (body.trailerVehicleId !== undefined) values.trailerVehicleId = body.trailerVehicleId;
  for (const k of TEXT_KEYS) if (body[k] !== undefined) values[k] = body[k] === null || body[k] === "" ? null : body[k];
  for (const k of DATE_KEYS) {
    const v = body[k];
    if (v !== undefined) values[k] = v ? new Date(v) : null;
  }
  return values;
}

/** Crée ou met à jour la ligne de suivi d'une mission (1-1, `mission_id` unique). */
export async function upsertMissionOperation(missionId: number, body: MissionOperationBody, userId: number) {
  const [mission] = await db.select({ id: missions.id }).from(missions).where(eq(missions.id, missionId));
  if (!mission) throw new AppError(404, "Mission introuvable.");
  if (body.trailerVehicleId) {
    const [v] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, body.trailerVehicleId));
    if (!v) throw new AppError(400, "Remorque introuvable.");
  }
  const values = valuesOf(body);
  const [row] = await db
    .insert(missionOperations)
    .values({ ...values, missionId, createdBy: userId, updatedBy: userId })
    .onConflictDoUpdate({
      target: missionOperations.missionId,
      set: { ...values, updatedBy: userId, updatedAt: new Date() },
    })
    .returning();
  return row;
}
