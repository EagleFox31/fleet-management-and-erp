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
    name: "unit",
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["e2e/**", "tests/integration/**", "tests/contract/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.config.ts",
        "**/types/**",
        "tests/**",
        "e2e/**",
      ],
    },
  },
});
