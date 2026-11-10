import type { FeatureKey } from "@shared/feature-flags";
import type { ApiErrorCode } from "@shared/errors";

/**
 * Routes d'écriture rejouables sans doublon : la liste et ses utilitaires vivent dans
 * `shared/idempotency-routes.ts` (lue aussi par la file hors ligne du client). Ce module les
 * ré-exporte : aucun changement de comportement serveur.
 */
export {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_REPLAYED_HEADER,
  IDEMPOTENCY_RETENTION_DAYS,
  IDEMPOTENCY_STALE_SECONDS,
  IDEMPOTENCY_ROUTES,
  OFFLINE_OWNER_HEADER,
  type IdempotencyRoute,
} from "@shared/idempotency-routes";

/**
 * Drapeau serveur du garde et de la purge, indépendant du rôle. Les drapeaux d'écran
 * (`technician-offline`, `driver-offline`) ne gouvernent que l'interface et l'exigent.
 */
export const IDEMPOTENCY_FLAG: FeatureKey = "offline-writes";


/**
 * Délai au-delà duquel une clé restée `in_progress` (serveur arrêté pendant l'écriture) est
 * reprise, sauf route à `staleSeconds: null`. Sans risque pour mission et kilométrage : un
 * kilométrage se réécrit à l'identique et une transition déjà faite est refusée par la machine d'états.
 */

/**
 * Statuts conservés et rejoués. Les 5xx et les refus liés à la session ou au débit
 * (401, 403, 408, 429) sont libérés : le client doit pouvoir réessayer avec la même clé.
 * Ces refus sont prononcés avant toute écriture : la clé est libérée même sur une route qui la garde.
 */
export const PRE_WRITE_REFUSALS: readonly number[] = [401, 403, 408, 429];

/**
 * Refus métier prononcés avant toute écriture, reconnus au `code` du corps d'erreur : libérés comme
 * `PRE_WRITE_REFUSALS`. `VEHICLE_RETIRED` (L3) : une fois le véhicule restauré, la même clé doit écrire. Déclaration de panne (V5b-1b) :
 * `INCIDENT_WRITE_FAILED` (transaction échouée, rien de validé) et `INCIDENT_VEHICLE_NOT_FOUND`.
 */
export const PRE_WRITE_REFUSAL_CODES: readonly ApiErrorCode[] = ["VEHICLE_RETIRED", "INCIDENT_WRITE_FAILED", "INCIDENT_VEHICLE_NOT_FOUND"];

/** Vrai si la réponse est un refus prononcé avant toute écriture : la clé est libérée, jamais rejouée. */
export function isPreWriteRefusal(status: number, body?: unknown): boolean {
  if (PRE_WRITE_REFUSALS.includes(status)) return true;
  if (status < 400 || typeof body !== "object" || body === null) return false;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" && (PRE_WRITE_REFUSAL_CODES as readonly string[]).includes(code);
}

export function isReplayableStatus(status: number, body?: unknown): boolean {
  return status >= 200 && status < 500 && !isPreWriteRefusal(status, body);
}
