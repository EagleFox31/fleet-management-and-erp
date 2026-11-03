/**
 * Secret de signature des sessions (`express-session`).
 *
 * Quiconque connaît le secret peut forger un cookie de session valide. En production, le serveur
 * refuse donc de démarrer sans un secret propre : absent, trop court ou égal à une valeur publique
 * (repli historique du code, exemple de `.env.example`). Le repli n'est permis que pour un
 * `NODE_ENV` explicitement de développement ou de test (liste d'autorisation) : Express sert le build
 * de production dès que `NODE_ENV` n'est pas `development` (`server/index.ts`), donc `Production`,
 * `staging` ou une variable absente sont traités comme la production.
 */

/** Seuls environnements où le repli de développement est permis. Comparaison exacte. */
export const SESSION_SECRET_FALLBACK_ENVS: readonly string[] = ["development", "test"];

export const SESSION_SECRET_MIN_LENGTH = 32;

/** Repli de développement. Public (il figure dans le dépôt) : jamais accepté en production. */
export const DEV_FALLBACK_SESSION_SECRET = "YaroFleetOSSecretKey";

/** Valeurs publiées dans le dépôt, refusées en production même si elles atteignaient la longueur. */
const PUBLIC_SESSION_SECRETS = new Set([DEV_FALLBACK_SESSION_SECRET, "change-me-in-dev"]);

export class SessionSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionSecretError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;
type Warn = (message: string) => void;

const HOW_TO_FIX =
  `Définir SESSION_SECRET dans l'environnement du serveur, au moins ${SESSION_SECRET_MIN_LENGTH} caractères aléatoires ` +
  `propres à cet environnement, par exemple : node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`;

/**
 * Rend le secret à utiliser, ou lève `SessionSecretError` en production si le secret ne protège pas
 * les sessions. Le message ne contient jamais la valeur du secret.
 */
export function resolveSessionSecret(env: Env, warn: Warn): string {
  // Le secret signe avec sa valeur brute : la rogner changerait la clé d'un secret actuel qui contient
  // des espaces et invaliderait toutes les sessions en cours. Le rognage ne sert qu'à le mesurer.
  const raw = env.SESSION_SECRET ?? "";
  const secret = raw.trim();
  const isProduction = !SESSION_SECRET_FALLBACK_ENVS.includes(env.NODE_ENV ?? "");

  let problem: string | null = null;
  if (secret === "") problem = "SESSION_SECRET est absent";
  else if (PUBLIC_SESSION_SECRETS.has(secret)) problem = "SESSION_SECRET vaut une valeur publique du dépôt";
  else if (secret.length < SESSION_SECRET_MIN_LENGTH)
    problem = `SESSION_SECRET est trop court (${secret.length} caractères, minimum ${SESSION_SECRET_MIN_LENGTH})`;

  if (problem === null) return raw;

  if (isProduction) {
    throw new SessionSecretError(
      `Démarrage refusé (NODE_ENV=${env.NODE_ENV ?? "absent"}, traité comme la production) : ${problem}. ${HOW_TO_FIX}.`,
    );
  }

  if (secret === "") {
    warn(`${problem} : repli sur le secret de développement, public. Interdit en production. ${HOW_TO_FIX}.`);
    return DEV_FALLBACK_SESSION_SECRET;
  }
  warn(`${problem} : accepté hors production seulement. ${HOW_TO_FIX}.`);
  return raw;
}
