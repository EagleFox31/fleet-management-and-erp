import type { RequestHandler } from "express";
import { CAPTCHA_AFTER_FAILED_ATTEMPTS, CAPTCHA_FIELD } from "@shared/contracts/auth-captcha";
import { AppError } from "../lib/app-error";
import { isFeatureEnabled } from "../lib/feature-flags";
import { verifyCaptchaPayload } from "../services/captcha-service";

export interface CaptchaGuardOptions {
  /** Nombre d'échecs récents pour ce nom d'utilisateur (compteur du verrouillage, T-12). */
  getFailedCount: (username: string) => Promise<number>;
  usernameField?: string;
  threshold?: number;
}

/**
 * Intercepteur de connexion (P-26) : à partir de `threshold` échecs, le corps doit porter une
 * preuve ALTCHA valide, sinon 400 `VALIDATION` sur le champ `captcha`. Sans effet quand le
 * drapeau `captcha` est coupé. À monter après le garde de verrouillage.
 */
export function captchaGuard(opts: CaptchaGuardOptions): RequestHandler {
  const field = opts.usernameField ?? "username";
  const threshold = opts.threshold ?? CAPTCHA_AFTER_FAILED_ATTEMPTS;
  return async (req, _res, next) => {
    try {
      if (!isFeatureEnabled("captcha")) return next();
      const username = String(req.body?.[field] ?? "").trim().toLowerCase();
      if (!username) return next();
      if ((await opts.getFailedCount(username)) < threshold) return next();
      if (await verifyCaptchaPayload(req.body?.[CAPTCHA_FIELD])) return next();
      next(
        new AppError(400, "Confirmez que vous n'êtes pas un robot pour continuer.", {
          fieldErrors: [{ field: CAPTCHA_FIELD, message: "Vérification requise." }],
        }),
      );
    } catch (err) {
      next(err);
    }
  };
}
