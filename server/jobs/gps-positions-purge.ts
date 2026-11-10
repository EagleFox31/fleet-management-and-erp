/**
 * Purge quotidienne des positions GPS (vehicle_positions), rétention configurable (30 jours par
 * défaut, `GPS_POSITION_RETENTION_DAYS`). Elle tourne même drapeau `gps` coupé : la rétention est une promesse de conservation, pas un réglage de la fonctionnalité (des positions écrites avant une coupure restent supprimées à l'échéance). La suppression
 * vit en base (`purge_vehicle_positions`), idempotente : deux instances qui passent ensemble
 * suppriment chacune ce qui reste, sans verrou nécessaire. Aucune exception vers l'appelant.
 */
import { gpsPositionRetentionDays, purgeVehiclePositions } from "../lib/gps-retention";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("gps-positions-purge");

type Queryable = Parameters<typeof purgeVehiclePositions>[0];

export type GpsPurgeDeps = {
  retentionDays: () => number;
  client: () => Promise<Queryable>;
};

export type GpsPurgeOutcome = { purged: number; retentionDays: number };

export async function runGpsPositionsPurge(deps: GpsPurgeDeps): Promise<GpsPurgeOutcome> {
  const retentionDays = deps.retentionDays();
  const purged = await purgeVehiclePositions(await deps.client(), retentionDays);
  if (purged > 0) log.info({ purged, retentionDays }, "positions GPS expirées supprimées");
  return { purged, retentionDays };
}

async function productionDeps(): Promise<GpsPurgeDeps> {
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  return {
    retentionDays: () => gpsPositionRetentionDays(),
    client: async () => ({
      query: async (text: string, params: unknown[] = []) => {
        // Seul appel : SELECT purge_vehicle_positions($1) ; la durée est un entier validé par la configuration.
        const days = Number(params[0]);
        const result = await db.execute(sql`SELECT purge_vehicle_positions(${days}) AS deleted`);
        return { rows: ((result as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? []) };
      },
    }),
  };
}

/** Un tick du planificateur : jamais d'exception vers l'appelant. */
export async function gpsPositionsPurgeTick(): Promise<void> {
  try {
    await runGpsPositionsPurge(await productionDeps());
  } catch (err) {
    log.error({ err }, "purge des positions GPS en échec");
  }
}
