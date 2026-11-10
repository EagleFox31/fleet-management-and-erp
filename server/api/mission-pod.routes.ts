import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { MISSION_STATUS_ROLES } from "@shared/constants/roles";
import { MISSION_POD_MIME_TYPES, missionPodFiles, missions, users } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { contentDisposition } from "../lib/content-disposition";
import { canAccessMissionAsDriver, OUT_OF_DRIVER_SCOPE_MESSAGE } from "../lib/driver-scope";
import {
  detectUploadMime,
  EXTENSION_OF_MIME,
  HEIC_UPLOAD_MESSAGE,
  isHeic,
  UNREADABLE_UPLOAD_MESSAGE,
  type UploadMime,
} from "../lib/file-signature";
import { moduleLogger } from "../lib/logger";
import { emitMissionEvent } from "../lib/mission-events";
import { MISSION_ID_INVALID_MESSAGE, parseRouteId } from "../lib/route-id";
import { isInsideDirectory, isSafePathSegment, realPathStaysInside, uploadedFileCandidates } from "../lib/uploaded-file";
import { authorize } from "../middleware/auth";

/**
 * Preuve de livraison (POD) d'une mission. Monté sous /api/missions AVANT missions.routes.ts, avec les
 * mêmes middlewares (authenticate, isStaff) : la garde `router.param("id")` ci-dessous reproduit celle de
 * missions.routes.ts (cloison chauffeur), car ce routeur répond avant lui sur ces chemins.
 * Ajouts seulement : aucune modification ni suppression de fichier.
 */
const router = Router();
const log = moduleLogger("mission-pod");

export const POD_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const POD_MAX_FILES = 10;
const POD_ROOT = ["uploads", "missions", "pod"] as const;
/** Statuts où une preuve a un sens : la livraison est en cours, faite ou close. */
const POD_ALLOWED_STATUSES = ["in_progress", "delivered", "completed"] as const;
const POD_STATUS_MESSAGE = "Le POD se dépose une fois la mission en cours ou livrée.";

const ALLOWED_MIMES: readonly string[] = MISSION_POD_MIME_TYPES;
/** Extensions de nom acceptées pour chaque type (cohérence nom / type déclaré, jamais utilisées pour stocker). */
const NAME_EXTENSIONS: Record<UploadMime, readonly string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

router.param("id", async (req, _res, next, value) => {
  try {
    const missionId = parseRouteId(value, MISSION_ID_INVALID_MESSAGE);
    if (!(await canAccessMissionAsDriver(req.user, missionId))) {
      throw new AppError(403, OUT_OF_DRIVER_SCOPE_MESSAGE);
    }
    next();
  } catch (error) {
    next(error);
  }
});

const parseMissionId = (value: unknown) => parseRouteId(value, MISSION_ID_INVALID_MESSAGE);

function refusedFormat(file: { mimetype: string; originalname: string }): AppError {
  const heic = /heic|heif/i.test(file.mimetype) || /\.(heic|heif)$/i.test(file.originalname);
  return new AppError(400, heic ? HEIC_UPLOAD_MESSAGE : UNREADABLE_UPLOAD_MESSAGE);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      try {
        const segment = `mission-${parseMissionId(req.params.id)}`; // isSafePathSegment( ci-dessous
        if (!isSafePathSegment(segment)) throw new AppError(400, MISSION_ID_INVALID_MESSAGE);
        const root = path.resolve(process.cwd(), ...POD_ROOT);
        const dir = path.join(root, segment);
        if (!isInsideDirectory(root, dir) || !realPathStaysInside(path.resolve(process.cwd(), "uploads"), dir)) {
          throw new AppError(400, MISSION_ID_INVALID_MESSAGE);
        }
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (error) {
        cb(error as Error, "");
      }
    },
    // Extension tirée du type déclaré (déjà filtré), jamais de `originalname`.
    filename: (_req, file, cb) => cb(null, `${randomUUID()}.${EXTENSION_OF_MIME[file.mimetype as UploadMime]}`),
  }),
  fileFilter: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIMES.includes(file.mimetype) && NAME_EXTENSIONS[file.mimetype as UploadMime].includes(extension)) {
      cb(null, true);
      return;
    }
    cb(refusedFormat(file));
  },
  limits: { fileSize: POD_MAX_FILE_BYTES, files: POD_MAX_FILES, fields: 5, fieldSize: 1024 },
}).array("files", POD_MAX_FILES);

