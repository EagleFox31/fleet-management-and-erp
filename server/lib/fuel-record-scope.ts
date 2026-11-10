import { MISSION_READ_ROLES } from "@shared/constants/roles";
import { withoutFuelCardBalance } from "./fuel-balance-scope";

/**
 * Champs de mission recopiés sur une ligne de plein (`fuel_records.order_number`, `client_name`,
 * `destination`, colonnes de l'Excel) : numéro de commande, client et lieu de livraison. Ils suivent la
 * règle de lecture des missions :
 * - hors `MISSION_READ_ROLES` (technicien, client, rôle absent ou inconnu) : jamais (échec fermé) ;
 * - chauffeur : seulement sur les pleins de SES missions (`ownMissionIds`, `driverMissionIdsOf`),
 *   masqués sur le reste de la flotte, et partout si l'ensemble n'est pas fourni ;
 * - reste du personnel : toujours.
 */
const MISSION_FIELD_KEYS = ["orderNumber", "clientName", "destination"] as const;

export type FuelRecordReader = { role?: string | null } | null | undefined;

export function canReadFuelRecordMissionFields(role: string | null | undefined): boolean {
  return (MISSION_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

function keepsMissionFields(reader: FuelRecordReader, record: Record<string, unknown>, ownMissionIds?: ReadonlySet<number>): boolean {
  if (!canReadFuelRecordMissionFields(reader?.role)) return false;
  if (reader?.role !== "driver") return true;
  const missionId = record.missionId;
  return typeof missionId === "number" && ownMissionIds?.has(missionId) === true;
}

function presentOne<T>(reader: FuelRecordReader, record: T, ownMissionIds?: ReadonlySet<number>): T {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  if (keepsMissionFields(reader, record as Record<string, unknown>, ownMissionIds)) return record;
  const next: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const key of MISSION_FIELD_KEYS) delete next[key];
  return next as T;
}

export function withoutFuelRecordMissionFields<T>(reader: FuelRecordReader, value: T, ownMissionIds?: ReadonlySet<number>): T {
  return Array.isArray(value)
    ? (value.map((item) => presentOne(reader, item, ownMissionIds)) as unknown as T)
    : presentOne(reader, value, ownMissionIds);
}

/**
 * Pleins renvoyés à un lecteur : solde de la carte (trésorerie) et champs de mission, chacun selon sa liste.
 * `ownMissionIds` : missions du chauffeur lecteur (`driverMissionIdsOf`), ignoré pour les autres rôles.
 */
export function presentFuelRecords<T>(reader: FuelRecordReader, value: T, ownMissionIds?: ReadonlySet<number>): T {
  return withoutFuelRecordMissionFields(reader, withoutFuelCardBalance(reader, value), ownMissionIds);
}
