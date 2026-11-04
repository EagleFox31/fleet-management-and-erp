import { afterAll } from "vitest";

// Toutes les suites de contrat partagent une app et l'adresse 127.0.0.1 : sans ce relevement, le plafond
// d'echecs par IP (server/middleware/auth-ip-limit.ts) bloquerait les suites suivantes. Le test qui le
// verifie abaisse ce plafond et se donne sa propre adresse.
process.env.AUTH_IP_FAILURE_MAX ??= "100000";
import "./setup-db";
import { initializeDatabase } from "../../server/init-database";
import { cleanupOrphanTestRows } from "./cleanup";

const globalState = globalThis as typeof globalThis & {
  __fleetTestDbReady?: Promise<void>;
};

if (!globalState.__fleetTestDbReady) {
  globalState.__fleetTestDbReady = initializeDatabase();
}

await globalState.__fleetTestDbReady;

afterAll(async () => {
  await cleanupOrphanTestRows();
});