/** La mission doit exister avant multer : sinon un 404 laisse un dossier vide `mission-<id>` sur le disque. */
async function ensureMissionExists(req: Request, _res: Response, next: NextFunction) {
  try {
    const missionId = parseMissionId(req.params.id);
    const [mission] = await db.select({ id: missions.id }).from(missions).where(eq(missions.id, missionId)).limit(1);
    if (!mission) throw new AppError(404, "Mission non trouvée.");
    next();
  } catch (error) {
    next(error);
  }
}

function uploadFiles(req: Request, res: Response, next: NextFunction) {
  upload(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Un fichier dépasse 10 Mo."
          : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE"
            ? `Dix fichiers au plus par dépôt.`
            : "Dépôt de fichiers invalide.";
      return next(new AppError(400, message, { cause: error }));
    }
    // Multipart tronqué ou mal formé : une erreur du client, pas un 500.
    next(error instanceof AppError ? error : new AppError(400, "Dépôt de fichiers invalide.", { cause: error }));
  });
}

function removeFiles(files: readonly { path: string }[]) {
  for (const file of files) {
    try {
      for (const candidate of uploadedFileCandidates(file.path)) fs.rmSync(candidate, { force: true });
    } catch (error) {
      log.warn({ err: error }, "suppression d'un fichier POD écarté");
    }
  }
}

