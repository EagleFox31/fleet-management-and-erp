import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";
import { moduleLogger } from "../lib/logger";
import { sessionCookieFlags } from "../lib/session-cookie";
import { resolveSessionSecret } from "../lib/session-secret";

const PgSession = connectPgSimple(session);

const cookieFlags = sessionCookieFlags();
if (process.env.NODE_ENV === "production" && !cookieFlags.secure) {
  // Voulu pour le serveur de site sur un LAN en http:// ; anormal derrière un domaine public.
  moduleLogger("session").warn(
    { appUrl: process.env.APP_URL },
    "Cookie de session non secure en production (APP_URL en http://) : réservé à un réseau local de confiance.",
  );
}

/**
 * Shared session middleware instance with PostgreSQL storage
 * Compatible avec les requêtes inter-origines de l'APK Capacitor (https://localhost)
 * et le web local / distant.
 */
export const sessionMiddleware = session({
  // En production : lève (démarrage refusé) si le secret est absent, trop court ou public.
  secret: resolveSessionSecret(process.env, (message) => moduleLogger("session").warn(message)),
  resave: false,
  saveUninitialized: false,
  cookie: {
    // sameSite 'none' exige secure ; en HTTP sur le LAN (APP_URL http://), lax et non secure.
    secure: cookieFlags.secure,
    httpOnly: true,
    sameSite: cookieFlags.sameSite,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
  },
  store: new PgSession({
    pool: pool,
    tableName: "session",
    createTableIfMissing: true,
  }),
});
