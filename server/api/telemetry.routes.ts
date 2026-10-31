import { Router } from "express";
import { isAdmin } from "../middleware/auth";
import { notImplemented } from "./stub";

/**
 * Réception des positions GPS (CDC #6). Monté sur `/api/telemetry`, drapeau `gps`.
 *
 * Les boîtiers n'ont pas de compte, ils s'authentifieront par jeton d'appareil (lot #6).
 * D'ici là, ce routeur impose `isAdmin` en tête : aucune route /api sans
 * garde de session. Le lot #6 remplace `isAdmin` par une garde jeton marquée
 * (`isSessionGuard`) posée en tête de ce routeur, avant toute logique.
 * Les positions sont exclues du journal d'audit (volume) : voir `server/lib/audit-config.ts`.
 */
const router = Router();

// Provisoire jusqu'au lot #6 : remplacer par la garde jeton d'appareil (marquée `isSessionGuard`).
router.use(isAdmin);

router.post("/positions", notImplemented);

export default router;
