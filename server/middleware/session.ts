import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";
import { requireSessionSecret, sessionCookieFlags } from "../lib/session-cookie";

const PgSession = connectPgSimple(session);

const cookieFlags = sessionCookieFlags();

/**
 * Shared session middleware instance with PostgreSQL storage
 * Compatible avec les requêtes inter-origines de l'APK Capacitor (https://localhost)
 * et le web local / distant.
 */
export const sessionMiddleware = session({
  secret: requireSessionSecret(),
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
