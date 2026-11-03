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


// Le secret de session relève de server/lib/session-secret.ts (#243), pas de ce module.
