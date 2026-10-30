/**
 * Captcha à la connexion (P-26), ALTCHA auto-hébergé. Drapeau `captcha`.
 *
 * Exigé à partir de `CAPTCHA_AFTER_FAILED_ATTEMPTS` échecs sur un nom
 * d'utilisateur. Preuve absente ou invalide : 400 `VALIDATION` sur le champ
 * `captcha`.
 */
import { z } from "zod";

export { CAPTCHA_AFTER_FAILED_ATTEMPTS } from "./auth-lockout";

export const AUTH_CHALLENGE_PATH = "/api/auth/challenge";

/** Défi ALTCHA tel que le widget l'attend ; le contenu est produit par `altcha-lib`. */
export const authChallengeResponseSchema = z.object({
  algorithm: z.string(),
  challenge: z.string(),
  salt: z.string(),
  signature: z.string(),
  maxnumber: z.number().int().optional(),
});

/** Champ ajouté au corps de `POST /api/auth/login` et `/api/auth/pin-login`. */
export const captchaFieldSchema = z.object({ captcha: z.string().min(1).max(4000).optional() });

export const CAPTCHA_FIELD = "captcha";

export type AuthChallengeResponse = z.infer<typeof authChallengeResponseSchema>;
