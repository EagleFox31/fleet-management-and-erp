import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';
import { AppError } from '../lib/app-error';
import { isInsideDirectory, realPathStaysInside, uploadedFileCandidates } from '../lib/uploaded-file';
import { moduleLogger } from '../lib/logger';

const log = moduleLogger("upload");

// Dossier pour stocker les documents des véhicules
const UPLOAD_DIRECTORY = './uploads/documents';

// S'assurer que le dossier existe
if (!fs.existsSync(UPLOAD_DIRECTORY)) {
  fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true });
}

/** Plus grand identifiant d'une colonne `serial` (int Postgres). */
const MAX_VEHICLE_ID = 2_147_483_647;

/**
 * Identifiant de véhicule utilisable comme segment de chemin : entier positif écrit en
 * chiffres ASCII, sans zéro en tête (`007` et `7` feraient deux dossiers), borné à l'int Postgres.
 */
export function isVehicleIdSegment(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) && Number(value) <= MAX_VEHICLE_ID;
}

/**
 * Dossier disque des documents d'un véhicule, ou `null` si l'identifiant n'est pas un
 * nombre ou si le chemin résolu sortirait de `uploads/documents` (#130). Le chemin rendu
 * garde la forme relative `uploads/documents/vehicle-<id>` stockée en base.
 */
export function vehicleDocumentDirectory(vehicleId: unknown): string | null {
  if (!isVehicleIdSegment(vehicleId)) return null;
  const directory = path.join(UPLOAD_DIRECTORY, `vehicle-${vehicleId}`);
  // Liens résolus aussi : un `vehicle-<id>` remplacé par un lien n'écrit pas hors de `uploads/documents`.
  return isInsideDirectory(UPLOAD_DIRECTORY, directory) && realPathStaysInside(UPLOAD_DIRECTORY, directory) ? directory : null;
}

// Configuration de stockage multer pour les documents des véhicules
const vehicleDocumentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Créer un dossier pour chaque véhicule
    const vehicleId = isVehicleIdSegment(req.params.vehicleId) ? req.params.vehicleId : null;
    if (!vehicleId) {
      cb(new AppError(400, "ID de véhicule invalide"), "");
      return;
    }
    const vehicleDirectory = vehicleDocumentDirectory(vehicleId);
    if (!vehicleDirectory) {
      // Identifiant valide mais `vehicle-<id>` mène hors de `uploads/documents` (lien) : ce n'est pas l'id qui est en cause.
      log.warn({ vehicleId, reason: "dossier du véhicule hors de uploads/documents" }, "dépôt de document refusé");
      cb(new AppError(400, "Dossier de destination invalide"), "");
      return;
    }

    // multer n'entoure pas `destination` d'un try : une erreur disque doit passer par `cb`.
    try {
      fs.mkdirSync(vehicleDirectory, { recursive: true });
    } catch (err) {
      cb(new AppError(500, "Le dépôt du fichier a échoué.", { cause: err }), "");
      return;
    }

    cb(null, vehicleDirectory);
  },
  filename: (req, file, cb) => {
    // Générer un nom de fichier unique
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    
    cb(null, `${safeName.substring(0, 30)}-${uniqueSuffix}${extension}`);
  }
});

/** Extensions admises par type MIME : l'extension doit correspondre au type déclaré (M3). */
export const ALLOWED_EXTENSIONS_BY_MIME: Record<string, readonly string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/jpg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};

/** Vrai si le type MIME est admis ET l'extension du nom cohérente avec lui. */
export function isAllowedUpload(mimetype: string, originalName: string): boolean {
  // Propriété propre seulement : « constructor » ou « __proto__ » remonteraient au prototype.
  if (!Object.hasOwn(ALLOWED_EXTENSIONS_BY_MIME, mimetype)) return false;
  return ALLOWED_EXTENSIONS_BY_MIME[mimetype].includes(path.extname(originalName).toLowerCase());
}

// Filtre pour vérifier les types de fichiers acceptés
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (!Object.hasOwn(ALLOWED_EXTENSIONS_BY_MIME, file.mimetype)) {
    cb(new AppError(400, "Type de fichier non supporté. Veuillez télécharger un PDF, image, Word ou Excel."));
  } else if (!isAllowedUpload(file.mimetype, file.originalname)) {
    cb(new AppError(400, "L'extension du fichier ne correspond pas à son type. Vérifiez le fichier téléversé."));
  } else {
    cb(null, true);
  }
};

// Limite de taille de fichier (10 MB)
const fileSizeLimit = 10 * 1024 * 1024;

// Créer le middleware d'upload pour les documents des véhicules
export const uploadVehicleDocument = multer({
  storage: vehicleDocumentStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: fileSizeLimit
  }
}).single('document');

/**
 * Supprime un fichier téléversé. Même règle que `uploadedFileCandidates` (formes `uploads/…` et
 * `/uploads/…`) : tout chemin hors de `<root>/uploads` est refusé, sans suppression et avec un
 * message sans le chemin. Un chemin lu en base ne doit jamais atteindre un fichier que
 * l'application n'a pas déposé (AGENTS.md §9).
 */
export function deleteFile(filePath: string, root = process.cwd()): Promise<void> {
  return new Promise((resolve, reject) => {
    const candidates = uploadedFileCandidates(filePath, root);
    const target = candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
    if (!target) {
      reject(new Error('suppression refusée : fichier hors du dossier des téléversements'));
      return;
    }
    fs.unlink(target, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

export default {
  uploadVehicleDocument,
  deleteFile
};