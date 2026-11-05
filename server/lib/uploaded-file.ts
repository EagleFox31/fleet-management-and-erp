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
 * `candidate`, liens résolus, reste sous `directory` (liens résolus aussi : un `uploads/` monté par
 * lien reste valide). Un fichier absent n'a rien à lire ni à supprimer, mais une écriture suivrait un
 * lien du chemin : on contrôle alors le dernier élément existant du chemin. Un lien pendant (cible
 * introuvable) ou un élément qui résout hors du dossier refuse ; toute autre erreur de résolution aussi.
 * Si rien n'existe encore sous `directory`, la comparaison lexicale suffit.
 * Risque résiduel : un lien créé entre ce contrôle et l'accès (accès disque requis).
 */
export function realPathStaysInside(directory: string, candidate: string): boolean {
  let realDirectory: string;
  try {
    realDirectory = fs.realpathSync.native(directory);
  } catch {
    realDirectory = path.resolve(directory);
  }
  const existing = deepestExistingEntry(path.resolve(candidate));
  if (existing === null) return false;
  const resolvedDirectory = path.resolve(directory);
  if (existing !== path.resolve(candidate) && !isInsideDirectory(resolvedDirectory, existing)) return true;
  let realExisting: string;
  try {
    realExisting = fs.realpathSync.native(existing);
  } catch {
    return false;
  }
  return isInsideDirectory(realDirectory, realExisting);
}

/** Dernier élément existant (`lstat`, liens non suivis) du chemin, en remontant ; `null` si erreur autre qu'absence. */
function deepestExistingEntry(candidate: string): string | null {
  let current = candidate;
  for (;;) {
    try {
      fs.lstatSync(current);
      return current;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
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
