import { AppError } from "./app-error";

/**
 * Contexte de journal attaché à une erreur relayée par `next(err)`.
 *
 * Règle (AGENTS.md §10) : une erreur relayée au gestionnaire central est journalisée **une seule
 * fois**, par lui (`server/middleware/error-handler.ts`), avec `requestId`, méthode, chemin,
 * utilisateur et statut. La route ne journalise pas elle-même ce qu'elle relaie : elle attache ce
 * qu'elle sait de plus (étape en échec, identifiants) par `withLogContext`, que le gestionnaire
 * fusionne dans sa ligne. Une route qui traite l'erreur sans la relayer garde son propre log.
 *
 * `event` reprend le libellé que la route écrivait auparavant : il reste cherchable dans les logs.
 */
export type ErrorLogContext = { event: string } & Record<string, unknown>;

const contexts = new WeakMap<object, ErrorLogContext>();

/**
 * Attache `context` à `error` et rend l'erreur à relayer. Une valeur non objet (`throw "x"`) est
 * enveloppée dans une `AppError` 500 dont elle devient la cause. Un second appel complète le
 * contexte sans écraser le premier `event`.
 */
export function withLogContext(error: unknown, context: ErrorLogContext): object {
  const target = error !== null && typeof error === "object" ? error : new AppError(500, "Erreur serveur", { cause: error });
  const previous = contexts.get(target);
  contexts.set(target, previous ? { ...context, ...previous } : context);
  return target;
}

/** Contexte attaché par `withLogContext`, ou `undefined`. */
export function logContextOf(error: unknown): ErrorLogContext | undefined {
  return error !== null && typeof error === "object" ? contexts.get(error) : undefined;
}
