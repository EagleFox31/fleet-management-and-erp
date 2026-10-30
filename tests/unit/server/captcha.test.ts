import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { solveChallenge } from "altcha-lib/v1";
import { issueCaptchaChallenge, verifyCaptchaPayload } from "../../../server/services/captcha-service";
import { captchaGuard } from "../../../server/middleware/captcha-guard";
import { authChallengeResponseSchema } from "../../../shared/contracts/auth-captcha";

async function validPayload(): Promise<string> {
  const challenge = await issueCaptchaChallenge();
  const solution = await solveChallenge(challenge.challenge, challenge.salt, challenge.algorithm as "SHA-256", challenge.maxnumber).promise;
  return Buffer.from(JSON.stringify({ algorithm: challenge.algorithm, challenge: challenge.challenge, number: solution!.number, salt: challenge.salt, signature: challenge.signature })).toString("base64");
}

async function run(body: unknown, failed: number) {
  const next = vi.fn();
  await captchaGuard({ getFailedCount: async () => failed })({ body } as never, {} as never, next);
  return next.mock.calls[0][0];
}

describe("captcha ALTCHA", () => {
  beforeEach(() => {
    process.env.ALTCHA_HMAC_KEY = "cle-de-test";
    process.env.FEATURE_FLAGS = "captcha=on";
  });
  afterEach(() => {
    delete process.env.ALTCHA_HMAC_KEY;
    delete process.env.FEATURE_FLAGS;
  });

  it("produit un défi conforme au contrat", async () => {
    expect(authChallengeResponseSchema.safeParse(await issueCaptchaChallenge()).success).toBe(true);
  });
  it("accepte une preuve valide, refuse une preuve falsifiée ou absente", async () => {
    const good = await validPayload();
    expect(await verifyCaptchaPayload(good)).toBe(true);
    expect(await verifyCaptchaPayload(good.slice(0, -4) + "AAAA")).toBe(false);
    expect(await verifyCaptchaPayload(undefined)).toBe(false);
  });
  it("garde : pas de captcha sous le seuil", async () => {
    expect(await run({ username: "bob" }, 2)).toBeUndefined();
  });
  it("garde : 400 VALIDATION sur le champ captcha au seuil sans preuve", async () => {
    const err = await run({ username: "bob" }, 3);
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION");
    expect(err.fieldErrors[0].field).toBe("captcha");
  });
  it("garde : laisse passer avec une preuve valide", async () => {
    expect(await run({ username: "bob", captcha: await validPayload() }, 5)).toBeUndefined();
  });
  it("garde : sans effet quand le drapeau est coupé", async () => {
    process.env.FEATURE_FLAGS = "captcha=off";
    expect(await run({ username: "bob" }, 9)).toBeUndefined();
  });
});
