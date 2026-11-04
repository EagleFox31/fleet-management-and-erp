/**
 * Compte administrateur créé au premier démarrage, sur une base sans utilisateur.
 *
 * En production, une base vide est le chemin normal (serveur de site, VPS) : le compte historique
 * `admin` / `admin123` y serait un accès connu de tous. Hors développement et test, l'administrateur
 * initial n'est donc créé qu'avec `ADMIN_INITIAL_PASSWORD` (12 caractères minimum), jamais journalisé.
 * Comme pour le secret de session (#243), tout `NODE_ENV` hors liste est traité comme la production.
 */

export const INITIAL_ADMIN_USERNAME = "admin";
export const INITIAL_ADMIN_MIN_LENGTH = 12;
/** Mot de passe historique, public : permis seulement en développement et en test. */
export const DEV_INITIAL_ADMIN_PASSWORD = "admin123";
const DEV_ENVS: readonly string[] = ["development", "test"];

type Env = Readonly<Record<string, string | undefined>>;

export type InitialAdminPlan =
  | { create: true; username: string; password: string; source: "env" | "dev-default" }
  | { create: false; reason: string };

export function planInitialAdmin(env: Env): InitialAdminPlan {
  const provided = env.ADMIN_INITIAL_PASSWORD ?? "";
  const isDev = DEV_ENVS.includes(env.NODE_ENV ?? "");

  if (provided.trim().length >= INITIAL_ADMIN_MIN_LENGTH) {
    return { create: true, username: INITIAL_ADMIN_USERNAME, password: provided, source: "env" };
  }
  if (isDev && provided === "") {
    return { create: true, username: INITIAL_ADMIN_USERNAME, password: DEV_INITIAL_ADMIN_PASSWORD, source: "dev-default" };
  }
  const problem =
    provided === ""
      ? "ADMIN_INITIAL_PASSWORD absent"
      : `ADMIN_INITIAL_PASSWORD trop court (minimum ${INITIAL_ADMIN_MIN_LENGTH} caractères)`;
  return {
    create: false,
    reason:
      `${problem} : aucun compte administrateur créé. Définir ADMIN_INITIAL_PASSWORD puis redémarrer ` +
      `(compte « ${INITIAL_ADMIN_USERNAME} »), voir docs/deploiement/vps.md.`,
  };
}
