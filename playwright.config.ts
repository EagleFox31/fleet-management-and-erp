import { defineConfig, devices } from "@playwright/test";
import { assertNotProductionDatabase } from "./e2e/helpers/production-guard";
import { isRecording, RECORD_VIEWPORT } from "./e2e/helpers/recording";

// Refuse de démarrer si la base visée est la production (voir e2e/README.md).
assertNotProductionDatabase();

// PORT : port du serveur lancé par Playwright (le serveur lit la même variable),
// pour tourner à côté d'un autre serveur déjà sur 5000.
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${process.env.PORT || "5000"}`;
const useManagedWebServer = !process.env.E2E_BASE_URL;
// Navigateur installé à utiliser à la place du Chromium de Playwright (ex. `msedge`),
// quand `playwright install` n'a pas été lancé sur le poste.
const channel = process.env.E2E_CHANNEL || undefined;
const configuredWorkers = Number(process.env.E2E_WORKERS ?? "1");
// E2E_RECORD=1 : mode enregistrement, pour un montage vidéo par fonctionnalité.
// Vidéo et capture de chaque test (succès compris), à la taille du viewport, sans trace.
// Un dossier par test : test-results/recordings/<spec>-<titre du test>-chromium/.
const record = isRecording();
const viewport = { ...RECORD_VIEWPORT };
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
  ...(record ? { outputDir: "test-results/recordings" } : {}),
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    ...(record
      ? { trace: "off", screenshot: "on", video: { mode: "on", size: viewport } }
      : { trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" }),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel, ...(record ? { viewport } : {}) },
    },
  ],
  webServer: useManagedWebServer
    ? {
        command: "npm run dev",
        env: {
          ...process.env,
          // Le service worker n'est enregistré qu'en production ; la spec 13 (PWA) le requiert.
          VITE_ENABLE_SW: "1",
          TMPDIR: process.env.TMPDIR || "/tmp",
        },
        url: baseURL,
        // Jamais de réutilisation : un serveur déjà lancé pourrait pointer la production,
        // et le garde-fou ne voit que la base de cette session. Playwright démarre le sien
        // (et échoue si le port est pris) ; pour un serveur extérieur, voir E2E_BASE_URL.
        reuseExistingServer: false,
        timeout: 180_000,
      }
    : undefined,
});
