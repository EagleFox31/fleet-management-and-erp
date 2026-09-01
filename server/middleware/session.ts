import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";

const PgSession = connectPgSimple(session);

const isProduction = process.env.NODE_ENV === "production";
const useCrossSiteCookies = process.env.ALLOW_CROSS_SITE_COOKIES === "true" || isProduction;

/**
 * Shared session middleware instance with PostgreSQL storage
 * Compatible avec les requêtes inter-origines de l'APK Capacitor (https://localhost)
 * et le web local / distant.
 */
export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "YaroFleetOSSecretKey",
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
