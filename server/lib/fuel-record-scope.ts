import { MISSION_READ_ROLES } from "@shared/constants/roles";
import { withoutFuelCardBalance } from "./fuel-balance-scope";

/**
 * Champs de mission recopiés sur une ligne de plein (`fuel_records.order_number`, `client_name`,
 * `destination`, colonnes de l'Excel) : numéro de commande, client et lieu de livraison. Ils suivent la
 * règle de lecture des missions (`MISSION_READ_ROLES`) : le technicien et le client lisent
 * les pleins sans eux. Échec fermé sur rôle absent.
 */
const MISSION_FIELD_KEYS = ["orderNumber", "clientName", "destination"] as const;

export function canReadFuelRecordMissionFields(role: string | null | undefined): boolean {
  return (MISSION_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

function omitMissionFields<T>(record: T): T {
  if (record === null || typeof record !== "object" || Array.isArray(record)) return record;
  const next: Record<string, unknown> = { ...(record as Record<string, unknown>) };
  for (const key of MISSION_FIELD_KEYS) delete next[key];
  return next as T;
}

export function withoutFuelRecordMissionFields<T>(reader: { role?: string | null } | null | undefined, value: T): T {
  if (canReadFuelRecordMissionFields(reader?.role)) return value;
  return Array.isArray(value) ? (value.map((item) => omitMissionFields(item)) as unknown as T) : omitMissionFields(value);
}

/** Pleins renvoyés à un lecteur : solde de la carte (trésorerie) et champs de mission, chacun selon sa liste. */
export function presentFuelRecords<T>(reader: { role?: string | null } | null | undefined, value: T): T {
  return withoutFuelRecordMissionFields(reader, withoutFuelCardBalance(reader, value));
}
