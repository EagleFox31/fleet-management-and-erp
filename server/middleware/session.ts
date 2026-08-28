import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "../db";

const PgSession = connectPgSimple(session);

/**
 * Shared session middleware instance with PostgreSQL storage
 * This ensures sessions persist across server restarts and hot reloads
 */
export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "YaroFleetOSSecretKey",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // Allow cookies over HTTP in production for Replit
    httpOnly: true,
    sameSite: 'lax', // Allow cookies to be sent with GET requests
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  store: new PgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  })
});
