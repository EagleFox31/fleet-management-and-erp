import { Router } from "express";
import { authChallengeResponseSchema } from "@shared/contracts/auth-captcha";
import { requireFeature } from "../lib/feature-flags";
import { issueCaptchaChallenge } from "../services/captcha-service";

const router = Router();

/** GET /api/auth/challenge : défi ALTCHA, public (appelé avant la connexion), derrière le drapeau `captcha`. */
router.get("/auth/challenge", requireFeature("captcha"), async (_req, res, next) => {
  try {
    res.status(200).json(authChallengeResponseSchema.parse(await issueCaptchaChallenge()));
  } catch (err) {
    next(err);
  }
});

export default router;
