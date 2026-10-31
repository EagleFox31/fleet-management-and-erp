import { lockedResponseSchema } from "@shared/contracts/auth-lockout";
import { ApiError } from "@/lib/api-error";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** « 14:35 » à l'heure locale. */
export function formatLockTime(lockedUntil: string): string | null {
  const date = new Date(lockedUntil);
  if (Number.isNaN(date.getTime())) return null;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Message de connexion refusée par verrouillage (429 `RATE_LIMITED` du contrat
 * `auth-lockout`). `null` si l'erreur n'est pas un verrouillage : l'appelant
 * garde alors son message habituel.
 */
export function lockoutMessageOf(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  const parsed = lockedResponseSchema.safeParse(error.body);
  if (!parsed.success) return null;
  const time = formatLockTime(parsed.data.lockedUntil);
  return time ? `Compte verrouillé jusqu'à ${time}.` : "Compte verrouillé. Réessayez plus tard.";
}
