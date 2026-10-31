import { Router } from "express";
import { lockedUsersResponseSchema, unlockUserParamsSchema } from "@shared/contracts/auth-lockout";
import { AppError } from "../lib/app-error";
import { isAdmin } from "../middleware/auth";
import { DbLockoutStore } from "../services/login-lockout-db-store";

const router = Router();
const store = new DbLockoutStore();

/**
 * Comptes actuellement verrouillés (P-03). Jamais de mot de passe ni de jeton dans la réponse.
 * Lecture par le store qui écrit le verrou (même convention d'heure), pas par Drizzle.
 */
router.get("/admin/users/locked", isAdmin, async (_req, res, next) => {
  try {
    const rows = await store.listLocked(new Date());
    res.json(
      lockedUsersResponseSchema.parse(
        rows.map((r) => ({
          ...r,
          lockedUntil: r.lockedUntil.toISOString(),
          lastFailedLoginAt: r.lastFailedLoginAt ? r.lastFailedLoginAt.toISOString() : null,
        })),
      ),
    );
  } catch (err) {
    next(err);
  }
});

/** Lève le verrou : compteur remis à zéro, ligne `login_attempts_by_username` supprimée, action auditée. Rejouable. */
router.post("/admin/users/:id/unlock", isAdmin, async (req, res, next) => {
  try {
    const { id } = unlockUserParamsSchema.parse(req.params);
    const found = await store.unlockUser(id, req.user?.id ?? null);
    if (!found) throw new AppError(404, "Utilisateur introuvable.");
    res.json({ id, unlocked: true });
  } catch (err) {
    next(err);
  }
});

export default router;
