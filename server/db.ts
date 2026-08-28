import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from "ws";
import * as schema from "@shared/schema";

neonConfig.webSocketConstructor = ws;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
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
