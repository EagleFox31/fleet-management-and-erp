import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";
import { moduleLogger } from "../lib/logger";
import { resolveSessionSecret } from "../lib/session-secret";

const PgSession = connectPgSimple(session);

const isProduction = process.env.NODE_ENV === "production";
const useCrossSiteCookies = process.env.ALLOW_CROSS_SITE_COOKIES === "true" || isProduction;

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
    // Si sameSite vaut 'none', le cookie DOIT obligatoirement avoir secure: true
    secure: useCrossSiteCookies,
    httpOnly: true,
    sameSite: useCrossSiteCookies ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
  },
  store: new PgSession({
    pool: pool,
    tableName: "session",
    createTableIfMissing: true,
  }),
});
