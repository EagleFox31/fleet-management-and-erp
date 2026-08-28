import { afterAll } from "vitest";
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
