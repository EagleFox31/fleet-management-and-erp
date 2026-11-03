/**
 * Options du cookie de session.
 *
 * - Production derrière HTTPS (VPS, APK Capacitor) : `secure` + `sameSite: none`, inchangé.
 * - Serveur de site sur le LAN (`APP_URL` en `http://`) : un cookie `secure` serait refusé
 *   par le navigateur en HTTP, la connexion échouerait sans message. On passe donc en
 *   `secure: false` + `sameSite: lax` (même origine, pas de cross-site possible en HTTP).
 */
export interface SessionCookieFlags {
  secure: boolean;
  sameSite: "none" | "lax";
}

export function sessionCookieFlags(env: NodeJS.ProcessEnv = process.env): SessionCookieFlags {
  const servedOverHttp = /^http:\/\//i.test(env.APP_URL ?? "");
  const crossSite = !servedOverHttp && (env.ALLOW_CROSS_SITE_COOKIES === "true" || env.NODE_ENV === "production");
  return crossSite ? { secure: true, sameSite: "none" } : { secure: false, sameSite: "lax" };
}

/** Ancienne valeur par défaut, publique (présente dans l'historique du dépôt) : jamais acceptée en production. */
const PUBLIC_DEFAULT_SECRET = "YaroFleetOSSecretKey";

/**
 * Secret de session. En production, absent ou égal à l'ancienne valeur publique : le serveur
 * refuse de démarrer (sinon n'importe qui pourrait signer un cookie de session).
 * Hors production, repli sur l'ancienne valeur pour ne pas gêner le développement local.
 */
export function requireSessionSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.SESSION_SECRET?.trim();
  if (env.NODE_ENV === "production" && (!secret || secret === PUBLIC_DEFAULT_SECRET)) {
    throw new Error("SESSION_SECRET manquant : le serveur refuse de démarrer en production (voir docs/deploiement/vps.md).");
  }
  return secret || PUBLIC_DEFAULT_SECRET;
}
