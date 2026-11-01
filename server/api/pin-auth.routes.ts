import { Router } from "express";
import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("pin-auth");
const router = Router();

/**
 * Un compte chauffeur dont la fiche `drivers` est désactivée n'ouvre plus
 * l'écran PIN. Un compte `driver` sans fiche reste admis : seule une
 * désactivation explicite l'écarte.
 */
const ficheChauffeurDesactivee = sql`exists (
  select 1 from drivers d where d.user_id = ${users.id} and d.is_active = false
)`;

/**
 * Déclarés avant les handlers homonymes de server/routes.ts (/api est servi
 * avant registerRoutes) : Express sert la première déclaration.
 */
router.post("/auth/pin-login", async (req, res, next) => {
  try {
    const { userId, pin } = req.body ?? {};
    if (!userId || !pin) {
      throw new AppError(400, "userId et pin requis");
    }

    const [user] = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
    if (!user || user.deletedAt) {
      throw new AppError(401, "Utilisateur introuvable");
    }
    if (user.role !== "driver") {
      throw new AppError(403, "Accès réservé aux chauffeurs");
    }
    const [desactive] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, user.id), ficheChauffeurDesactivee))
      .limit(1);
    if (desactive) {
      throw new AppError(401, "Ce compte chauffeur est désactivé");
    }
    if (!user.pin) {
      throw new AppError(401, "Aucun PIN configuré");
    }

    const pinMatch = await bcrypt.compare(String(pin), user.pin);
    if (!pinMatch) {
      throw new AppError(401, "PIN incorrect");
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role as any;

    await db
      .update(users)
      .set({ loginCount: user.loginCount + 1, lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    log.info({ userId: user.id, requestId: req.requestId }, "Connexion par PIN");
    return res.status(200).json({
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
    });
  } catch (err) {
    if (!(err instanceof AppError)) {
      log.error({ err, requestId: req.requestId }, "Échec de la connexion par PIN");
      return next(new AppError(500, "Erreur serveur", { cause: err }));
    }
    return next(err);
  }
});

router.get("/auth/drivers-list", async (req, res, next) => {
  try {
    const rows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(eq(users.role, "driver"), isNull(users.deletedAt), sql`not ${ficheChauffeurDesactivee}`));
    return res.status(200).json(rows);
  } catch (err) {
    log.error({ err, requestId: req.requestId }, "Échec de la liste des chauffeurs PIN");
    return next(new AppError(500, "Erreur serveur", { cause: err }));
  }
});

export default router;
