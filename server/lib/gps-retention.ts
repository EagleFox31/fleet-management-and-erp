/**
 * Rétention des positions GPS (vehicle_positions). La suppression vit en base,
 * purge_vehicle_positions(jours) (server/db/migrations/20261110_vehicle_positions_gps.sql) ;
 * ce module lit la durée en configuration et appelle la fonction. Sans import de server/db :
 * l'appelant fournit sa connexion (pool, transaction), et les unitaires tournent sans base.
 * La planification quotidienne revient au lot API (GPS-API-1).
 */

/** Durée par défaut, décision du 2026-11-10 (docs/plans/carte-chauffeur-gps-telephone.md §5). */
export const GPS_POSITION_RETENTION_DEFAULT_DAYS = 30;
/** Plafond : au-delà, la valeur est tenue pour une erreur de saisie. */
export const GPS_POSITION_RETENTION_MAX_DAYS = 3650;

/**
 * GPS_POSITION_RETENTION_DAYS : entier de 1 à 3650. Absent ou invalide (non entier, nul, négatif,
 * hors plafond) : 30 jours, jamais 0, qui viderait la table.
 */
export function gpsPositionRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const raw = env.GPS_POSITION_RETENTION_DAYS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return GPS_POSITION_RETENTION_DEFAULT_DAYS;
  const days = Number(raw);
  return days >= 1 && days <= GPS_POSITION_RETENTION_MAX_DAYS ? days : GPS_POSITION_RETENTION_DEFAULT_DAYS;
}

type Queryable = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

/** Supprime les points relevés il y a plus de `retentionDays` jours ; renvoie le nombre supprimé (0 au second passage). */
export async function purgeVehiclePositions(
  client: Queryable,
  retentionDays: number = gpsPositionRetentionDays(),
): Promise<number> {
  const { rows } = await client.query("SELECT purge_vehicle_positions($1) AS deleted", [retentionDays]);
  return Number(rows[0]?.deleted ?? 0);
}
