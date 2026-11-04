import { defineConfig } from "drizzle-kit";
import { guardDatabaseConnection } from "./server/lib/production-db-guard";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// `drizzle-kit push` écrit le schéma : même garde base de production que le serveur (#268).
guardDatabaseConnection("drizzle-kit");

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
