import { Router } from "express";
import bcrypt from "bcryptjs";
import { and, eq, isNull, sql } from "drizzle-orm";
import { users } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { burnBcryptTime } from "../lib/dummy-hash";
import { withLogContext } from "../lib/error-log-context";
import { validateBody } from "../middleware/validate-body";
import { pinLoginRequestSchema, type PinLoginRequest } from "@shared/contracts/auth-pin-login";

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
router.post("/auth/pin-login", validateBody(pinLoginRequestSchema), async (req, res, next) => {
  try {
    // Corps validé en type avant toute recherche de compte : même 400 pour un compte connu ou inconnu.
    const { userId, pin } = req.body as PinLoginRequest;

    const [user] = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
    // Tous les échecs d'identification (compte inconnu, non chauffeur, sans PIN, PIN faux) :
    // même 401, même message, même durée (comparaison factice quand il n'y a rien à comparer).
    if (!user || user.deletedAt || user.role !== "driver" || !user.pin) {
      await burnBcryptTime(String(pin));
      throw new AppError(401, "Identifiants invalides");
    }

    const pinMatch = await bcrypt.compare(String(pin), user.pin);
    if (!pinMatch) {
      throw new AppError(401, "Identifiants invalides");
    }
    // Après la vérification du PIN seulement : sinon la réponse dirait quels
    // chauffeurs sont désactivés à quiconque devine un identifiant.
    const [desactive] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, user.id), ficheChauffeurDesactivee))
      .limit(1);
    if (desactive) {
      throw new AppError(401, "Ce compte chauffeur est désactivé");
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
      return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Échec de la connexion par PIN" }));
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
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: err }), { event: "Échec de la liste des chauffeurs PIN" }));
  }
});

export default router;
