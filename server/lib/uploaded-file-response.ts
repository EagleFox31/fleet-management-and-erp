import fs from "fs";
import type { Response } from "express";
import { isAllowedUpload } from "../middleware/upload";
import { AppError } from "./app-error";
import { contentDisposition } from "./content-disposition";
import { uploadedFileCandidates } from "./uploaded-file";

/** Type servi quand le type déclaré n'est pas sûr : le navigateur propose l'enregistrement, ne rend rien. */
export const UNTRUSTED_CONTENT_TYPE = "application/octet-stream";

/** Alias non standard admis au téléversement, servis sous leur forme canonique. */
const CANONICAL_TYPE: Readonly<Record<string, string>> = { "image/jpg": "image/jpeg" };

/**
 * Type servi pour un fichier téléversé : le type déclaré en base seulement s'il est dans la liste
 * blanche du téléversement ET cohérent avec l'extension du fichier sur disque. Sinon octet-stream :
 * une ligne ancienne en .html ou .svg n'est jamais rendue sur l'origine de l'application.
 */
export function servedContentType(declared: string | null | undefined, servedPath: string): string {
  const type = declared?.trim().toLowerCase() ?? "";
  if (!isAllowedUpload(type, servedPath)) return UNTRUSTED_CONTENT_TYPE;
  return CANONICAL_TYPE[type] ?? type;
}

/**
 * Envoie le fichier téléversé dont le chemin est stocké en base : seul un fichier existant sous
 * uploads/ est servi (`uploadedFileCandidates`), sinon 404 avec `notFoundMessage`. Toujours en pièce
 * jointe, `nosniff`, type en liste blanche. `onError` reçoit les erreurs d'envoi.
 */
export function sendUploadedFile(
  res: Response,
  storedPath: string | null | undefined,
  file: { mimeType: string | null | undefined; downloadName: string | null | undefined; notFoundMessage: string },
  onError: (err: Error) => void,
): void {
  const absolutePath = uploadedFileCandidates(storedPath).find((candidate) => fs.existsSync(candidate));
  if (!absolutePath) throw new AppError(404, file.notFoundMessage);
  res.setHeader("X-Content-Type-Options", "nosniff");
  const headers = {
    "Content-Type": servedContentType(file.mimeType, absolutePath),
    "Content-Disposition": contentDisposition("attachment", file.downloadName),
  };
  res.sendFile(absolutePath, { headers }, (err) => {
    if (err) onError(err);
  });
}
