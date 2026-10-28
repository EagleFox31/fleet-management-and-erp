import path from "path";
import { defineConfig } from "vitest/config";

const aliases = {
  "@shared": path.resolve(__dirname, "./shared"),
  "@": path.resolve(__dirname, "./client/src"),
};

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  test: {
    name: "contract",
    globals: true,
    environment: "node",
    include: ["tests/contract/**/*.test.ts"],
    setupFiles: ["tests/support/setup-contract.ts"],
    fileParallelism: false,
    pool: "forks",
    isolate: false,
    maxWorkers: 1,
    // Le nettoyage (beforeAll/afterAll) enchaîne des requêtes Neon: 10 s par défaut ne suffisent pas.
    hookTimeout: 120000,
  },
});
