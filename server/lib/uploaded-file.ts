import path from "path";

/**
 * Chemins disque possibles d'un fichier téléversé, à partir de la valeur
 * stockée en base. Deux formes coexistent : `uploads/documents/...` (multer,
 * relatif au dossier de lancement) et `/uploads/...` (anciens enregistrements).
 *
 * Seuls les chemins sous `<root>/uploads` sont renvoyés : supprimer un document
 * ne doit jamais atteindre un fichier que l'application n'a pas déposé.
 */
export function uploadedFileCandidates(storedPath: string | null | undefined, root = process.cwd()): string[] {
  if (!storedPath) return [];
  const uploadsDir = path.resolve(root, "uploads");
  const candidates = [path.resolve(root, storedPath), path.resolve(root, storedPath.replace(/^[/\\]+/, ""))];
  return [...new Set(candidates)].filter((candidate) => isInsideDirectory(uploadsDir, candidate));
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
