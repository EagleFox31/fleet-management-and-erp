import express, { type Express, type Request, type Response, type NextFunction } from "express";
import compression from "compression";
import path from "path";
import type { Server } from "http";
import { registerRoutes } from "./routes";
import apiRouter from "./api";
import { initializeDatabase } from "./init-database";
import { log } from "./vite";

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

  app.use((req, res, next) => {
    const start = Date.now();
    const requestPath = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (requestPath.startsWith("/api")) {
        let logLine = `${req.method} ${requestPath} ${res.statusCode} in ${duration}ms`;
        if (capturedJsonResponse) {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        }
        if (logLine.length > 80) {
          logLine = logLine.slice(0, 79) + "…";
        }
        log(logLine);
      }
    });

    next();
  });

  if (initializeDb) {
    await initializeDatabase();
  }

  app.use("/api", apiRouter);
  const server = await registerRoutes(app);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const error = err as { status?: number; statusCode?: number; message?: string };
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    res.status(status).json({ message });
  });

  return { app, server };
}
