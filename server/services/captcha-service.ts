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

/** Memoire des preuves deja acceptees (anti-rejeu). Une preuve ne sert qu'une fois. */
export interface CaptchaReplayStore {
  /** true si la cle est nouvelle (et la retient jusqu'a `expiresAt`), false si deja vue. */
  claim(key: string, expiresAt: number): boolean;
}

export class MemoryCaptchaReplayStore implements CaptchaReplayStore {
  private seen = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}
  claim(key: string, expiresAt: number): boolean {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    if (this.seen.has(key)) return false;
    this.seen.set(key, expiresAt);
    return true;
  }
}

/** Retention : au moins la validite d'un defi, pour qu'une preuve ne puisse pas revenir avant son expiration. */
export const CAPTCHA_REPLAY_RETENTION_MS = CHALLENGE_TTL_MS + 60_000;

const defaultReplayStore = new MemoryCaptchaReplayStore();

function proofKey(payload: string): string {
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { signature?: unknown };
    if (typeof decoded.signature === "string" && decoded.signature) return decoded.signature;
  } catch {
    /* repli sur la preuve entiere */
  }
  return payload;
}

/** Preuve valide ET jamais vue : consomme la preuve. */
export async function consumeCaptchaProof(
  payload: unknown,
  store: CaptchaReplayStore = defaultReplayStore,
  now: number = Date.now(),
): Promise<boolean> {
  if (!(await verifyCaptchaPayload(payload))) return false;
  return store.claim(proofKey(payload as string), now + CAPTCHA_REPLAY_RETENTION_MS);
}
