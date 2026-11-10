import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { MISSION_READ_ROLES, MISSION_STATUS_ROLES } from "@shared/constants/roles";
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
/** Plafond de fichiers conservés par mission, toutes remises confondues. */
export const POD_MAX_FILES_PER_MISSION = 50;
const POD_TOO_MANY_MESSAGE = "Cinquante fichiers au plus par mission : supprimez-en avant d'en ajouter.";
const POD_INVALID_MESSAGE = "Dépôt de fichiers invalide.";
const POD_STORAGE_MESSAGE = "Le dépôt n'a pas pu être enregistré. Réessayez dans un instant.";
/** Messages de busboy / multer pour un corps multipart tronqué ou mal formé (erreur du client). */
const MALFORMED_MULTIPART = /^(unexpected end of|malformed|missing content-type|unsupported content type|multipart: boundary not found|part terminated early)/i;
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

/** Un fichier ouvert pour cette remise : son flux d'écriture et sa fin (fermeture du descripteur). */
type PodStarted = { path: string; out: fs.WriteStream; closed: Promise<void> };
type PodRequest = Request & { podStarted?: PodStarted[] };

/** Dossier de dépôt de la mission, validé (segment sûr, sous uploads/missions/pod). */
function podDirectoryOf(req: Request): string {
  const segment = `mission-${parseMissionId(req.params.id)}`; // isSafePathSegment( ci-dessous
  if (!isSafePathSegment(segment)) throw new AppError(400, MISSION_ID_INVALID_MESSAGE);
  const root = path.resolve(process.cwd(), ...POD_ROOT);
  const dir = path.join(root, segment);
  if (!isInsideDirectory(root, dir) || !realPathStaysInside(path.resolve(process.cwd(), "uploads"), dir)) {
    throw new AppError(400, MISSION_ID_INVALID_MESSAGE);
  }
  return dir;
}

/**
 * Stockage disque qui garde la main sur chaque flux d'écriture. multer ne connaît que les fichiers terminés :
 * un flux tronqué laisse un fichier à moitié écrit, et l'ouverture du descripteur étant asynchrone, un
 * `unlink` envoyé trop tôt est suivi de la création du fichier. Ici chaque flux est suivi dès son ouverture,
 * détruit sur erreur, et la suppression attend sa fermeture.
 */
const podStorage: multer.StorageEngine = {
  _handleFile(req, file, cb) {
    let started: PodStarted;
    try {
      const dir = podDirectoryOf(req);
      fs.mkdirSync(dir, { recursive: true });
      // Extension tirée du type déclaré (déjà filtré), jamais de `originalname`.
      const target = path.join(dir, `${randomUUID()}.${EXTENSION_OF_MIME[file.mimetype as UploadMime]}`);
      const out = fs.createWriteStream(target, { flags: "wx" });
      started = { path: target, out, closed: new Promise<void>((resolve) => out.once("close", () => resolve())) };
    } catch (error) {
      return cb(error as Error);
    }
    ((req as PodRequest).podStarted ??= []).push(started);
    const { out, path: target } = started;
    // Flux source interrompu (corps tronqué) : la sortie est détruite, donc fermée, et l'erreur remonte.
    file.stream.once("error", (error) => out.destroy(error));
    out.once("error", cb);
    out.once("finish", () => cb(null, { destination: path.dirname(target), filename: path.basename(target), path: target, size: out.bytesWritten }));
    file.stream.pipe(out);
  },
  _removeFile(_req, file, cb) {
    try {
      for (const candidate of uploadedFileCandidates((file as { path: string }).path)) fs.rmSync(candidate, { force: true });
      cb(null);
    } catch (error) {
      cb(error as Error);
    }
  },
};

/** Ferme les flux encore ouverts de la remise, attend leur fermeture, puis supprime leurs fichiers. */
async function discardStarted(req: Request): Promise<void> {
  const started = (req as PodRequest).podStarted ?? [];
  for (const item of started) item.out.destroy();
  await Promise.all(started.map((item) => item.closed));
  removeFiles(started);
}

const upload = multer({
  storage: podStorage,
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

/**
 * La mission doit exister, et son statut accepter une preuve, avant multer : sinon un 404 ou un 409
 * laisse un dossier vide `mission-<id>` (ou des fichiers à nettoyer) sur le disque.
 * Contrôle de confort : le verrou FOR UPDATE de la transaction reste l'arbitre.
 */
async function ensureMissionExists(req: Request, _res: Response, next: NextFunction) {
  try {
    const missionId = parseMissionId(req.params.id);
    const [mission] = await db.select({ id: missions.id, status: missions.status }).from(missions).where(eq(missions.id, missionId)).limit(1);
    if (!mission) throw new AppError(404, "Mission non trouvée.");
    if (!(POD_ALLOWED_STATUSES as readonly string[]).includes(mission.status)) throw new AppError(409, POD_STATUS_MESSAGE);
    next();
  } catch (error) {
    next(error);
  }
}

function uploadFiles(req: Request, res: Response, next: NextFunction) {
  upload(req, res, async (error: unknown) => {
    if (!error) return next();
    // La réponse part après la fermeture et la suppression : aucun fichier ne peut réapparaître.
    await discardStarted(req).catch((cause) => log.warn({ err: cause, requestId: req.requestId }, "nettoyage d'une remise POD interrompue"));
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Un fichier dépasse 10 Mo."
          : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE"
            ? `Dix fichiers au plus par dépôt.`
            : POD_INVALID_MESSAGE;
      return next(new AppError(400, message, { cause: error }));
    }
    if (error instanceof AppError) return next(error);
    // Multipart tronqué ou mal formé : une erreur du client. Le reste (disque plein, droits) est une panne serveur.
    if (error instanceof Error && MALFORMED_MULTIPART.test(error.message)) {
      return next(new AppError(400, POD_INVALID_MESSAGE, { cause: error }));
    }
    log.error({ err: error, requestId: req.requestId, missionId: req.params.id }, "écriture d'un fichier POD impossible");
    next(new AppError(500, POD_STORAGE_MESSAGE, { cause: error }));
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
      // Mission verrouillée : le décompte est exact. Le dépassement annule toute la remise.
      if (total > POD_MAX_FILES_PER_MISSION) throw new AppError(409, POD_TOO_MANY_MESSAGE);
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
router.get("/:id/pod-files", authorize([...MISSION_READ_ROLES]), async (req, res, next) => {
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
router.get("/:id/pod-files/:fileId", authorize([...MISSION_READ_ROLES]), async (req, res, next) => {
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
