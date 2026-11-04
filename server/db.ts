import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";
import { assertServerNotProductionDatabase } from "./lib/production-db-guard";
import { moduleLogger } from "./lib/logger";

neonConfig.webSocketConstructor = ws;

/**
 * Postgres hors Neon (tests locaux, CI) : le driver passe par un proxy WebSocket
 * (`ghcr.io/neondatabase/wsproxy`) désigné par DATABASE_WS_PROXY, ex. `localhost:5433/v1`.
 * Sans protocole ; le proxy est joint en clair (`ws:`), donc réservé à une machine locale.
 * Non défini = Neon, comportement inchangé.
 */
if (process.env.DATABASE_WS_PROXY) {
  neonConfig.wsProxy = process.env.DATABASE_WS_PROXY;
  neonConfig.useSecureWebSocket = false;
  // Postgres standard authentifie en SCRAM : pas de pipeline « mot de passe en clair ».
  neonConfig.pipelineConnect = false;
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Avant tout pool : hors production, jamais de connexion à la base de production sans dérogation.
const productionDbGuard = assertServerNotProductionDatabase();
if (productionDbGuard.status === "overridden") {
  moduleLogger("db").warn(
    { variable: productionDbGuard.variable, marker: productionDbGuard.marker },
    "Connexion à la base de production hors NODE_ENV=production (ALLOW_PRODUCTION_DATABASE=1)",
  );
}

const deriveDirectConnectionString = (connectionString: string): string => {
  try {
    const url = new URL(connectionString);
    if (url.hostname.includes("-pooler.")) {
      url.hostname = url.hostname.replace("-pooler.", ".");
    }
    return url.toString();
  } catch {
    return connectionString;
  }
};

const listenerConnectionString =
  process.env.DATABASE_URL_LISTENER ||
  process.env.DATABASE_URL_DIRECT ||
  deriveDirectConnectionString(process.env.DATABASE_URL);

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const listenerPool = new Pool({ connectionString: listenerConnectionString });
export const db = drizzle(pool, { schema });

/** Transaction Drizzle, et « base ou transaction » pour les écritures composables. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbExecutor = typeof db | DbTransaction;
