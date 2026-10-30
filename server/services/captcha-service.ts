import { createChallenge, verifySolution } from "altcha-lib/v1";
import type { AuthChallengeResponse } from "@shared/contracts/auth-captcha";
import { AppError } from "../lib/app-error";

/** Validité d'un défi : assez long pour résoudre la preuve, assez court pour limiter la réutilisation. */
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_NUMBER = 100_000;

function hmacKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.ALTCHA_HMAC_KEY || env.SESSION_SECRET;
  if (!key) throw new AppError(500, "Le captcha n'est pas configuré.", { cause: "ALTCHA_HMAC_KEY et SESSION_SECRET absents" });
  return key;
}

export async function issueCaptchaChallenge(now: Date = new Date()): Promise<AuthChallengeResponse> {
  const challenge = await createChallenge({
    hmacKey: hmacKey(),
    maxnumber: MAX_NUMBER,
    expires: new Date(now.getTime() + CHALLENGE_TTL_MS),
  });
  return challenge;
}

/** Preuve ALTCHA valide (signature et expiration). Ne lève jamais : toute erreur de lecture donne false. */
export async function verifyCaptchaPayload(payload: unknown): Promise<boolean> {
  if (typeof payload !== "string" || payload.length === 0) return false;
  try {
    return await verifySolution(payload, hmacKey(), true);
  } catch (err) {
    if (err instanceof AppError) throw err;
    return false;
  }
}
