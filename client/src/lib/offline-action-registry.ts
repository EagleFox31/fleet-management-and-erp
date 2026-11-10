import type { QueryFilters } from "@tanstack/react-query";
import type { FeatureKey } from "@shared/feature-flags";

/**
 * Registre déclaratif des types d'écriture rejouables hors ligne.
 *
 * Un type décrit : son libellé affiché, la route par défaut, les drapeaux qu'il exige et
 * les requêtes à invalider quand l'envoi a abouti (couche 3 d'AGENTS.md §2). La file ne
 * connaît ni les rôles ni les types : elle lit ce registre. Un lot métier (plein, statut,
 * POD, panne, notes d'OT...) ajoute son type par `registerOfflineAction`, sans toucher
 * à la file.
 */

export interface OfflineActionContext {
  missionId?: number;
  payload: unknown;
}

export interface OfflineActionDefinition {
  type: string;
  /** Libellé affiché dans le badge et l'écran « Envois ». */
  label: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Route par défaut ; une mise en file peut fournir la sienne. */
  endpoint?: (context: OfflineActionContext) => string;
  /** Drapeaux exigés pour mettre ce type en file. `offline-writes` est toujours exigé. */
  requiredFlags?: readonly FeatureKey[];
  /** Requêtes à invalider quand l'envoi est confirmé (détail, liste, écrans satellites). */
  invalidations?: (context: OfflineActionContext) => QueryFilters[];
}

export const BASE_REQUIRED_FLAG: FeatureKey = "offline-writes";

const definitions = new Map<string, OfflineActionDefinition>();

export function registerOfflineAction(definition: OfflineActionDefinition): void {
  definitions.set(definition.type, definition);
}

export function getOfflineAction(type: string): OfflineActionDefinition | undefined {
  return definitions.get(type);
}

export function requiredFlagsOf(definition: OfflineActionDefinition): FeatureKey[] {
  return Array.from(new Set<FeatureKey>([BASE_REQUIRED_FLAG, ...(definition.requiredFlags ?? [])]));
}

/** Filtre sur une route : invalide `[path]` et toute clé qui commence par elle. */
export const byPath = (path: string): QueryFilters => ({ queryKey: [path] });

const missionQueries = (missionId?: number): QueryFilters[] =>
  missionId ? [byPath(`/api/missions/${missionId}`), byPath(`/api/missions/${missionId}/fuel-records`)] : [];

// Types de l'ancienne file, conservés pour que les éléments déjà stockés se rejouent.
registerOfflineAction({
  type: "fuel_entry",
  label: "Plein de carburant",
  method: "POST",
  requiredFlags: ["driver-offline"],
  invalidations: ({ missionId }) => [
    ...missionQueries(missionId),
    byPath("/api/missions"),
    byPath("/api/fuel-card/balance"),
  ],
});
registerOfflineAction({
  type: "work_order_note",
  label: "Note d'ordre de travail",
  method: "POST",
  requiredFlags: ["technician-offline"],
  invalidations: () => [byPath("/api/technician/my-work-orders"), byPath("/api/work-orders")],
});
registerOfflineAction({
  type: "odometer_reading",
  label: "Relevé kilométrique",
  method: "POST",
  invalidations: () => [byPath("/api/vehicles")],
});
