import type { FeatureKey } from "@shared/feature-flags";

/**
 * Routes d'écriture rejouables sans doublon (CDC #10, saisie hors ligne).
 *
 * Le garde `server/middleware/idempotency-guard.ts` applique ces règles ; une route s'ajoute
 * ici, jamais dans le garde. Une route listée n'est protégée que si le client envoie
 * l'en-tête `Idempotency-Key` : sans en-tête, la requête passe comme avant.
 */
export type IdempotencyRoute = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  /** Motif sur le chemin sans préfixe `/api`, en minuscules, par exemple `^/work-orders/\d+/time-entries$`. */
  pattern: RegExp;
};

/** En-tête portant la clé d'idempotence choisie par le client. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

/** En-tête posé sur une réponse rejouée depuis `idempotency_keys`. */
export const IDEMPOTENCY_REPLAYED_HEADER = "Idempotent-Replayed";

/**
 * Drapeau serveur du garde et de la purge, indépendant du rôle. Les drapeaux d'écran
 * (`technician-offline`, `driver-offline`) ne gouvernent que l'interface et l'exigent.
 */
export const IDEMPOTENCY_FLAG: FeatureKey = "offline-writes";

/**
 * Lot #10b, périmètre chauffeur : statut de mission et kilométrage. Aucun mouvement de stock.
 * La position du chauffeur n'a pas encore de route (télémétrie, lot #6).
 */
export const IDEMPOTENCY_ROUTES: readonly IdempotencyRoute[] = [
  { method: "PUT", pattern: /^\/missions\/\d+\/status$/ },
  { method: "PUT", pattern: /^\/vehicles\/\d+\/mileage$/ },
];

/** Clé acceptée : 1 à 255 caractères ASCII imprimables sans espace (UUID conseillé). */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

/**
 * Délai au-delà duquel une clé restée `in_progress` (serveur arrêté pendant l'écriture) est
 * reprise. Sans risque pour les routes listées : un kilométrage se réécrit à l'identique et
 * une transition de mission déjà faite est refusée par la machine d'états.
 */
export const IDEMPOTENCY_STALE_SECONDS = 60;

/**
 * Statuts conservés et rejoués. Les 5xx et les refus liés à la session ou au débit
 * (401, 403, 408, 429) sont libérés : le client doit pouvoir réessayer avec la même clé.
 */
export function isReplayableStatus(status: number): boolean {
  return status >= 200 && status < 500 && ![401, 403, 408, 429].includes(status);
}
