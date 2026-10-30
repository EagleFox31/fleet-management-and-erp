/** Garde commune au seed et au reset de recette : variable d'environnement ET hôte autorisé. */
export class RecetteGuardError extends Error {}

export function assertRecetteEnvironment(env: NodeJS.ProcessEnv = process.env): { host: string } {
  if (env.APP_ENV !== "recette") {
    throw new RecetteGuardError('Refusé : APP_ENV doit valoir "recette".');
  }
  const url = env.DATABASE_URL;
  if (!url) throw new RecetteGuardError("Refusé : DATABASE_URL absente.");
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new RecetteGuardError("Refusé : DATABASE_URL illisible.");
  }
  const allowed = (env.RECETTE_DB_HOST_ALLOW ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  if (!allowed.includes(host)) {
    throw new RecetteGuardError(`Refusé : l'hôte ${host} ne figure pas dans RECETTE_DB_HOST_ALLOW.`);
  }
  return { host };
}
