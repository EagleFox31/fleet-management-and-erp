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
        const segment = `mission-${parseMissionId(req.params.id)}`;
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
  limits: { fileSize: POD_MAX_FILE_BYTES, files: POD_MAX_FILES },
}).array("files", POD_MAX_FILES);

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
    next(error);
  });
}

function removeFiles(files: readonly { path: string }[]) {
  for (const file of files) {
    try {
      fs.rmSync(file.path, { force: true });
    } catch (error) {
      log.warn({ err: error }, "suppression d'un fichier POD écarté");
    }
  }
}

function readHead(file: string): Uint8Array {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function sha256Of(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
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
router.post("/:id/pod-files", authorize([...MISSION_STATUS_ROLES]), uploadFiles, async (req, res, next) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const missionId = parseMissionId(req.params.id);
    if (files.length === 0) throw new AppError(400, "Aucun fichier reçu : joignez une photo ou un PDF.");

    // Le contenu réel doit correspondre au type déclaré : sinon rien n'est gardé.
    const prepared = files.map((file) => {
      const head = readHead(file.path);
      const detected = detectUploadMime(head);
      if (detected !== file.mimetype) {
        throw new AppError(400, isHeic(head) ? HEIC_UPLOAD_MESSAGE : UNREADABLE_UPLOAD_MESSAGE);
      }
      return { file, mime: detected, sha256: sha256Of(file.path) };
    });

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

    // Doublons : le fichier venant d'être écrit n'est pas gardé, le contenu est déjà enregistré.
    removeFiles(files.filter((file) => !result.kept.includes(file.path)));

    if (result.stored.length > 0 && result.uploadedAt) {
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
    }

    log.info({ requestId: req.requestId, missionId, stored: result.stored.length, duplicates: result.duplicates }, "POD déposé");
    res.status(201).json({
      files: result.stored.map(({ row }) => publicFile(row)),
      duplicates: result.duplicates,
      fileCount: result.total,
    });
  } catch (error) {
    removeFiles(files);
    next(error);
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
    const diskPath = row ? uploadedFileCandidates(row.path).find((candidate) => fs.existsSync(candidate)) : undefined;
    if (!row || !diskPath) throw new AppError(404, "Fichier POD introuvable.");

    const inline = ALLOWED_MIMES.includes(row.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (inline) res.setHeader("Content-Security-Policy", "sandbox");
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
