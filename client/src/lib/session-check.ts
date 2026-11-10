import type { User } from "./auth";

/**
 * Seul un 401 signifie « pas de session ». Un délai dépassé, un réseau coupé ou
 * une 5xx disent seulement que le serveur n'a pas répondu : renvoyer alors vers
 * la connexion déconnectait l'utilisateur à chaque lenteur.
 */
export type SessionCheck =
  // `httpStatus` présent : le serveur a répondu (403, 5xx), le réseau n'est pas en cause.
  // Absent : réseau coupé ou délai dépassé, seul cas où la lecture hors ligne peut reprendre.
  | { status: "authenticated"; user: User }
  | { status: "anonymous" }
  | { status: "unreachable"; httpStatus?: number };

export const SESSION_CHECK_TIMEOUT_MS = 10_000;

export async function checkSession(
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SESSION_CHECK_TIMEOUT_MS,
): Promise<SessionCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl("/api/auth/me", { credentials: "include", signal: controller.signal });
    if (response.status === 401) return { status: "anonymous" };
    if (!response.ok) return { status: "unreachable", httpStatus: response.status };
    return { status: "authenticated", user: (await response.json()) as User };
  } catch {
    return { status: "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

/** Délai avant la tentative suivante : 1 s, 2 s, 4 s, 8 s, puis 10 s. */
export function nextSessionRetryDelay(attempt: number): number {
  return Math.min(1_000 * 2 ** Math.max(attempt - 1, 0), 10_000);
}
