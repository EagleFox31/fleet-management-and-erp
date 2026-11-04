import { existsSync, readdirSync, rmSync } from "fs";

/**
 * Ménage disque d'un test qui écrit dans un dossier dont il ne connaît pas l'histoire : un dossier
 * qui n'existait pas avant le test est supprimé en entier ; un dossier qui existait (versionné avec
 * un `.gitkeep`, ou laissé par une autre suite) ne perd que les entrées apparues pendant le test.
 *
 * Cas réel : `uploads/documents/vehicle-1/.gitkeep` est versionné ; sur une base neuve, le premier
 * véhicule de test a l'id 1 et un `rmSync(vehicle-<id>, { recursive: true })` effaçait le fichier suivi.
 */
export interface TrackedDir {
  dir: string;
  before: Set<string> | null;
}

export function trackDir(dir: string): TrackedDir {
  return { dir, before: existsSync(dir) ? new Set(readdirSync(dir)) : null };
}

export function cleanupTrackedDir({ dir, before }: TrackedDir): void {
  if (!existsSync(dir)) return;
  if (before === null) {
    rmSync(dir, { recursive: true, force: true });
    return;
  }
  for (const entry of readdirSync(dir)) {
    if (!before.has(entry)) rmSync(`${dir}/${entry}`, { recursive: true, force: true });
  }
}
