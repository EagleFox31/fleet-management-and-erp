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
  /**
   * Délai de reprise d'une clé restée `in_progress`. `null` : jamais reprise (elle expire avec
   * `expires_at`). Par défaut `IDEMPOTENCY_STALE_SECONDS`. `null` pour une écriture qui ne se
   * rejoue pas à l'identique (stock) : reprendre la clé réécrirait l'ajustement.
   */
  staleSeconds?: number | null;
  /**
   * Issue incertaine (5xx, ou réponse 2xx-4xx non enregistrée) : la clé reste `in_progress` au
   * lieu d'être libérée. L'écriture a pu être validée ; un réessai avec la même clé reçoit 409,
   * jamais une seconde exécution. Seuls 401, 403, 408 et 429 (refus avant écriture) libèrent.
   */
  keepKeyOnUncertainOutcome?: boolean;
  /** Protégée même drapeau `offline-writes` coupé : l'intégrité ne dépend pas du hors-ligne. */
  ignoreFeatureFlag?: boolean;
  /** Message du 409 « clé en cours », propre à la route. */
  inProgressMessage?: string;
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
 * Lot #10b, périmètre chauffeur : statut de mission et kilométrage. Le stock (ajustement manuel)
 * ne se rejoue pas à l'identique : sa clé n'est ni reprise ni libérée sur une issue incertaine.
 * La position du chauffeur n'a pas encore de route (télémétrie, lot #6).
 */
export const IDEMPOTENCY_ROUTES: readonly IdempotencyRoute[] = [
  { method: "PUT", pattern: /^\/missions\/\d+\/status$/ },
  { method: "PUT", pattern: /^\/vehicles\/\d+\/mileage$/ },
  // Ajustement manuel de stock : un rejeu ne doit jamais réappliquer l'ajustement.
  {
    method: "POST",
    pattern: /^\/parts\/\d+\/update-stock$/,
    staleSeconds: null,
    keepKeyOnUncertainOutcome: true,
    ignoreFeatureFlag: true,
    inProgressMessage: "Opération en cours ou au résultat incertain : vérifiez le stock avant de réessayer.",
  },
];

/** Clé acceptée : 1 à 255 caractères ASCII imprimables sans espace (UUID conseillé). */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

/**
 * Délai au-delà duquel une clé restée `in_progress` (serveur arrêté pendant l'écriture) est
 * reprise, sauf route à `staleSeconds: null`. Sans risque pour mission et kilométrage : un
 * kilométrage se réécrit à l'identique et une transition déjà faite est refusée par la machine d'états.
 */
export const IDEMPOTENCY_STALE_SECONDS = 60;

/**
 * Statuts conservés et rejoués. Les 5xx et les refus liés à la session ou au débit
 * (401, 403, 408, 429) sont libérés : le client doit pouvoir réessayer avec la même clé.
 */
export function isReplayableStatus(status: number): boolean {
  return status >= 200 && status < 500 && ![401, 403, 408, 429].includes(status);
}
