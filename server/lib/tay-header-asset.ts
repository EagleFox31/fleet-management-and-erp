import { promises as fs } from "fs";
import path from "path";

/** Papier a en-tete officiel TAY : image PNG, par ordre de preference. Source unique (PDF et Word). */
export const TAY_HEADER_IMAGE_FILES = ["TAY-header-final.png", "TAY-header.png"] as const;

export function tayHeaderImageCandidates(cwd: string = process.cwd()): string[] {
  return TAY_HEADER_IMAGE_FILES.map((f) => path.resolve(cwd, "attached_assets", f));
}

/** Premiere image disponible, ou null (a l'appelant de prevoir un repli). */
export async function readTayHeaderImage(cwd?: string): Promise<Buffer | null> {
  for (const candidate of tayHeaderImageCandidates(cwd)) {
    try {
      return await fs.readFile(candidate);
    } catch {
      // candidat suivant
    }
  }
  return null;
}
