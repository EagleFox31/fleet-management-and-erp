import fs from "fs";
import type { NextFunction, Response } from "express";
import { isAllowedUpload } from "../middleware/upload";
import { AppError } from "./app-error";
import { contentDisposition } from "./content-disposition";
import { moduleLogger } from "./logger";
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

const log = moduleLogger("uploaded-file-response");

/** Issue d'un échec de `res.sendFile`, après que le fichier a été trouvé sur disque. */
export type SendFailureOutcome = "aborted" | "not-found" | "failed";

/**
 * - `aborted` : le client a coupé, ou l'envoi avait commencé. Rien ne peut plus être répondu, ce
 *   n'est pas une panne du serveur.
 * - `not-found` : le fichier a disparu entre le contrôle et l'envoi (ENOENT, 404 de `send`).
 * - `failed` : toute autre erreur (500).
 */
export function sendFailureOutcome(err: unknown, headersSent: boolean): SendFailureOutcome {
  const e = (err ?? {}) as { code?: unknown; status?: unknown; statusCode?: unknown };
  if (headersSent || e.code === "ECONNABORTED" || e.code === "ECONNRESET" || e.code === "EPIPE") return "aborted";
  if (e.code === "ENOENT" || e.code === "ENOTDIR" || e.status === 404 || e.statusCode === 404) return "not-found";
  return "failed";
}

/**
 * Envoie le fichier téléversé dont le chemin est stocké en base : seul un fichier existant sous
 * uploads/ est servi (`uploadedFileCandidates`), sinon 404 avec `notFoundMessage`. Toujours en pièce
 * jointe, `nosniff`, type en liste blanche. Un échec d'envoi suit `sendFailureOutcome` : interruption
 * journalisée en `info` sans réponse, fichier disparu en 404, autre erreur en 500 (`failureMessage`).
 */
export function sendUploadedFile(
  res: Response,
  storedPath: string | null | undefined,
  file: {
    mimeType: string | null | undefined;
    downloadName: string | null | undefined;
    notFoundMessage: string;
    failureMessage: string;
  },
  next: NextFunction,
  requestId?: string,
): void {
  const absolutePath = uploadedFileCandidates(storedPath).find((candidate) => fs.existsSync(candidate));
  if (!absolutePath) throw new AppError(404, file.notFoundMessage);
  res.setHeader("X-Content-Type-Options", "nosniff");
  const headers = {
    "Content-Type": servedContentType(file.mimeType, absolutePath),
    "Content-Disposition": contentDisposition("attachment", file.downloadName),
  };
  res.sendFile(absolutePath, { headers }, (err) => {
    if (!err) return;
    const outcome = sendFailureOutcome(err, res.headersSent);
    if (outcome === "aborted") {
      log.info({ err, requestId }, "envoi du fichier interrompu");
      return;
    }
    if (outcome === "not-found") {
      log.warn({ err, requestId }, "fichier disparu entre le contrôle et l'envoi");
      next(new AppError(404, file.notFoundMessage, { cause: err }));
      return;
    }
    log.error({ err, requestId }, "envoi du fichier en échec");
    next(new AppError(500, file.failureMessage, { cause: err }));
  });
}
