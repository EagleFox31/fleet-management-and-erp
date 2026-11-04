/**
 * Source unique : reconnaître une URL de connexion qui vise la base de production.
 *
 * Une base est « production » quand son hôte contient l'un des marqueurs :
 *  - `DEFAULT_PRODUCTION_MARKERS` (endpoint Neon de production connu) ;
 *  - ceux de `E2E_PRODUCTION_DB_MARKERS` (liste séparée par des virgules), pour un
 *    autre environnement ou un autre fournisseur, sans toucher au code.
 *
 * Consommateurs : garde Playwright et vitest (`e2e/helpers/production-guard.ts`), garde du
 * serveur hors production (`server/lib/production-db-guard.ts`). Fonctions pures, sans `node:*`.
 */
export const DEFAULT_PRODUCTION_MARKERS: readonly string[] = ["ep-bitter-term-ai6i3ey4"];

export function productionMarkers(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.E2E_PRODUCTION_DB_MARKERS ?? "")
    .split(",")
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_PRODUCTION_MARKERS.map((m) => m.toLowerCase()), ...extra]));
}

/** Hôte d'une URL de connexion, sans `new URL` (mot de passe avec caractères spéciaux). */
export function hostOf(databaseUrl: string): string {
  const authority = databaseUrl.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split(/[/?#]/)[0] ?? "";
  const at = authority.lastIndexOf("@");
  // Sans `user@`, l'autorité est déjà l'hôte (éventuellement suivi d'un port) : ne jamais
  // renvoyer "", sinon une URL sans identifiants passerait pour une base inconnue.
  return (at < 0 ? authority : authority.slice(at + 1)).toLowerCase();
}

/** Marqueur de production trouvé dans l'hôte de l'URL, ou `null`. */
export function matchProductionMarker(
  databaseUrl: string | undefined,
  markers: readonly string[],
): string | null {
  if (!databaseUrl) return null;
  const host = hostOf(databaseUrl);
  if (!host) return null;
  return markers.find((m) => host.includes(m.toLowerCase())) ?? null;
}
