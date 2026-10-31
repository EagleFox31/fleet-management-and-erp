import { lockedResponseSchema } from "@shared/contracts/auth-lockout";
import { CAPTCHA_FIELD } from "@shared/contracts/auth-captcha";
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

/**
 * Vrai quand le serveur exige la preuve captcha (400 `VALIDATION` sur le champ
 * `captcha`, contrat `auth-captcha`). N'arrive que drapeau `captcha` allumé.
 */
export function captchaRequiredOf(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 400) return false;
  return (error.fieldErrors ?? []).some((f) => f.field === CAPTCHA_FIELD);
}

export type LoginFailure =
  | { kind: "locked"; message: string }
  | { kind: "captcha"; message: string }
  | { kind: "other"; message: null };

export const CAPTCHA_REQUIRED_MESSAGE = "Confirmez que vous n'êtes pas un robot pour continuer.";

/**
 * Lecture d'un refus de connexion (mot de passe ou PIN) à partir de la réponse réelle :
 * verrouillage (429), captcha exigé (400 sur `captcha`), sinon `other` et l'appelant
 * garde son message habituel (identifiants incorrects).
 */
export function loginFailureOf(error: unknown): LoginFailure {
  const locked = lockoutMessageOf(error);
  if (locked) return { kind: "locked", message: locked };
  if (captchaRequiredOf(error)) return { kind: "captcha", message: CAPTCHA_REQUIRED_MESSAGE };
  return { kind: "other", message: null };
}
