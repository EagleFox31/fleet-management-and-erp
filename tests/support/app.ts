import type { Express } from "express";
import { createApp } from "../../server/app";

let appPromise: Promise<Express> | null = null;

/**
 * App Express in-process pour les tests de contrat.
 * Le setup contrat a déjà joué initializeDatabase().
 */
export function getContractApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = createApp({ initializeDb: false }).then(({ app }) => app);
  }
  return appPromise;
}
