import { test, type Browser, type BrowserContext, type BrowserContextOptions } from "@playwright/test";
import { recordingContextOptions } from "./recording";

/**
 * `browser.newContext()` pour les tests à plusieurs profils. En E2E_RECORD=1, le contexte
 * est filmé dans `<dossier du test>/video-<label>/` ; sinon, appel identique à
 * `browser.newContext(options)`. La vidéo n'est écrite qu'à la fermeture du contexte.
 */
export function newE2EContext(
  browser: Browser,
  label: string,
  options: BrowserContextOptions = {},
): Promise<BrowserContext> {
  return browser.newContext({ ...options, ...recordingContextOptions(label, (name) => test.info().outputPath(name)) });
}
