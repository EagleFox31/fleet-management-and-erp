/**
 * Origines navigateur admises par le serveur : source unique du CORS (`server/app.ts`), du contrôle
 * anti-CSRF des écritures `/api` (`server/middleware/require-same-origin.ts`) et de l'upgrade `/ws`
 * (`server/index.ts`).
 *
 * - Les origines des coques natives (`https://localhost` pour Capacitor Android, `capacitor://localhost`
 *   pour iOS) sont toujours admises : l'APK construite sans `CAP_SERVER_URL` y charge l'interface et
 *   appelle l'API en cross-site.
 * - `APP_URL` et `CORS_ORIGIN` ajoutent les origines du déploiement.
 * - La tolérance localhost / réseaux privés (127.x, 192.168.x, 10.x, `http://localhost`) n'existe que si
 *   `NODE_ENV` vaut `development` ou `test` : refus par défaut, `NODE_ENV` absent compris. `http://localhost`
 *   n'est pas une origine d'APK (`androidScheme: 'https'`, `capacitor.config.ts`).
 */
export const NATIVE_APP_ORIGINS: readonly string[] = ["https://localhost", "capacitor://localhost"];

const LOCAL_NETWORK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/;

type OriginEnv = Record<string, string | undefined>;

/** Liste explicite, lue à l'appel pour suivre l'environnement. */
export function configuredOrigins(env: OriginEnv = process.env): string[] {
  return [...NATIVE_APP_ORIGINS, env.APP_URL, env.CORS_ORIGIN].filter((o): o is string => Boolean(o));
}

/** Tolérance localhost / réseaux privés : développement et tests seulement (refus par défaut, `NODE_ENV` absent compris). */
const isDevelopmentEnv = (env: OriginEnv) => env.NODE_ENV === "development" || env.NODE_ENV === "test";

/** Vrai si `origin` est dans la liste, ou (développement, test) sur localhost / un réseau privé. */
export function isAllowedOrigin(origin: string, env: OriginEnv = process.env): boolean {
  return configuredOrigins(env).includes(origin) || (isDevelopmentEnv(env) && LOCAL_NETWORK_ORIGIN.test(origin));
}

/** Origine égale à l'hôte ET au schéma de la requête : le site se parle à lui-même (http://hôte n'est pas https://hôte). */
export function isOriginOfHost(origin: string, host: string | undefined, secure: boolean | undefined): boolean {
  if (!host || secure === undefined) return false;
  try {
    const url = new URL(origin);
    return url.host === host && url.protocol === (secure ? "https:" : "http:");
  } catch {
    return false;
  }
}

type FetchMetadata = { origin?: string; secFetchSite?: string; host?: string; secure?: boolean };

/**
 * Décision anti-CSRF pour une requête qui écrit ou ouvre un canal authentifié par cookie.
 * - ni `Origin` ni `Sec-Fetch-Site` : client non navigateur (script, contrat), admis ;
 * - `Sec-Fetch-Site` = same-origin ou none (saisie directe) : admis ;
 * - sinon, admis seulement si `Origin` est dans la liste ou égale à l'hôte de la requête.
 */
export function isTrustedRequestOrigin({ origin, secFetchSite, host, secure }: FetchMetadata, env: OriginEnv = process.env): boolean {
  if (origin === undefined && secFetchSite === undefined) return true;
  const site = secFetchSite?.trim().toLowerCase();
  if (site === "same-origin" || site === "none") return true;
  if (origin === undefined) return false;
  return isAllowedOrigin(origin, env) || isOriginOfHost(origin, host, secure);
}
