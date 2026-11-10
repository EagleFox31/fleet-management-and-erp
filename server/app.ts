import express, { type Express } from "express";
import compression from "compression";
import path from "path";
import type { Server } from "http";
import { registerRoutes } from "./routes";
import apiRouter from "./api";
import { initializeDatabase } from "./init-database";
import { moduleLogger } from "./lib/logger";
import { isApiPath } from "./lib/routed-path";
import { requireJsonContentType } from "./middleware/require-json-content-type";
import { migrateLoginIdentifiers, pendingLoginIdentifiers } from "./services/login-identifier-migration";
import { createIpFailureLimiter } from "./middleware/auth-ip-limit";
import { trustProxyFromEnv } from "./lib/trust-proxy";
import { accessLog, apiNotFound, errorHandler, errorResponseGuard, requestContext } from "./middleware/error-handler";
import { rejectNonCanonicalTarget } from "./middleware/reject-non-canonical-target";

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
  // Avant tout routage : une cible avec `\` serait lue differemment par l'app et par apiRouter.
  app.use(rejectNonCanonicalTarget);

  // Compression avant tout le reste: le JSON des listes se réduit de 80 à 90 %,
  // et la liaison vers ce déploiement est lente (≈475 ms d'aller-retour Neon
  // mesurés). C'est le gain le moins cher de la chaîne.
  app.use(compression());
  app.disable("etag");

  app.use((req, res, next) => {
    if (isApiPath(req.path)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
    }
    next();
  });

  // Sauts de proxy de confiance par profil de déploiement (TRUST_PROXY, défaut 1) : voir server/lib/trust-proxy.ts.
  app.set("trust proxy", trustProxyFromEnv(process.env.TRUST_PROXY));

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

  // Avant tout analyseur de corps : une écriture /api en urlencoded ou text/plain est refusée en 415.
  app.use(requireJsonContentType);
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
    // Reprise M3 : clés de verrouillage et audit de blocage en clair vers leur empreinte. Un échec ne
    // bloque pas le démarrage, la reprise se rejoue au suivant.
    await migrateLoginIdentifiers().catch(async (err) => {
      // M-4 : ce qui reste en clair, en compteurs seulement. La reprise sera rejouee au prochain demarrage.
      const remaining = await pendingLoginIdentifiers().catch(() => null);
      moduleLogger("login-identifier-migration").error({ err, remaining }, "reprise des identifiants de connexion impossible");
    });
  }

  // Plafond d'echecs par IP, avant les routes de connexion (complement du verrou par compte).
  // Une seule instance : un meme budget pour les deux routes. Deux declarations plutot qu'un tableau de
  // chemins, que le controle des routes publiques (api-auth-guard) lirait comme un chemin inconnu.
  const ipFailureLimit = createIpFailureLimiter();
  app.post("/api/auth/login", ipFailureLimit);
  app.post("/api/auth/pin-login", ipFailureLimit);
  app.use("/api", apiRouter);
  const server = await registerRoutes(app);

  // Après tous les routeurs /api, avant le repli Vite ou static monté par server/index.ts.
  app.use("/api", apiNotFound);
  app.use(errorHandler);

  return { app, server };
}
