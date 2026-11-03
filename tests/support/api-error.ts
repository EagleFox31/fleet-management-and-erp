/**
 * Contrôle commun d'une réponse d'erreur (AGENTS.md §10), partagé par les contrats
 * (Vitest) et les e2e (Playwright). Indépendant du framework : renvoie la liste des
 * écarts, que chaque appelant vérifie avec son propre `expect(...).toEqual([])`.
 */
import { codeForStatus } from "../../shared/errors";

/** Détail technique interdit dans une réponse d'erreur : SQL, pile, validation brute. */
export const TECHNICAL = /SQLSTATE|violates|duplicate key|invalid input syntax|foreign key|constraint|at \S+:\d+|ZodError|"path":|\binvalid_type\b/i;

/**
 * Écarts entre une réponse et le contrat ApiErrorBody : statut attendu, `code` du statut
 * (`codeForStatus`, sauf `code` explicite), message lisible non vide, rien de technique.
 * `body` accepte le corps déjà décodé ou le texte brut de la réponse.
 */
export function apiErrorProblems(status: number, body: unknown, expectedStatus: number, code: string = codeForStatus(expectedStatus)): string[] {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const problems: string[] = [];
  if (status !== expectedStatus) problems.push(`statut ${status} au lieu de ${expectedStatus} : ${text}`);
  let parsed: { message?: unknown; code?: unknown } | undefined;
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
  }
  if (TECHNICAL.test(text)) problems.push(`détail technique dans la réponse : ${text}`);
  return problems;
}
