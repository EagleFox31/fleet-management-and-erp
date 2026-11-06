/**
 * Contrôle commun d'une réponse d'erreur (AGENTS.md §10), partagé par les contrats
 * (Vitest) et les e2e (Playwright). Indépendant du framework : renvoie la liste des
 * écarts, que chaque appelant vérifie avec son propre `expect(...).toEqual([])`.
 */
import { codeForStatus } from "../../shared/errors";

/** Détail technique interdit dans une réponse d'erreur : SQL, pile, validation brute. */
export const TECHNICAL = /SQLSTATE|violates|duplicate key|invalid input syntax|foreign key|constraint|at \S+:\d+|ZodError|"path":|\binvalid_type\b/i;

/**
 * Texte d'un corps de réponse à contrôler contre une fuite technique, sans le `requestId`.
 * Celui-ci est aléatoire (`nanoid(10)`, repris dans « Référence : … » des 5xx) : il contient
 * parfois « Sql », « NaN » ou « select », et un contrôle sur le corps entier échoue au hasard.
 */
export function leakText(body: unknown): string {
  const text = typeof body === "string" ? body : JSON.stringify(body) ?? "";
  let requestId: unknown;
  try {
    requestId = (typeof body === "string" ? JSON.parse(body) : body as { requestId?: unknown })?.requestId;
  } catch {
    requestId = undefined;
  }
  return typeof requestId === "string" && requestId.length > 0 ? text.split(requestId).join("") : text;
}

/**
 * Écarts entre une réponse et le contrat ApiErrorBody : statut attendu, `code` du statut
 * (`codeForStatus`, sauf `code` explicite), message lisible non vide, rien de technique.
 * `body` accepte le corps déjà décodé ou le texte brut de la réponse.
 *
 * `requestId` : toujours exigé dans le corps (chaîne non vide), c'est la référence que
 * l'utilisateur donne au support. `requestIdHeader` est la valeur de l'en-tête `X-Request-Id`
 * de la réponse (`null` s'il manque) ; omis, l'en-tête n'est pas comparé.
 */
export function apiErrorProblems(
  status: number,
  body: unknown,
  expectedStatus: number,
  code: string = codeForStatus(expectedStatus),
  requestIdHeader?: string | null,
): string[] {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const problems: string[] = [];
  if (status !== expectedStatus) problems.push(`statut ${status} au lieu de ${expectedStatus} : ${text}`);
  let parsed: { message?: unknown; code?: unknown; requestId?: unknown } | undefined;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      problems.push(`corps non JSON : ${text}`);
    }
  } else {
    parsed = body as typeof parsed;
  }
  if (parsed === null || typeof parsed !== "object") {
    if (parsed !== undefined || typeof body !== "string") problems.push(`corps absent : ${text}`);
  } else {
    if (typeof parsed.message !== "string" || parsed.message.length === 0) problems.push(`message absent ou vide : ${text}`);
    if (parsed.code !== code) problems.push(`code ${String(parsed.code)} au lieu de ${code}`);
    if (typeof parsed.requestId !== "string" || parsed.requestId.trim().length === 0) {
      problems.push(`requestId absent ou vide : ${text}`);
    } else if (requestIdHeader === null) {
      problems.push("en-tête X-Request-Id absent de la réponse");
    } else if (requestIdHeader !== undefined && requestIdHeader !== parsed.requestId) {
      problems.push(`requestId ${parsed.requestId} différent de l'en-tête X-Request-Id ${requestIdHeader}`);
    }
  }
  if (TECHNICAL.test(leakText(body))) problems.push(`détail technique dans la réponse : ${text}`);
  return problems;
}

/**
 * `message` et `code` d'un corps de réponse décodé (`undefined` s'ils manquent), pour comparer
 * deux réponses d'erreur champ à champ sans supposer la forme d'un corps typé `unknown`.
 */
export function errorFields(body: unknown): { message: unknown; code: unknown } {
  if (body === null || typeof body !== "object") return { message: undefined, code: undefined };
  return {
    message: "message" in body ? body.message : undefined,
    code: "code" in body ? body.code : undefined,
  };
}

/** `message` d'une réponse d'erreur sans le `requestId` (« Référence : … » des 5xx) : base des contrôles de fuite sur le message seul. */
export function messageText(body: { message?: unknown; requestId?: unknown } | null | undefined): string {
  const message = typeof body?.message === "string" ? body.message : "";
  return typeof body?.requestId === "string" && body.requestId.length > 0 ? message.split(body.requestId).join("") : message;
}
