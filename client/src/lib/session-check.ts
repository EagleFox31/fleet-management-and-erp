import type { User } from "./auth";

/**
 * Seul un 401 signifie « pas de session ». Un délai dépassé, un réseau coupé ou
 * une 5xx disent seulement que le serveur n'a pas répondu : renvoyer alors vers
 * la connexion déconnectait l'utilisateur à chaque lenteur.
 */
/**
 * Reprise hors ligne accordée par le marqueur `offline-resume` : ni rôle, ni nom, ni email. `profile`
 * est l'identifiant d'un profil de lecture (`OfflineReadProfile.id`), `expiresAt` la fin de la lecture.
 */
export interface OfflineGrantInfo {
  userId: number;
  profile: string;
  expiresAt: number;
}

export type SessionCheck =
  // `httpStatus` présent : le serveur a répondu (403, 5xx), le réseau n'est pas en cause.
  // Absent : réseau coupé ou délai dépassé, seul cas où la lecture hors ligne peut reprendre.
  | { status: "authenticated"; user: User }
  | { status: "anonymous" }
  // `resumed` : réseau coupé et lecture hors ligne rouverte depuis le marqueur (jamais de User).
  | { status: "unreachable"; httpStatus?: number; resumed?: OfflineGrantInfo };

export const SESSION_CHECK_TIMEOUT_MS = 10_000;

function isUserPayload(body: unknown): body is User {
  if (body === null || typeof body !== "object") return false;
  const id = (body as { id?: unknown }).id;
  return typeof id === "number" && Number.isInteger(id) && id > 0;
}

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
    // Une redirection (portail captif) ou une 200 qui n'est pas du JSON est une réponse HTTP, pas un
    // réseau coupé : jamais de restauration hors ligne sur elle.
    if (response.redirected) return { status: "unreachable", httpStatus: response.status };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { status: "unreachable", httpStatus: response.status };
    }
    // Un 200 JSON qui n'est pas un utilisateur (`{}`, `null`, id absent ou non entier > 0) est traité comme un
    // 200 non JSON : réponse HTTP inexploitable, jamais `authenticated` (useAuth ferait `setUser({})`) et jamais
    // de restauration hors ligne (`httpStatus` présent).
    if (!isUserPayload(body)) return { status: "unreachable", httpStatus: response.status };
    return { status: "authenticated", user: body };
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