function readHead(stored: string): Uint8Array {
  const file = uploadedFileCandidates(stored).find(() => true);
  if (!file) throw new AppError(400, UNREADABLE_UPLOAD_MESSAGE);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/** Empreinte en flux : un fichier de 10 Mo (jusqu'à 100 Mo par dépôt) ne bloque plus la boucle d'événements. */
function sha256Of(stored: string): Promise<string> {
  const file = uploadedFileCandidates(stored).find(() => true);
  if (!file) return Promise.reject(new AppError(400, UNREADABLE_UPLOAD_MESSAGE));
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

const publicFile = (row: {
  id: number;
  originalName: string | null;
  mime: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadedByName?: string | null;
}) => ({
  id: row.id,
  originalName: row.originalName,
  mime: row.mime,
  sizeBytes: row.sizeBytes,
  uploadedAt: row.uploadedAt,
  ...(row.uploadedByName !== undefined ? { uploadedByName: row.uploadedByName } : {}),
});

// POST /api/missions/:id/pod-files
router.post("/:id/pod-files", authorize([...MISSION_STATUS_ROLES]), ensureMissionExists, uploadFiles, async (req, res, next) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  let recorded = false;
  try {
    const missionId = parseMissionId(req.params.id);
    if (files.length === 0) throw new AppError(400, "Aucun fichier reçu : joignez une photo ou un PDF.");

    // Le contenu réel doit correspondre au type déclaré : sinon rien n'est gardé.
    const prepared: { file: Express.Multer.File; mime: UploadMime; sha256: string }[] = [];
    for (const file of files) {
      const head = readHead(file.path);
      const detected = detectUploadMime(head);
      if (detected !== file.mimetype) {
        throw new AppError(400, isHeic(head) ? HEIC_UPLOAD_MESSAGE : UNREADABLE_UPLOAD_MESSAGE);
      }
      prepared.push({ file, mime: detected, sha256: await sha256Of(file.path) });
    }

    const userId = req.user!.id;
    const result = await db.transaction(async (tx) => {
      const [mission] = await tx
        .select({ id: missions.id, status: missions.status })
        .from(missions)
        .where(eq(missions.id, missionId))
        .for("update")
        .limit(1);
      if (!mission) throw new AppError(404, "Mission non trouvée.");
      if (!(POD_ALLOWED_STATUSES as readonly string[]).includes(mission.status)) {
        throw new AppError(409, POD_STATUS_MESSAGE);
      }

      const stored: { id: number; row: typeof missionPodFiles.$inferSelect }[] = [];
      const kept: string[] = [];
      let duplicates = 0;
      for (const item of prepared) {
        const relative = path.posix.join(...POD_ROOT, `mission-${missionId}`, path.basename(item.file.path));
        const [row] = await tx
          .insert(missionPodFiles)
          .values({
            missionId,
            path: relative,
            originalName: item.file.originalname.slice(0, 255) || null,
            mime: item.mime,
            sizeBytes: item.file.size,
            sha256: item.sha256,
            uploadedBy: userId,
          })
          .onConflictDoNothing({ target: [missionPodFiles.missionId, missionPodFiles.sha256] })
          .returning();
        if (row) {
          stored.push({ id: row.id, row });
          kept.push(item.file.path);
        } else {
          duplicates += 1;
        }
      }

      const [{ total }] = await tx
        .select({ total: count() })
        .from(missionPodFiles)
        .where(eq(missionPodFiles.missionId, missionId));
      const [latest] = await tx
        .select({ id: missionPodFiles.id })
        .from(missionPodFiles)
        .where(eq(missionPodFiles.missionId, missionId))
        .orderBy(desc(missionPodFiles.id))
        .limit(1);
      let uploadedAt: Date | null = null;
      if (stored.length > 0) {
        const [updated] = await tx
          .update(missions)
          .set({ podUrl: `/api/missions/${missionId}/pod-files/${latest.id}`, podUploadedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(missions.id, missionId))
          .returning({ podUploadedAt: missions.podUploadedAt });
        uploadedAt = updated.podUploadedAt;
      }
      return { stored, kept, duplicates, total, latestId: latest?.id ?? null, uploadedAt };
    });

    // Écriture validée : le sort des fichiers ne dépend plus d'un échec ultérieur.
    recorded = true;

    // Doublons : le fichier venant d'être écrit n'est pas gardé, le contenu est déjà enregistré.
    removeFiles(files.filter((file) => !result.kept.includes(file.path)));

    if (result.stored.length > 0 && result.uploadedAt) {
      try {
        await emitMissionEvent(
          "mission_pod_uploaded",
          missionId,
          {
            version: 1,
            entity: "mission",
            entityId: missionId,
            payload: {
              missionId,
              fileCount: result.total,
              latestFileId: result.latestId,
              uploadedAt: result.uploadedAt.toISOString(),
            },
          },
          req.requestId,
        );
      } catch (error) {
        log.warn({ err: error, requestId: req.requestId, missionId }, "diffusion mission_pod_uploaded en échec");
      }
    }

    log.info({ requestId: req.requestId, missionId, stored: result.stored.length, duplicates: result.duplicates }, "POD déposé");
    res.status(201).json({
      files: result.stored.map(({ row }) => publicFile(row)),
      duplicates: result.duplicates,
      fileCount: result.total,
    });
  } catch (error) {
    next(error);
  } finally {
    if (!recorded) removeFiles(files);
  }
});

// GET /api/missions/:id/pod-files : métadonnées seulement, jamais le chemin disque.
router.get("/:id/pod-files", async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);
    const rows = await db
      .select({
        id: missionPodFiles.id,
        originalName: missionPodFiles.originalName,
        mime: missionPodFiles.mime,
        sizeBytes: missionPodFiles.sizeBytes,
        uploadedAt: missionPodFiles.uploadedAt,
        uploadedByName: users.name,
      })
      .from(missionPodFiles)
      .leftJoin(users, eq(users.id, missionPodFiles.uploadedBy))
      .where(eq(missionPodFiles.missionId, missionId))
      .orderBy(asc(missionPodFiles.uploadedAt), asc(missionPodFiles.id));
    res.json({ files: rows.map(publicFile) });
  } catch (error) {
    next(error);
  }
});

// GET /api/missions/:id/pod-files/:fileId : le fichier, servi sans exécution possible dans l'origine de l'application.
router.get("/:id/pod-files/:fileId", async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);
    const fileId = parseRouteId(req.params.fileId, "Identifiant de fichier invalide.");
    const [row] = await db
      .select()
      .from(missionPodFiles)
      .where(and(eq(missionPodFiles.id, fileId), eq(missionPodFiles.missionId, missionId)))
      .limit(1);
    const diskPath = uploadedFileCandidates(row?.path).find((candidate) => fs.existsSync(candidate));
    if (!row || !diskPath) throw new AppError(404, "Fichier POD introuvable.");

    // Les PDF sortent en pièce jointe : le visionneur PDF de Chrome refuse un document sous CSP sandbox.
    // Seules les images sont affichées en ligne.
    const inline = row.mime.startsWith("image/");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "sandbox");
    const headers = {
      "Content-Type": row.mime,
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", row.originalName ?? path.basename(diskPath)),
    };
    res.sendFile(diskPath, { headers }, (err) => {
      if (err && !res.headersSent) next(new AppError(404, "Fichier POD introuvable.", { cause: err }));
    });
  } catch (error) {
    next(error);
  }
});

export default router;
