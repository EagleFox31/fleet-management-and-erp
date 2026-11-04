import type { BrowserContextOptions } from "@playwright/test";

/**
 * Mode enregistrement (E2E_RECORD=1), pour un montage vidéo par fonctionnalité.
 *
 * `playwright.config.ts` filme le contexte fourni par la fixture `page`. Les tests à
 * plusieurs profils ouvrent leurs contextes eux-mêmes (`browser.newContext()`), que la
 * config ne filme pas : `newE2EContext` (e2e/helpers/contexts.ts) leur ajoute `recordVideo`.
 * Sans E2E_RECORD=1, aucune option n'est ajoutée : comportement par défaut inchangé.
 */
export const RECORD_VIEWPORT = { width: 1280, height: 720 } as const;

export function isRecording(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.E2E_RECORD === "1";
}

/** Nom de dossier sûr pour un libellé de profil (`video-<libellé>`). */
export function recordingDirName(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `video-${slug || "contexte"}`;
}

/**
 * Options d'enregistrement d'un contexte ouvert à la main. `outputPath` résout un chemin
 * dans le dossier du test (`testInfo.outputPath`) : les vidéos de chaque profil y sont
 * rangées à côté de celle de la fixture `page`.
 */
export function recordingContextOptions(
  label: string,
  outputPath: (name: string) => string,
  env: NodeJS.ProcessEnv = process.env,
): BrowserContextOptions {
  if (!isRecording(env)) return {};
  return {
    viewport: { ...RECORD_VIEWPORT },
    recordVideo: { dir: outputPath(recordingDirName(label)), size: { ...RECORD_VIEWPORT } },
  };
}
