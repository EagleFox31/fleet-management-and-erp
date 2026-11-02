import { defineConfig, devices } from "@playwright/test";
import { assertNotProductionDatabase } from "./e2e/helpers/production-guard";

// Refuse de démarrer si la base visée est la production (voir e2e/README.md).
assertNotProductionDatabase();

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:5000";
const useManagedWebServer = !process.env.E2E_BASE_URL;
// Navigateur installé à utiliser à la place du Chromium de Playwright (ex. `msedge`),
// quand `playwright install` n'a pas été lancé sur le poste.
const channel = process.env.E2E_CHANNEL || undefined;
const configuredWorkers = Number(process.env.E2E_WORKERS ?? "1");
const workers = Number.isFinite(configuredWorkers) && configuredWorkers > 0 ? configuredWorkers : 1;

export default defineConfig({
  testDir: "./e2e",
  // Précharge l'app une fois hors test: en dev, la compilation Vite initiale
  // dépasse le timeout par test. Voir e2e/global-setup.ts.
  globalSetup: "./e2e/global-setup.ts",
  // 180 s: en dev, une navigation coûte 7 à 17 s et le dashboard déclenche 9+
  // requêtes API vers Neon. Un build de production serait bien plus rapide.
  timeout: 180_000,
  workers,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel },
    },
  ],
  webServer: useManagedWebServer
    ? {
        command: "npm run dev",
        env: {
          ...process.env,
          TMPDIR: process.env.TMPDIR || "/tmp",
        },
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      }
    : undefined,
});
