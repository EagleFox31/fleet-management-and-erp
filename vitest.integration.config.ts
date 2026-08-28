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
    setupFiles: ["tests/support/setup-integration.ts"],
    fileParallelism: false,
    pool: "forks",
    isolate: false,
    maxWorkers: 1,
  },
});
