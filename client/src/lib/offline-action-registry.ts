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
  /**
   * Exemple réel de route de ce type. Un test vérifie que (méthode, exemple) correspond à un motif
   * protégé de `shared/idempotency-routes.ts` : un type dont la route n'est pas protégée contre le
   * doublon ne s'ajoute pas au registre (la file ne le rejouerait pas).
   */
  routeExample: string;
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

export function listOfflineActions(): OfflineActionDefinition[] {
  return Array.from(definitions.values());
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
  // Dédoublonné par la `requestKey` du corps (égale à la clé de l'envoi), pas par l'en-tête.
  routeExample: "/api/missions/1/fuel-records",
  requiredFlags: ["driver-offline"],
  invalidations: ({ missionId }) => [
    ...missionQueries(missionId),
    byPath("/api/missions"),
    byPath("/api/fuel-card/balance"),
  ],
});
// `work_order_note` retiré (V5b-2b) : sa route POST n'est pas protégée par la clé d'idempotence, une
// réponse perdue produirait une note en double. Il reviendra avec sa route protégée (lot #10c).
registerOfflineAction({
  type: "odometer_reading",
  label: "Relevé kilométrique",
  method: "PUT",
  routeExample: "/api/vehicles/1/mileage",
  invalidations: () => [byPath("/api/vehicles")],
});
