/**
 * Garde-fou du seed de démo, sans dépendance à la base : testable seul.
 * Le .env racine peut viser la production, le seed ne doit écrire que sur une base locale jetable.
 */

/** Hôtes acceptés : base locale ou conteneur Docker du compose de test. */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);

/** `fleet_test`, ou une base dédiée `fleet_test_<suffixe>` créée par une session sur le même conteneur. */
const LOCAL_DATABASE_PATH = /^\/fleet_test(_[a-z0-9_]+)?$/;

/** Refuse toute base autre que `fleet_test[_<suffixe>]` sur un hôte local. */
export function assertLocalDatabase(rawUrl: string | undefined = process.env.DATABASE_URL): void {
  let ok = false;
  try {
    const url = new URL(rawUrl ?? "");
    // host / hostaddr en paramètre de requête remplacent l'hôte de l'URL côté libpq.
    const redirected = url.searchParams.has("host") || url.searchParams.has("hostaddr");
    ok = !redirected && LOCAL_HOSTS.has(url.hostname) && LOCAL_DATABASE_PATH.test(url.pathname);
  } catch {
    ok = false;
  }
  if (!ok) throw new Error("Seed de démo refusé : DATABASE_URL doit viser une base locale fleet_test (ou fleet_test_<suffixe>).");
}
