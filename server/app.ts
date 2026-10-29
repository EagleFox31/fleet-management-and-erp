import express, { type Express } from "express";
import compression from "compression";
import path from "path";
import type { Server } from "http";
import { registerRoutes } from "./routes";
import apiRouter from "./api";
import { initializeDatabase } from "./init-database";
import { accessLog, errorHandler, errorResponseGuard, requestContext } from "./middleware/error-handler";

export type CreateAppOptions = {
  /**
   * Rejoue le bootstrap SQL (migrations idempotentes, index, seed admin).
   * Laisser true au boot prod. Les setups Vitest integration/contrat le font
   * une fois, puis passent false pour éviter un double replay.
   */
  initializeDb?: boolean;
};

/**
 * Application Express sans listen, Vite, WebSocket ni scheduler.
 * Utilisée par le boot (`server/index.ts`) et par les tests de contrat HTTP.
 */
export async function createApp(
  options: CreateAppOptions = {},
): Promise<{ app: Express; server: Server }> {
  const initializeDb = options.initializeDb !== false;

  const app = express();

  // Gestion d'erreurs centralisée (server/middleware/error-handler.ts) :
  // chaque requête reçoit un identifiant, chaque réponse d'erreur est mise au
  // contrat `ApiErrorBody`, et le détail technique ne part qu'aux logs.
  app.use(requestContext);
  app.use(accessLog);
  app.use(errorResponseGuard);

  // Compression avant tout le reste: le JSON des listes se réduit de 80 à 90 %,
  // et la liaison vers ce déploiement est lente (≈475 ms d'aller-retour Neon
  // mesurés). C'est le gain le moins cher de la chaîne.
  app.use(compression());
  app.disable("etag");

  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
    }
    next();
  });

  app.set("trust proxy", 1);

  // Configuration CORS dynamique & sécurisée compatible cookies de session (Credentials: true)
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowedOrigins = [
        "https://localhost",
        "http://localhost",
        "capacitor://localhost",
        process.env.APP_URL,
        process.env.CORS_ORIGIN,
      ].filter(Boolean) as string[];

      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$/.test(origin);
      const isAllowed = allowedOrigins.includes(origin) || (process.env.NODE_ENV !== "production" && isLocalhost);

      if (isAllowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Cookie");
        res.setHeader("Vary", "Origin");
      }
    }

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  });

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  const publicPath = path.resolve(process.cwd(), "public");
  app.use(express.static(publicPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith("manifest.json")) {
        res.setHeader("Content-Type", "application/manifest+json");
        res.setHeader("Access-Control-Allow-Origin", "*");
      }
      if (filePath.endsWith(".png") || filePath.endsWith(".jpg")) {
        res.setHeader("Cache-Control", "public, max-age=31536000");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "image/png");
      }
    },
  }));

  if (initializeDb) {
    await initializeDatabase();
  }

  app.use("/api", apiRouter);
  const server = await registerRoutes(app);

  app.use(errorHandler);

  return { app, server };
}
