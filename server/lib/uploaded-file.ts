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
  return [...new Set(candidates)].filter((candidate) => {
    const relative = path.relative(uploadsDir, candidate);
    return relative !== "" && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== "..";
  });
}
