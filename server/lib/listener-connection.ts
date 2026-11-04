/**
 * Chaîne de connexion de `listenerPool` (LISTEN temps réel, verrous consultatifs de sauvegarde
 * et de purge) : `DATABASE_URL_LISTENER`, puis `DATABASE_URL_DIRECT`, puis `DATABASE_URL` sans
 * le suffixe `-pooler.` de Neon (LISTEN et verrous de session exigent une connexion directe).
 *
 * En test (`NODE_ENV=test`), elle doit viser la même base que `DATABASE_URL` : sinon un test
 * écoute ou verrouille ailleurs, sur une autre base de test voire la production, sans le
 * savoir (#298). Le message ne cite que les variables, jamais une URL ni un mot de passe.
 */
export function deriveDirectConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.hostname.includes("-pooler.")) {
      url.hostname = url.hostname.replace("-pooler.", ".");
    }
    return url.toString();
  } catch {
    return connectionString;
  }
}

/** Même serveur et même base (hôte direct, port, nom de base) ; une URL illisible ne correspond à rien. */
export function sameDatabase(a: string, b: string): boolean {
  try {
    const left = new URL(deriveDirectConnectionString(a));
    const right = new URL(deriveDirectConnectionString(b));
    return (
      left.hostname === right.hostname &&
      (left.port || "5432") === (right.port || "5432") &&
      left.pathname === right.pathname
    );
  } catch {
    return false;
  }
}

export function resolveListenerConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const main = env.DATABASE_URL ?? "";
  const variable = env.DATABASE_URL_LISTENER ? "DATABASE_URL_LISTENER" : env.DATABASE_URL_DIRECT ? "DATABASE_URL_DIRECT" : null;
  const listener = variable ? (env[variable] as string) : deriveDirectConnectionString(main);
  if (env.NODE_ENV === "test" && variable && !sameDatabase(listener, main)) {
    throw new Error(
      `Connexion refusée : en test, ${variable} vise une autre base que DATABASE_URL. ` +
        "Le temps réel et les verrous consultatifs y seraient pris à l'insu des tests. " +
        "Retirez la variable ou faites-la pointer sur la base de test.",
    );
  }
  return listener;
}
