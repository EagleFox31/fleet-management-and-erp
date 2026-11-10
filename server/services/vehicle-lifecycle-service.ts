import { sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import type { DbExecutor } from "../lib/fuel-card-lock";
import { moduleLogger } from "../lib/logger";
import { isForeignKeyViolation, isUniqueViolation } from "../lib/pg-errors";
import { VEHICLE_ACTIVITY_SOURCES, VEHICLE_DEACTIVATIONS } from "./vehicle-lifecycle-sources";

const log = moduleLogger("vehicle-lifecycle");

const OPEN_WORK_ORDER_STATUSES = ["pending", "in_progress", "awaiting_parts"] as const;
const OPEN_MISSION_STATUSES = ["draft", "planned", "assigned", "in_progress"] as const;
const ACTIVE_ASSIGNMENT_STATUSES = ["pending", "accepted", "in_progress"] as const;

export const VEHICLE_OPEN_WORK_MESSAGE =
  "Ce véhicule a encore des ordres de travail ou des missions en cours. Clôturez-les ou réaffectez-les, puis supprimez le véhicule.";

export type VehicleDeletionOutcome =
  | { mode: "hard"; vehicleId: number }
  | { mode: "soft"; vehicleId: number; activity: string[]; deactivated: number };

export type VehicleRestoreOutcome = { vehicleId: number; restored: boolean; reactivated: number; source?: "archive" };

export const VEHICLE_ARCHIVE_CONFLICT_MESSAGE =
  "Un véhicule de la flotte porte déjà cette immatriculation : impossible de restaurer la fiche archivée.";

const list = (values: readonly (string | boolean)[]): SQL => sql.join(values.map((v) => sql`${v}`), sql`, `);

async function lockVehicle(tx: DbExecutor, vehicleId: number): Promise<{ deleted: boolean } | null> {
  const res = await tx.execute(sql`SELECT deleted_at IS NOT NULL AS deleted FROM vehicles WHERE id = ${vehicleId} FOR UPDATE`);
  return (res.rows[0] as { deleted: boolean } | undefined) ?? null;
}

/** Trace dans l'historique de statut, au statut courant du véhicule. */
async function statusNote(tx: DbExecutor, vehicleId: number, actorUserId: number | null, notes: string): Promise<void> {
  await tx.execute(sql`
    INSERT INTO status_history (vehicle_id, status, date, notes, updated_by_id)
    SELECT id, status, CURRENT_DATE, ${notes}, ${actorUserId}::int FROM vehicles WHERE id = ${vehicleId}`);
}

/** Libellés des sources d'activité présentes pour ce véhicule (vide : aucune action). */
export async function vehicleActivity(tx: DbExecutor, vehicleId: number): Promise<string[]> {
  const found: string[] = [];
  for (const source of VEHICLE_ACTIVITY_SOURCES) {
    const min = source.minRows ?? 1;
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ${sql.identifier(source.table)} WHERE ${sql.identifier(source.column)} = ${vehicleId} LIMIT ${min}) AS hit`,
    );
    if (((res.rows[0] as { n: number } | undefined)?.n ?? 0) >= min) found.push(source.label);
  }
  return found;
}

/**
 * OT et missions ouverts du véhicule. Toutes les lignes lues sont verrouillées (FOR UPDATE), ouvertes
 * ou non : un OT ou une mission ne peut pas être rouvert entre ce contrôle et la fin de la transaction.
 * Une écriture qui attend ce verrou passe après la suppression ; elle ne relit pas `deleted_at`.
 */
async function openWork(tx: DbExecutor, vehicleId: number) {
  const allWorkOrders = await tx.execute(
    sql`SELECT id, title, status FROM work_orders WHERE vehicle_id = ${vehicleId} ORDER BY id FOR UPDATE`,
  );
  const open = new Set<string>(OPEN_WORK_ORDER_STATUSES);
  const workOrders = (allWorkOrders.rows as { id: number; title: string | null; status: string }[])
    .filter((w) => open.has(w.status))
    .map(({ id, title }) => ({ id, title }));
  // Camion ou remorque attelée : les deux colonnes comptent (une remorque n'est jamais `vehicle_id`).
  await tx.execute(sql`SELECT id FROM assignments WHERE vehicle_id = ${vehicleId} OR trailer_id = ${vehicleId} ORDER BY id FOR UPDATE`);
  await tx.execute(sql`SELECT id FROM mission_operations WHERE trailer_vehicle_id = ${vehicleId} ORDER BY id FOR UPDATE`);
  await tx.execute(sql`
    SELECT m.id FROM missions m
    WHERE EXISTS (SELECT 1 FROM assignments a WHERE a.mission_id = m.id AND (a.vehicle_id = ${vehicleId} OR a.trailer_id = ${vehicleId}))
       OR EXISTS (SELECT 1 FROM mission_operations o WHERE o.mission_id = m.id AND o.trailer_vehicle_id = ${vehicleId})
    ORDER BY m.id FOR UPDATE OF m`);
  const missions = await tx.execute(sql`
    SELECT m.id, m.order_number FROM missions m
    WHERE m.status IN (${list(OPEN_MISSION_STATUSES)})
      AND (EXISTS (SELECT 1 FROM assignments a WHERE a.mission_id = m.id AND (a.vehicle_id = ${vehicleId} OR a.trailer_id = ${vehicleId})
                     AND a.status IN (${list(ACTIVE_ASSIGNMENT_STATUSES)}))
           OR EXISTS (SELECT 1 FROM mission_operations o WHERE o.mission_id = m.id AND o.trailer_vehicle_id = ${vehicleId}))
    ORDER BY m.id`);
  return {
    workOrders,
    missions: (missions.rows as { id: number; order_number: string }[]).map((m) => ({ id: m.id, orderNumber: m.order_number })),
  };
}

/**
 * Supprime un véhicule, dans une transaction, le véhicule verrouillé (FOR UPDATE bloque aussi
 * toute insertion qui le référence) :
 * - aucune action : suppression physique ;
 * - au moins une : 409 s'il reste des OT ou des missions ouverts, sinon suppression douce et
 *   désactivation journalisée des éléments de `VEHICLE_DEACTIVATIONS`.
 * Renvoie null pour un véhicule inconnu ou déjà retiré (la route répond 404).
 */
export async function deleteVehicle(vehicleId: number, actorUserId: number | null): Promise<VehicleDeletionOutcome | null> {
  return db.transaction(async (tx) => {
    const current = await lockVehicle(tx, vehicleId);
    if (!current || current.deleted) return null;

    const activity = await vehicleActivity(tx, vehicleId);
    if (activity.length === 0) {
      try {
        // Point de sauvegarde : une clé étrangère non classée annule la suppression, pas la transaction.
        await tx.transaction(async (sp) => {
          await sp.execute(sql`DELETE FROM vehicles WHERE id = ${vehicleId}`);
        });
        log.info({ vehicleId, actorUserId }, "véhicule sans action supprimé physiquement");
        return { mode: "hard", vehicleId };
      } catch (error) {
        if (!isForeignKeyViolation(error)) throw error;
        // Filet, pas critère : une table référence le véhicule sans figurer dans VEHICLE_ACTIVITY_SOURCES.
        log.error({ err: error, vehicleId }, "source d'activité véhicule non classée : repli en suppression douce");
        activity.push("référence non classée");
      }
    }

    const open = await openWork(tx, vehicleId);
    if (open.workOrders.length > 0 || open.missions.length > 0) {
      throw new AppError(409, VEHICLE_OPEN_WORK_MESSAGE, { details: { openWorkOrders: open.workOrders, openMissions: open.missions } });
    }

    let deactivated = 0;
    for (const d of VEHICLE_DEACTIVATIONS) {
      const table = sql.identifier(d.table);
      const column = sql.identifier(d.column);
      const stamp = d.stampColumn ? sql.identifier(d.stampColumn) : null;
      const res = await tx.execute(sql`
        WITH changed AS (
          UPDATE ${table} AS t SET ${column} = ${d.applied}${stamp ? sql`, ${stamp} = now()` : sql``}
          FROM (SELECT id, ${column} AS previous FROM ${table}
                WHERE vehicle_id = ${vehicleId} AND ${column} IN (${list(d.activeValues)}) FOR UPDATE) AS old
          WHERE t.id = old.id
          RETURNING t.id, old.previous, ${stamp ? sql`t.${stamp}` : sql`NULL::timestamp`} AS stamp
        )
        INSERT INTO vehicle_deletion_effects (vehicle_id, table_name, row_id, column_name, previous_value, applied_value, applied_stamp, created_by)
        SELECT ${vehicleId}::int, ${d.table}::text, id, ${d.column}::text, to_jsonb(previous), ${JSON.stringify(d.applied)}::jsonb, stamp, ${actorUserId}::int
        FROM changed
        ON CONFLICT ON CONSTRAINT vehicle_deletion_effects_row_key DO NOTHING`);
      deactivated += res.rowCount ?? 0;
    }

    await tx.execute(sql`UPDATE vehicles SET deleted_at = now(), deleted_by = ${actorUserId}::int WHERE id = ${vehicleId}`);
    await statusNote(tx, vehicleId, actorUserId, "Retiré de la flotte (suppression douce)");
    log.info({ vehicleId, actorUserId, activity, deactivated }, "véhicule retiré de la flotte (suppression douce)");
    return { mode: "soft", vehicleId, activity, deactivated };
  });
}

/**
 * Restaure un véhicule retiré : `deleted_at` repasse à NULL et seuls les éléments désactivés par la
 * suppression sont réactivés, s'ils sont encore dans l'état qu'elle a posé. Le journal est ensuite
 * vidé : un second appel ne change rien. Renvoie null pour un véhicule inconnu.
 */
export async function restoreVehicle(vehicleId: number, actorUserId: number | null): Promise<VehicleRestoreOutcome | null> {
  return db.transaction(async (tx) => {
    const current = await lockVehicle(tx, vehicleId);
    if (!current) return restoreFromLegacyArchive(tx, vehicleId, actorUserId);
    if (!current.deleted) return { vehicleId, restored: false, reactivated: 0 };

    let reactivated = 0;
    const effects = await tx.execute(sql`
      SELECT id, table_name, row_id, column_name, previous_value, applied_value, applied_stamp IS NOT NULL AS stamped
      FROM vehicle_deletion_effects WHERE vehicle_id = ${vehicleId} ORDER BY id`);
    type Effect = { id: number; table_name: string; row_id: number; column_name: string; previous_value: unknown; applied_value: unknown; stamped: boolean };
    for (const e of effects.rows as Effect[]) {
      const known = VEHICLE_DEACTIVATIONS.find((d) => d.table === e.table_name && d.column === e.column_name);
      if (!known) {
        log.warn({ vehicleId, table: e.table_name, column: e.column_name }, "effet de suppression inconnu, ignoré à la restauration");
        continue;
      }
      const column = sql.identifier(known.column);
      const stamp = known.stampColumn ? sql.identifier(known.stampColumn) : null;
      // Horodatage comparé en SQL : la microseconde de Postgres ne survit pas à un aller-retour JS.
      const untouched = stamp && e.stamped
        ? sql` AND ${stamp} = (SELECT applied_stamp FROM vehicle_deletion_effects WHERE id = ${e.id})`
        : sql``;
      const res = await tx.execute(sql`
        UPDATE ${sql.identifier(known.table)} SET ${column} = ${e.previous_value as string | boolean}${stamp ? sql`, ${stamp} = now()` : sql``}
        WHERE id = ${e.row_id} AND vehicle_id = ${vehicleId} AND ${column} = ${e.applied_value as string | boolean}${untouched}`);
      reactivated += res.rowCount ?? 0;
    }
    await tx.execute(sql`DELETE FROM vehicle_deletion_effects WHERE vehicle_id = ${vehicleId}`);
    await tx.execute(sql`UPDATE vehicles SET deleted_at = NULL, deleted_by = NULL WHERE id = ${vehicleId}`);
    await statusNote(tx, vehicleId, actorUserId, "Remis dans la flotte (restauration)");
    log.info({ vehicleId, actorUserId, reactivated }, "véhicule restauré");
    return { vehicleId, restored: true, reactivated };
  });
}

/**
 * Repli : fiche retirée par l'ancien mécanisme d'archivage (table `vehicle_archived`, créée par
 * aucune migration). Table absente : null (404, comportement actuel). Présente : la fiche reprend son
 * identifiant d'origine, pour que l'historique qui la référence la retrouve. Les colonnes absentes de
 * l'archive prennent la valeur par défaut de `vehicles` ; la fiche revient opérationnelle.
 */
async function restoreFromLegacyArchive(tx: DbExecutor, vehicleId: number, actorUserId: number | null): Promise<VehicleRestoreOutcome | null> {
  const table = await tx.execute(sql`SELECT to_regclass('public.vehicle_archived') IS NOT NULL AS present`);
  if (!(table.rows[0] as { present: boolean } | undefined)?.present) return null;
  try {
    await tx.transaction(async (sp) => {
      const inserted = await sp.execute(sql`
        INSERT INTO vehicles
        SELECT (jsonb_populate_record(NULL::vehicles,
          jsonb_build_object('mileage', 0, 'last_mileage', 0, 'vehicle_type', 'tracteur', 'fuel_type', 'diesel', 'created_at', now())
          || jsonb_strip_nulls(to_jsonb(a))
          || jsonb_build_object('id', a.original_vehicle_id, 'status', 'operational', 'deleted_at', NULL, 'deleted_by', NULL))).*
        FROM (SELECT * FROM vehicle_archived WHERE original_vehicle_id = ${vehicleId} LIMIT 1) AS a
        RETURNING id`);
      if ((inserted.rowCount ?? 0) === 0) throw new LegacyArchiveMissing();
      await sp.execute(sql`DELETE FROM vehicle_archived WHERE original_vehicle_id = ${vehicleId}`);
    });
  } catch (error) {
    if (error instanceof LegacyArchiveMissing) return null;
    if (isUniqueViolation(error)) throw new AppError(409, VEHICLE_ARCHIVE_CONFLICT_MESSAGE, { cause: error });
    throw error;
  }
  await statusNote(tx, vehicleId, actorUserId, "Remis dans la flotte (restauration depuis l'archive)");
  log.info({ vehicleId, actorUserId }, "véhicule restauré depuis vehicle_archived");
  return { vehicleId, restored: true, reactivated: 0, source: "archive" };
}

class LegacyArchiveMissing extends Error {}
