import fs from "fs";
import path from "path";

/**
 * Chemins disque possibles d'un fichier téléversé, à partir de la valeur
 * stockée en base. Deux formes coexistent : `uploads/documents/...` (multer,
 * relatif au dossier de lancement) et `/uploads/...` (anciens enregistrements).
 *
 * Seuls les chemins sous `<root>/uploads` sont renvoyés : supprimer un document
 * ne doit jamais atteindre un fichier que l'application n'a pas déposé.
 * Un lien symbolique (ou une jonction) sous `uploads/` qui mène dehors est refusé.
 */
export function uploadedFileCandidates(storedPath: string | null | undefined, root = process.cwd()): string[] {
  if (!storedPath) return [];
  const uploadsDir = path.resolve(root, "uploads");
  const candidates = [path.resolve(root, storedPath), path.resolve(root, storedPath.replace(/^[/\\]+/, ""))];
  return [...new Set(candidates)].filter(
    (candidate) => isInsideDirectory(uploadsDir, candidate) && realPathStaysInside(uploadsDir, candidate),
  );
}

/**
 * Le fichier existant `candidate`, liens résolus, reste sous `directory` (liens résolus aussi :
 * un `uploads/` monté par lien reste valide). Un fichier absent n'a rien à lire ni à supprimer :
 * accepté, la comparaison lexicale suffit. Toute autre erreur de résolution refuse.
 * Risque résiduel : un lien créé entre ce contrôle et l'accès (accès disque requis).
 */
export function realPathStaysInside(directory: string, candidate: string): boolean {
  let realCandidate: string;
  try {
    realCandidate = fs.realpathSync.native(candidate);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
  }
  let realDirectory: string;
  try {
    realDirectory = fs.realpathSync.native(directory);
  } catch {
    realDirectory = path.resolve(directory);
  }
  return isInsideDirectory(realDirectory, realCandidate);
}

/**
 * `candidate` est strictement sous `directory` une fois les deux chemins résolus.
 * Comparaison par `path.relative`, pas par préfixe de chaîne : `uploads/documents-x`
 * n'est pas sous `uploads/documents`.
 */
export function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative !== "" && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..";
}

/**
 * Valeur venue de la requête et utilisée comme segment de chemin disque
 * (identifiant de session, type de document) : ni séparateur ni `..`.
 */
export function isSafePathSegment(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
