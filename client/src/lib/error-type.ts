/**
 * Famille d'une erreur affichée par `AnimatedError` (titre, icône, conseils).
 *
 * 401 et 403 ne disent pas la même chose : 401, la session manque (se reconnecter
 * règle le problème) ; 403, la session est valide mais le profil n'a pas le droit
 * (se reconnecter n'y change rien). Les confondre envoyait vers « Reconnectez-vous »
 * un utilisateur bien connecté.
 */
export type ErrorType = "network" | "auth" | "permission" | "validation" | "server" | "timeout" | "general";

export function errorTypeOf(error: unknown): ErrorType {
  const e = (error ?? {}) as { status?: number; name?: string };
  if (e.status === 401) return "auth";
  if (e.status === 403) return "permission";
  if (e.status === 400 || e.status === 422) return "validation";
  if (typeof e.status === "number" && e.status >= 500) return "server";
  if (e.name === "NetworkError") return "network";
  if (e.name === "TimeoutError") return "timeout";
  return "general";
}
