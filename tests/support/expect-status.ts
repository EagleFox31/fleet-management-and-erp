import { expect } from "vitest";

/**
 * Assertion de statut HTTP qui porte le corps de la réponse en message : un échec, même
 * intermittent en CI, dit lui-même s'il s'agit d'un 401, d'un 403, d'un 404 de drapeau ou
 * d'un 500 et avec quel message. Rend la réponse pour enchaîner sur son corps.
 *
 *   const r = expectStatus(await session.call("GET", path, { actor: "admin" }), 200);
 */
export function expectStatus<R extends { status: number; body?: unknown }>(response: R, expected: number, label?: string): R {
  expect(response.status, `${label ? `${label} : ` : ""}${describeResponseBody(response.body)}`).toBe(expected);
  return response;
}

const MAX_BODY_CHARS = 2000;

/** Corps lisible en message d'échec, tronqué au-delà de `MAX_BODY_CHARS`, sans jamais lever. */
export function describeResponseBody(body: unknown): string {
  let text: string;
  try {
    text = typeof body === "string" ? body : (JSON.stringify(body) ?? String(body));
  } catch {
    text = String(body);
  }
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… (${text.length} caractères)` : text;
}
