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
    name: "integration",
    globals: true,
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Verrou en base : deux passages sur la même base de test s'enchaînent (tests/support/test-db-lock.ts).
    globalSetup: ["tests/support/global-setup-db-lock.ts"],
    setupFiles: ["tests/support/setup-integration.ts"],
    fileParallelism: false,
    pool: "forks",
    isolate: false,
    maxWorkers: 1,
  },
});
