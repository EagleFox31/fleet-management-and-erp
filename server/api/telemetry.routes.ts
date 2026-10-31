import { Router } from "express";
import { notImplemented } from "./stub";

/**
 * Réception des positions GPS (CDC #6). Monté sur `/api/telemetry`, drapeau `gps`.
 *
 * Exception explicite aux gardes de session : les boîtiers n'ont pas de compte, ils
 * s'authentifieront par jeton d'appareil (lot #6). Tant que cette garde n'existe pas,
 * le squelette ne fait rien d'autre que répondre 501 : il ne lit ni n'écrit rien, donc
 * rien à protéger. Le lot #6 DOIT poser la garde par jeton avant toute logique.
 * Les positions sont exclues du journal d'audit (volume) : voir `server/lib/audit-config.ts`.
 */
const router = Router();

router.post("/positions", notImplemented);

export default router;
