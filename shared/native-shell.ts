/**
 * Coquille native (APK FleetOS Tech) : l'APK charge l'application servie par le serveur
 * (`server.url` de Capacitor) au lieu d'un bundle figé dans l'APK. Même origine que la PWA :
 * cookie de session, `/api`, `/ws` et fichiers téléversés fonctionnent sans CORS ni cookie tiers,
 * et l'application suit chaque déploiement sans nouvelle APK.
 *
 * L'origine vient de la variable de build `CAP_SERVER_URL` (variable de dépôt `FLEETOS_APP_URL`
 * dans le workflow). Absente : bundle local, comme avant (développement).
 * Choix et limites : `docs/deploiement/android-apk.md`.
 */

export type NativeServer = { url: string; cleartext: boolean };

/** Page affichée par Capacitor quand l'origine ne répond pas (chemin relatif à `webDir`). */
export const NATIVE_OFFLINE_PAGE = "offline.html";

/**
 * Lit l'origine du serveur. Vide : `null` (bundle local). Refuse un chemin, une requête,
 * des identifiants ou un schéma autre que http(s), avec un message qui dit quoi corriger.
 */
export function resolveNativeServer(raw: string | undefined): NativeServer | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`CAP_SERVER_URL illisible : « ${value} ». Attendu : une origine, par exemple https://fleet.example.com`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`CAP_SERVER_URL doit commencer par https:// (reçu ${parsed.protocol}).`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("CAP_SERVER_URL ne doit pas contenir d'identifiants.");
  }
  if ((parsed.pathname !== "/" && parsed.pathname !== "") || parsed.search || parsed.hash) {
    throw new Error(`CAP_SERVER_URL doit être une origine seule, sans chemin ni paramètre (reçu ${value}).`);
  }
  // HTTP en clair seulement pour un serveur de test sur le réseau local, jamais pour la prod.
  return { url: parsed.origin, cleartext: parsed.protocol === "http:" };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/**
 * Page hors ligne embarquée dans l'APK. Sur Android elle n'a pas accès aux plugins : un simple
 * lien vers l'origine relance l'application quand le réseau revient.
 */
export function renderNativeOfflinePage(server: NativeServer): string {
  const href = escapeHtml(server.url + "/");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FleetOS Tech</title>
<style>
  :root { color-scheme: light dark; --bg: #f8fafc; --fg: #0f172a; --muted: #475569; --accent: #059669; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f172a; --fg: #f1f5f9; --muted: #94a3b8; } }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: var(--bg); color: var(--fg); font-family: system-ui, sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 360px; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 8px; }
  p { color: var(--muted); margin: 0 0 24px; line-height: 1.5; }
  a { display: inline-block; background: var(--accent); color: #fff; text-decoration: none;
      padding: 12px 24px; border-radius: 8px; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Serveur injoignable</h1>
  <p>FleetOS Tech n'arrive pas à joindre le serveur. Vérifiez la connexion du téléphone, puis réessayez.</p>
  <a href="${href}" data-testid="native-offline-retry">Réessayer</a>
</main>
</body>
</html>
`;
}
