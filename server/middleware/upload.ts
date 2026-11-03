import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request } from 'express';

// Dossier pour stocker les documents des véhicules
const UPLOAD_DIRECTORY = './uploads/documents';

// S'assurer que le dossier existe
if (!fs.existsSync(UPLOAD_DIRECTORY)) {
  fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true });
}

/** Identifiant de véhicule utilisable comme segment de chemin : chiffres seuls. */
export function isVehicleIdSegment(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,18}$/.test(value);
}

/**
 * Dossier disque des documents d'un véhicule, ou `null` si l'identifiant n'est pas un
 * nombre ou si le chemin résolu sortirait de `uploads/documents` (#130). Le chemin rendu
 * garde la forme relative `uploads/documents/vehicle-<id>` stockée en base.
 */
export function vehicleDocumentDirectory(vehicleId: unknown): string | null {
  if (!isVehicleIdSegment(vehicleId)) return null;
  const directory = path.join(UPLOAD_DIRECTORY, `vehicle-${vehicleId}`);
  const relative = path.relative(path.resolve(UPLOAD_DIRECTORY), path.resolve(directory));
  if (relative === "" || path.isAbsolute(relative) || relative.split(path.sep)[0] === "..") return null;
  return directory;
}

// Configuration de stockage multer pour les documents des véhicules
const vehicleDocumentStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Créer un dossier pour chaque véhicule
    const vehicleDirectory = vehicleDocumentDirectory(req.params.vehicleId);
    if (!vehicleDirectory) {
      cb(new Error("ID de véhicule invalide"), "");
      return;
    }

    if (!fs.existsSync(vehicleDirectory)) {
      fs.mkdirSync(vehicleDirectory, { recursive: true });
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

// Filtre pour vérifier les types de fichiers acceptés
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Types de fichiers autorisés
  const allowedMimeTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non supporté. Veuillez télécharger un PDF, image, Word ou Excel.'));
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

// Fonction utilitaire pour supprimer un fichier
export function deleteFile(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, (err) => {
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