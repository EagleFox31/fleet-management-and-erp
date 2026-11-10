/**
 * Routes d'écriture rejouables sans doublon (CDC #10, saisie hors ligne) : source unique lue par
 * le garde serveur (`server/middleware/idempotency-guard.ts`) ET par la file hors ligne du client.
 *
 * Une route s'ajoute ici, jamais dans le garde. Une route listée n'est protégée que si le client
 * envoie l'en-tête `Idempotency-Key`. Le client ne rejoue automatiquement que ce qui figure ici :
 * rejouer une écriture non protégée après une réponse perdue produirait un doublon.
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
 * En-tête posé par la file hors ligne : identifiant du compte à qui appartient l'envoi. Le serveur
 * le compare à la session (cookie partagé entre onglets) et refuse un envoi parti sous un autre compte.
 */
export const OFFLINE_OWNER_HEADER = "X-Offline-Owner";

/**
 * Délai (secondes) au-delà duquel le serveur reprend une clé restée `in_progress`. Le client attend
 * au moins ce délai, plus une marge, avant de classer un 409 « en cours » À revoir.
 */
export const IDEMPOTENCY_STALE_SECONDS = 60;

/** Clé acceptée : 1 à 255 caractères ASCII imprimables sans espace (UUID conseillé). */
export const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

/**
 * Durée de conservation d'une clé côté serveur (jours) : `idempotency_keys.expires_at`. Au-delà, un
 * rejeu avec la même clé s'exécuterait une seconde fois. Le client s'en sert pour ne plus rejouer
 * un envoi trop ancien. Le SQL (`shared/schema.ts`, `server/init-database.ts`, migration
 * `20261101_cdc_ecarts.sql`) écrit `interval '7 days'` en dur : un test unitaire compare ces trois
 * endroits à cette constante, il échoue si l'un diverge.
 */
export const IDEMPOTENCY_RETENTION_DAYS = 7;

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
  // Panne déclarée par le chauffeur (V5b-1) : un rejeu ne doit créer ni second incident ni second OT.
  // Clé jamais reprise ni libérée sur une issue incertaine : l'incident a pu être validé, un réessai
  // reçoit 409 `IDEMPOTENCY_IN_PROGRESS` ou la réponse enregistrée, jamais une seconde exécution.
  {
    method: "POST",
    pattern: /^\/driver\/breakdowns$/,
    staleSeconds: null,
    keepKeyOnUncertainOutcome: true,
    inProgressMessage: "Cette déclaration est déjà en cours d'envoi. Réessayer avec la même clé ne la dupliquera pas ; si elle ne vous est pas confirmée, vérifiez vos déclarations avant d'en refaire une.",
  },
];

/**
 * Écritures dédoublonnées par une clé du corps (`requestKey`), pas par l'en-tête : le plein de
 * carburant d'une mission. La file n'y rejoue que si `payload.requestKey` est la clé de l'envoi.
 */
export const REQUEST_KEY_ROUTES: readonly { method: IdempotencyRoute["method"]; pattern: RegExp }[] = [
  { method: "POST", pattern: /^\/missions\/\d+\/fuel-records$/ },
];

/** Chemin normalisé comme Express et le journal d'audit : sans casse, décodé, sans `/` final. */
export function normalizeIdempotencyPath(path: string): string {
  const rawPath = path.split("?")[0];
  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    // Encodage invalide : on garde le chemin brut.
  }
  return decoded.toLowerCase().replace(/\/+$/, "") || "/";
}

/** Règle de la liste qui couvre l'écriture `method path`, ou `undefined`. */
export function findIdempotentRoute(
  routes: readonly IdempotencyRoute[],
  method: string,
  path: string,
): IdempotencyRoute | undefined {
  const clean = normalizeIdempotencyPath(path);
  return routes.find((route) => route.method === method.toUpperCase() && route.pattern.test(clean));
}

/** Retire le préfixe `/api` d'un chemin de requête. */
export function stripApiPrefix(path: string): string {
  return path.replace(/^\/api(?=\/|$)/i, "");
}

/**
 * Vrai si la file peut rejouer automatiquement cette écriture : route protégée par l'en-tête
 * `Idempotency-Key`, ou plein dédoublonné par `requestKey` égal à la clé de l'envoi.
 */
export function isAutoReplayable(input: {
  method: string;
  endpoint: string;
  idempotencyKey: string;
  payload?: unknown;
}): boolean {
  if (!/^\/api\//i.test(input.endpoint)) return false;
  const path = normalizeIdempotencyPath(stripApiPrefix(input.endpoint));
  if (findIdempotentRoute(IDEMPOTENCY_ROUTES, input.method, path)) return true;
  const byBody = REQUEST_KEY_ROUTES.some((r) => r.method === input.method.toUpperCase() && r.pattern.test(path));
  if (!byBody) return false;
  const body = input.payload;
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { requestKey?: unknown }).requestKey === input.idempotencyKey
  );
}

/**
 * Vrai si (méthode, endpoint) de l'envoi relève du même motif protégé que l'exemple de route de son
 * type. Empêche un type A d'envoyer vers la route protégée d'un type B.
 */
export function sameProtectedRoute(
  send: { method: string; endpoint: string },
  example: { method: string; endpoint: string },
): boolean {
  const sendPath = normalizeIdempotencyPath(stripApiPrefix(send.endpoint));
  const examplePath = normalizeIdempotencyPath(stripApiPrefix(example.endpoint));
  const sendMethod = send.method.toUpperCase();
  if (sendMethod !== example.method.toUpperCase()) return false;
  const pattern = [...IDEMPOTENCY_ROUTES, ...REQUEST_KEY_ROUTES].find(
    (r) => r.method === sendMethod && r.pattern.test(examplePath),
  )?.pattern;
  return pattern !== undefined && pattern.test(sendPath);
}
