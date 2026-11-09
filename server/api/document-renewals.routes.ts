import { Router, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { bodyIdSchema, idSchema } from "@shared/contracts/common";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { isAnyUser, isDocumentRenewalWriter } from "../middleware/auth";
import { assertVehicleWritable } from "../middleware/retired-vehicle-write-guard";
import { storage } from "../storage";
import { usersByRolesBestEffort } from "../lib/alert-recipients";
import { isIsoCalendarDate } from "@shared/constants/calendar-date";
import {
  DOCUMENT_RENEWAL_VIEWER_ROLES,
  DOCUMENT_RENEWAL_WRITER_ROLES,
  VEHICLE_DOCUMENT_EVENT_ROLES,
} from "@shared/constants/roles";
import {
  DOCUMENT_RENEWAL_REQUEST_STATUSES,
  OPEN_DOCUMENT_RENEWAL_STATUSES,
  RENEWAL_RECEIPT_MAX_VALIDITY_DAYS,
  addDaysToIsoDate,
  documentRenewalTransitionRefusal,
  isDocumentRenewalRequestStatus,
} from "@shared/constants/document-renewal-statuses";
import { REALTIME_EVENTS, type RealtimeScope } from "@shared/contracts/realtime-events";
import { todayUtcDateOnly } from "@shared/lib/utc-day";
import { isInsideDirectory, realPathStaysInside, uploadedFileCandidates } from "../lib/uploaded-file";
import { contentDisposition } from "../lib/content-disposition";
import { renewalReceiptErrorOf, withoutDiskPaths } from "../lib/renewal-receipts";
import { nameSchema, optionalText } from "@shared/contracts/document-renewal-centers";
import { resolveRenewalCenter } from "../lib/document-renewal-center-resolver";
import { AppError } from "../lib/app-error";
import { parseQueryId, parseRouteId } from "../lib/route-id";
import { syncVehicleDocumentMirror } from "../lib/vehicle-document-mirror";
import { moduleLogger } from "../lib/logger";
import { broadcastAlertCreated as broadcastSharedAlertCreated, type BroadcastableAlert } from "../lib/alert-broadcast";
import { alertInboxService } from "../services/alert-inbox-service";
import {
  documentRenewalCenters,
  documentRenewalRequests,
  drivers,
  users,
  vehicleDocuments,
  vehicles,
} from "@shared/schema";
import { withLogContext } from "../lib/error-log-context";
import { canAccessOwned, OUT_OF_SCOPE_MESSAGE } from "../lib/client-scope";
import { vehicleReadableBy } from "../lib/vehicle-retired";

const log = moduleLogger("document-renewals");
const router = Router();
router.use(isAnyUser);

const CREATE_ROLES: Set<string> = new Set(DOCUMENT_RENEWAL_WRITER_ROLES);
const VIEW_ROLES: Set<string> = new Set(DOCUMENT_RENEWAL_VIEWER_ROLES);
const REQUESTABLE_DOCUMENT_TYPES = ["carte_grise", "assurance", "visite_technique", "taxe", "autre"] as const;

/** Nom de centre facultatif : vide devient null, sinon mêmes bornes que le contrat des centres. */
const centerNameField = optionalText(150).pipe(
  z.union([z.null(), nameSchema]),
);

const ASSIGNED_ROLES = ["admin", "secretary", "logistics", "workshop_manager"] as const;
const ESCORT_ROLES = ["driver", "technician"] as const;
const REQUEST_STATUSES = DOCUMENT_RENEWAL_REQUEST_STATUSES;

const DOCUMENT_LABELS: Record<(typeof REQUESTABLE_DOCUMENT_TYPES)[number], string> = {
  carte_grise: "Carte grise",
  assurance: "Assurance",
  visite_technique: "Visite technique",
  taxe: "Taxe",
  autre: "Document",
};

const normalizeRole = (role: string | null | undefined): string => {
  return String(role || "")
    .trim()
    .toLowerCase();
};

const hasRole = (role: string | null | undefined, accepted: Set<string>): boolean => {
  return accepted.has(normalizeRole(role));
};

const broadcastDocumentRenewalEvent = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    requestId?: number | null;
    actorUserId?: number | null;
    actorRole?: string | null;
    scope?: RealtimeScope;
  },
) => {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate(eventType, {
    version: 1,
    entity: "document_renewal_request",
    entityId: options?.requestId ?? null,
    payload,
    // Toute diffusion de ce routeur reste réservée aux rôles qui lisent les demandes.
    scope: options?.scope ?? { type: "roles", roles: [...DOCUMENT_RENEWAL_VIEWER_ROLES] },
    actor: {
      userId: options?.actorUserId ?? null,
      role: options?.actorRole ?? null,
    },
    emittedAt: new Date().toISOString(),
  });
};

const broadcastVehicleDocumentEvent = (
  payload: {
    vehicleId: number;
    documentId: number;
    documentType: string;
    newExpiryDate: string | null;
  },
  options?: {
    actorUserId?: number | null;
    actorRole?: string | null;
    /** Propriétaire du véhicule (`vehicles.ownerId`) : seul client à recevoir la trame. */
    ownerId?: number | null;
  },
) => {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  // Cloison (AGENTS.md §11) : la trame porte véhicule, papier et échéance. Le personnel la
  // reçoit, et parmi les clients seul le propriétaire du véhicule ; jamais en broadcast.
  const scopes: RealtimeScope[] = [{ type: "roles", roles: [...VEHICLE_DOCUMENT_EVENT_ROLES] }];
  if (options?.ownerId) scopes.push({ type: "user", userIds: [options.ownerId] });

  for (const scope of scopes) {
    broadcastUpdate("vehicle_updated", {
      version: 1,
      entity: "vehicle",
      entityId: payload.vehicleId,
      payload: {
        vehicleId: payload.vehicleId,
        documentId: payload.documentId,
        documentType: payload.documentType,
        newExpiryDate: payload.newExpiryDate,
        source: "document_renewal",
      },
      scope,
      actor: {
        userId: options?.actorUserId ?? null,
        role: options?.actorRole ?? null,
      },
      emittedAt: new Date().toISOString(),
    });
  }
};

/** Exporté pour le contrat de portée (repli personnel d'une alerte sans destinataire). */
// Une alerte sans destinataire reste au personnel (§11), jamais en broadcast.
export const broadcastAlertCreated = (alert: BroadcastableAlert) =>
  broadcastSharedAlertCreated(alert, VEHICLE_DOCUMENT_EVENT_ROLES);

const renewalProofUploadDir = path.join(
  process.cwd(),
  "uploads",
  "document-renewals",
  "proofs",
);

// Extension déduite du type MIME autorisé, jamais du nom envoyé par le client (justificatif et récépissé).
const RENEWAL_FILE_EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// Type servi d'après l'extension stockée ; toute autre extension (fichier antérieur) part en octet-stream.
const RENEWAL_FILE_CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

if (!fs.existsSync(renewalProofUploadDir)) {
  fs.mkdirSync(renewalProofUploadDir, { recursive: true });
}

const uploadRenewalProof = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, renewalProofUploadDir),
    filename: (_req, file, cb) => {
      const extension = RENEWAL_FILE_EXTENSION_BY_MIME[file.mimetype] ?? ".bin";
      const baseName = (file.originalname || "proof")
        .replace(/\.[^.]*$/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 40);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${baseName || "proof"}-${uniqueSuffix}${extension}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (Object.hasOwn(RENEWAL_FILE_EXTENSION_BY_MIME, file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Justificatif invalide. Formats acceptés: PDF, JPG, PNG, WEBP."));
  },
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
}).single("proofFile");

// Récépissé provisoire : dossier fixe, aucun segment de chemin ne vient de la requête (AGENTS.md §9).
const renewalReceiptUploadDir = path.join(process.cwd(), "uploads", "document-renewals", "receipts");
// Seule la date de validité vient du corps ; fichier, chemin, déposant et horodatage sont posés par le serveur.
const receiptDepositSchema = z.object({
  validUntil: z.string().refine(isIsoCalendarDate),
});
const RECEIPT_STORED_PREFIX ="uploads/document-renewals/receipts";


const uploadRenewalReceipt = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdirSync(renewalReceiptUploadDir, { recursive: true });
      cb(null, renewalReceiptUploadDir);
    },
    filename: (_req, file, cb) => {
      const extension = RENEWAL_FILE_EXTENSION_BY_MIME[file.mimetype] ?? ".bin";
      const baseName = (file.originalname || "recepisse")
        .replace(/\.[^.]*$/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .slice(0, 40);
      cb(null, `${baseName || "recepisse"}-${Date.now()}-${Math.round(Math.random() * 1e9)}${extension || ".bin"}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    cb(null, Object.hasOwn(RENEWAL_FILE_EXTENSION_BY_MIME, file.mimetype));
  },
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
}).single("receiptFile");

/** Supprime un fichier du dossier uploads/ ; tout chemin hors de uploads/ est ignoré (uploadedFileCandidates). */
const removeUploadedFile = (storedPath: string | null | undefined, requestId?: string) => {
  for (const candidate of uploadedFileCandidates(storedPath)) {
    fs.unlink(candidate, (err) => {
      if (err && err.code !== "ENOENT") log.warn({ err, requestId }, "suppression d'un fichier de récépissé");
    });
  }
};

const readField = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return readField(value[0]);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
};

const buildCenterAccreditationFallback = (centerId: number): string => {
  return `AGR-${String(centerId).padStart(4, "0")}`;
};

const resolveCenterAccreditation = (center: { id: number; accreditationNumber?: string | null }): string => {
  const raw = center.accreditationNumber?.trim();
  return raw && raw.length > 0 ? raw : buildCenterAccreditationFallback(center.id);
};

router.get("/centers", async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!hasRole(role, VIEW_ROLES)) {
      return res.status(403).json({ message: "Accès non autorisé" });
    }

    const documentTypeRaw = String(req.query.documentType || "").trim();
    const isTyped =
      documentTypeRaw.length > 0 &&
      (REQUESTABLE_DOCUMENT_TYPES as readonly string[]).includes(documentTypeRaw);

    // Écran de gestion (DOC1) : centres désactivés visibles des seuls rôles écrivains, 403 sinon.
    const includeInactive = req.query.includeInactive === "1";
    if (includeInactive && !hasRole(role, CREATE_ROLES)) {
      return res.status(403).json({ message: "Accès non autorisé" });
    }

    const rows = await db
      .select({
        id: documentRenewalCenters.id,
        name: documentRenewalCenters.name,
        documentType: documentRenewalCenters.documentType,
        accreditationNumber: documentRenewalCenters.accreditationNumber,
        address: documentRenewalCenters.address,
        contact: documentRenewalCenters.contact,
        isActive: documentRenewalCenters.isActive,
      })
      .from(documentRenewalCenters)
      .where(
        isTyped
          ? and(
              includeInactive ? undefined : eq(documentRenewalCenters.isActive, true),
              sql`(${documentRenewalCenters.documentType} is null or ${documentRenewalCenters.documentType} = ${documentTypeRaw})`,
            )
          : includeInactive
            ? undefined
            : eq(documentRenewalCenters.isActive, true),
      )
      .orderBy(documentRenewalCenters.name);

    return res.status(200).json(
      rows.map((row) => ({
        ...row,
        accreditationNumber: resolveCenterAccreditation(row),
      })),
    );
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "lecture des centres de renouvellement" }));
  }
});

router.get("/requests", async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!hasRole(role, VIEW_ROLES)) {
      return res.status(403).json({ message: "Accès non autorisé" });
    }

    const vehicleId = parseQueryId(req.query.vehicleId, "ID de véhicule invalide");
    const status = String(req.query.status || "").trim();
    const statusFilter = (REQUEST_STATUSES as readonly string[]).includes(status) ? status : null;

    const conditions = [sql`1=1`];
    if (vehicleId !== undefined) {
      conditions.push(eq(documentRenewalRequests.vehicleId, vehicleId));
    }
    if (statusFilter) {
      conditions.push(eq(documentRenewalRequests.status, statusFilter as any));
    }

    const rows = await db
      .select({
        id: documentRenewalRequests.id,
        vehicleId: documentRenewalRequests.vehicleId,
        vehicleDocumentId: documentRenewalRequests.vehicleDocumentId,
        documentType: documentRenewalRequests.documentType,
        status: documentRenewalRequests.status,
        requestedBy: documentRenewalRequests.requestedBy,
        requestedByName: users.name,
        assignedRole: documentRenewalRequests.assignedRole,
        centerId: documentRenewalRequests.centerId,
        centerNameSnapshot: documentRenewalRequests.centerNameSnapshot,
        centerAccreditationSnapshot: documentRenewalRequests.centerAccreditationSnapshot,
        escortRole: documentRenewalRequests.escortRole,
        escortUserId: documentRenewalRequests.escortUserId,
        targetDate: documentRenewalRequests.targetDate,
        comment: documentRenewalRequests.comment,
        renewalReference: documentRenewalRequests.renewalReference,
        renewalVisitDate: documentRenewalRequests.renewalVisitDate,
        inspectorName: documentRenewalRequests.inspectorName,
        inspectorCode: documentRenewalRequests.inspectorCode,
        proofFileName: documentRenewalRequests.proofFileName,
        createdAt: documentRenewalRequests.createdAt,
        updatedAt: documentRenewalRequests.updatedAt,
      })
      .from(documentRenewalRequests)
      .leftJoin(users, eq(documentRenewalRequests.requestedBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(documentRenewalRequests.createdAt));

    return res.status(200).json(rows);
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "lecture des demandes de renouvellement" }));
  }
});

/**
 * Justificatif déposé au renouvellement rapide. Lecture réservée aux rôles qui lisent les demandes ;
 * servi depuis le seul dossier des justificatifs (uploadedFileCandidates, AGENTS.md §9) ;
 * 404 si la demande n'en a pas ou si le fichier a disparu.
 */
router.get("/requests/:id/proof", async (req, res, next) => {
  try {
    if (!hasRole(req.user?.role, VIEW_ROLES)) {
      throw new AppError(403, "Accès non autorisé");
    }
    const requestId = parseRouteId(req.params.id, "Identifiant de demande invalide.");

    const [row] = await db
      .select({
        proofFilePath: documentRenewalRequests.proofFilePath,
        proofFileName: documentRenewalRequests.proofFileName,
        ownerId: vehicles.ownerId,
        deletedAt: vehicles.deletedAt,
      })
      .from(documentRenewalRequests)
      .leftJoin(vehicles, eq(vehicles.id, documentRenewalRequests.vehicleId))
      .where(eq(documentRenewalRequests.id, requestId))
      .limit(1);
    if (!row) {
      throw new AppError(404, "Demande introuvable");
    }
    // Cloison client (AGENTS.md §11), véhicule retiré compris. Inerte aujourd'hui : `client` n'est pas dans
    // DOCUMENT_RENEWAL_VIEWER_ROLES, la garde de rôle ci-dessus répond 403 avant. Elle prend effet si la liste
    // s'ouvre au client ; retired-vehicle-lists-client-scope.contract.test.ts échoue alors. Avant d'ouvrir,
    // cloisonner aussi `GET /requests` et `/centers` par `clientVehicleScope`, et écrire leur contrat.
    if (!(await canAccessOwned(req.user, async () => row.ownerId)) || !vehicleReadableBy(req.user?.role, row)) {
      throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
    }

    const proofPath = uploadedFileCandidates(row.proofFilePath).find(
      (candidate) =>
        isInsideDirectory(renewalProofUploadDir, candidate) &&
        realPathStaysInside(renewalProofUploadDir, candidate) &&
        fs.existsSync(candidate),
    );
    if (!proofPath) {
      throw new AppError(404, "Justificatif introuvable");
    }

    // Téléchargement, jamais rendu par le navigateur : type d'après l'extension stockée, sans détection.
    const contentType = RENEWAL_FILE_CONTENT_TYPE_BY_EXTENSION[path.extname(proofPath).toLowerCase()] ?? "application/octet-stream";
    res.setHeader("X-Content-Type-Options", "nosniff");
    const headers = {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition("attachment", row.proofFileName || path.basename(proofPath)),
    };
    return res.sendFile(proofPath, { headers }, (err) => {
      if (err && !res.headersSent) next(new AppError(404, "Justificatif introuvable", { cause: err }));
    });
  } catch (error) {
    return next(error);
  }
});

const createRequestPayloadSchema = z.object({
  vehicleId: bodyIdSchema,
  vehicleDocumentId: bodyIdSchema,
  comment: z
    .string()
    .trim()
    .min(3, "Le commentaire est obligatoire (min 3 caractères)."),
  assignedRole: z.enum(ASSIGNED_ROLES).optional().nullable(),
  targetDate: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (!value) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    })
    .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: "Date cible invalide (YYYY-MM-DD).",
    }),
  centerId: bodyIdSchema.optional().nullable(),
  centerName: centerNameField,
  centerAddress: optionalText(300),
  centerContact: optionalText(200),
  centerAccreditationNumber: optionalText(80),
  escortRole: z.enum(ESCORT_ROLES).optional().nullable(),
  escortUserId: bodyIdSchema.optional().nullable(),
  inspectorName: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (!value) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
  inspectorCode: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (!value) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
});

const quickRenewPayloadSchema = z.object({
  requestId: z.preprocess(
    (value) => (value === undefined || value === null || value === "" ? null : value),
    idSchema.nullable().optional(),
  ),
  vehicleId: idSchema,
  vehicleDocumentId: idSchema,
  comment: z
    .string()
    .trim()
    .min(3, "Le commentaire est obligatoire (min 3 caractères)."),
  assignedRole: z.preprocess(
    (value) => {
      if (value === undefined || value === null) return null;
      const normalized = String(value).trim();
      return normalized.length > 0 ? normalized : null;
    },
    z.enum(ASSIGNED_ROLES).nullable().optional(),
  ),
  centerId: z.preprocess(
    (value) => (value === undefined || value === null || value === "" ? null : value),
    idSchema.nullable().optional(),
  ),
  centerName: centerNameField,
  centerAddress: optionalText(300),
  centerContact: optionalText(200),
  centerAccreditationNumber: optionalText(80),
  visitReference: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (!value) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
  visitDate: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (!value) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    })
    .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), {
      message: "Date de visite invalide (YYYY-MM-DD).",
    }),
  newExpiryDate: z.string().refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Date d'expiration invalide (YYYY-MM-DD).",
  }),
  inspectorName: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (!value) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
  inspectorCode: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (!value) return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }),
});

router.post("/requests", isDocumentRenewalWriter, async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);

    const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
    if (!actorUserId) {
      return res.status(401).json({ message: "Session invalide." });
    }

    const parsedPayload = createRequestPayloadSchema.safeParse(req.body ?? {});
    if (!parsedPayload.success) {
      return res.status(400).json({
        message: "Payload invalide.",
        errors: parsedPayload.error.errors,
      });
    }

    const payload = parsedPayload.data;

    if (payload.escortUserId) {
      if (payload.escortRole === "driver") {
        const [driverRow] = await db
          .select({ id: drivers.id })
          .from(drivers)
          .where(eq(drivers.id, payload.escortUserId))
          .limit(1);

        if (!driverRow) {
          return res.status(400).json({ message: "Chauffeur accompagnateur introuvable." });
        }
      }

      if (payload.escortRole === "technician") {
        const [technicianRow] = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.id, payload.escortUserId))
          .limit(1);

        const technicianRole = normalizeRole(technicianRow?.role);
        if (!technicianRow || !["technician", "workshop_manager"].includes(technicianRole)) {
          return res.status(400).json({ message: "Technicien accompagnateur introuvable." });
        }
      }
    }

    const [documentRow] = await db
      .select({
        documentId: vehicleDocuments.id,
        documentType: vehicleDocuments.type,
        documentName: vehicleDocuments.name,
        documentExpiryDate: vehicleDocuments.expiryDate,
        vehicleId: vehicleDocuments.vehicleId,
        vehicleRegistration: vehicles.registrationNumber,
      })
      .from(vehicleDocuments)
      .leftJoin(vehicles, eq(vehicleDocuments.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicleDocuments.id, payload.vehicleDocumentId),
          eq(vehicleDocuments.vehicleId, payload.vehicleId),
        ),
      )
      .limit(1);

    if (!documentRow) {
      return res.status(404).json({ message: "Document du véhicule introuvable." });
    }

    const [existingOpenRequest] = await db
      .select({
        id: documentRenewalRequests.id,
        status: documentRenewalRequests.status,
      })
      .from(documentRenewalRequests)
      .where(
        and(
          eq(documentRenewalRequests.vehicleDocumentId, payload.vehicleDocumentId),
          inArray(documentRenewalRequests.status, ["pending", "in_progress"]),
        ),
      )
      .orderBy(desc(documentRenewalRequests.createdAt))
      .limit(1);

    if (existingOpenRequest) {
      return res.status(200).json({
        message: "Une demande de renouvellement est déjà ouverte pour ce document.",
        created: false,
        requestId: existingOpenRequest.id,
        status: existingOpenRequest.status,
      });
    }

    let centerId: number | null = payload.centerId ?? null;
    let centerNameSnapshot: string | null = null;
    let centerAccreditationSnapshot: string | null = null;

    const resolvedCenter = await resolveRenewalCenter({
      centerId,
      centerName: payload.centerName,
      centerAddress: payload.centerAddress,
      centerContact: payload.centerContact,
      centerAccreditationNumber: payload.centerAccreditationNumber,
      documentType: documentRow.documentType,
      actorUserId,
    });
    if (resolvedCenter && !resolvedCenter.ok) {
      return res.status(resolvedCenter.status).json({ message: resolvedCenter.message });
    }
    if (resolvedCenter) {
      centerId = resolvedCenter.id;
      centerNameSnapshot = resolvedCenter.name;
      centerAccreditationSnapshot = resolveCenterAccreditation(resolvedCenter);
    }

    const [createdRequest] = await db
      .insert(documentRenewalRequests)
      .values({
        vehicleId: payload.vehicleId,
        vehicleDocumentId: payload.vehicleDocumentId,
        documentType: documentRow.documentType as any,
        status: "pending",
        requestedBy: actorUserId,
        assignedRole: payload.assignedRole ?? null,
        centerId,
        centerNameSnapshot,
        centerAccreditationSnapshot,
        escortRole: payload.escortRole ?? null,
        escortUserId: payload.escortUserId ?? null,
        targetDate: payload.targetDate ?? null,
        comment: payload.comment,
        inspectorName: payload.inspectorName ?? null,
        inspectorCode: payload.inspectorCode ?? null,
        source: "vehicle_document",
      })
      .returning();

    const requestLink = `/vehicles/${payload.vehicleId}`;
    const documentLabel =
      DOCUMENT_LABELS[(documentRow.documentType as keyof typeof DOCUMENT_LABELS) || "autre"] || "Document";
    // La demande est écrite : une lecture des destinataires en échec réduit la notification, sans 500.
    const recipients = await usersByRolesBestEffort(
      ["admin", "workshop_manager", "secretary", "logistics", "technician"],
      log,
      { requestId: req.requestId, renewalRequestId: createdRequest.id },
    );

    const recipientIds = Array.from(new Set([...recipients.map((user) => user.id), actorUserId]));
    const messageParts = [
      `${documentLabel} à renouveler - véhicule ${documentRow.vehicleRegistration || `#${payload.vehicleId}`}.`,
      centerNameSnapshot ? `Centre: ${centerNameSnapshot}.` : null,
      centerAccreditationSnapshot ? `Agrément: ${centerAccreditationSnapshot}.` : null,
      payload.targetDate ? `Échéance cible: ${payload.targetDate}.` : null,
      `Demande #${createdRequest.id}.`,
    ].filter(Boolean);
    const alertMessage = messageParts.join(" ");

    for (const recipientId of recipientIds) {
      const alert = await storage.createAlert({
        userId: recipientId,
        title: `Demande renouvellement ${documentLabel}`,
        message: alertMessage,
        type: "maintenance",
        priority: "high",
        link: requestLink,
      });

      broadcastAlertCreated({
        id: alert.id,
        userId: alert.userId ?? null,
        title: alert.title,
        type: alert.type,
        priority: alert.priority,
        link: alert.link ?? null,
        message: alert.message,
      });
    }

    broadcastDocumentRenewalEvent(
      "document_renewal_request_created",
      {
        request: withoutDiskPaths(createdRequest),
        vehicleRegistration: documentRow.vehicleRegistration ?? null,
        documentName: documentRow.documentName,
        previousExpiryDate: documentRow.documentExpiryDate ?? null,
      },
      {
        requestId: createdRequest.id,
        actorUserId,
        actorRole: role,
      },
    );

    return res.status(201).json({
      message: "Demande de renouvellement créée.",
      created: true,
      request: withoutDiskPaths(createdRequest),
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "création d'une demande de renouvellement" }));
  }
});

/**
 * PATCH /api/document-renewals/requests/:id/status
 * Mettre à jour le statut d'une demande (ex: marquer comme traité)
 */
router.patch("/requests/:id/status", isDocumentRenewalWriter, async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);

    const id = parseRouteId(req.params.id, "ID invalide");

    const { status, comment, newExpiryDate } = req.body ?? {};
    if (!isDocumentRenewalRequestStatus(status)) {
      return res.status(400).json({ message: "Statut invalide" });
    }
    if (newExpiryDate && !isIsoCalendarDate(newExpiryDate)) {
      return res.status(400).json({ message: "Nouvelle date d'échéance illisible (format attendu : AAAA-MM-JJ)." });
    }

    const [current] = await db
      .select({ status: documentRenewalRequests.status })
      .from(documentRenewalRequests)
      .where(eq(documentRenewalRequests.id, id));
    if (!current) {
      return res.status(404).json({ message: "Demande introuvable" });
    }
    const refusal = documentRenewalTransitionRefusal(current.status, status);
    if (refusal) {
      return res.status(409).json({ message: refusal });
    }

    const updateData: Record<string, any> = {
      status,
      updatedAt: new Date(),
    };
    if (comment) updateData.comment = comment;
    if (newExpiryDate) updateData.newExpiryDate = newExpiryDate;
    // Rejouer « terminée » ne réécrit pas qui l'a terminée ni quand.
    if (status === "completed" && current.status !== "completed") {
      updateData.completedBy = req.session?.userId ?? null;
      updateData.completedAt = new Date();
    }

    const [updated] = await db
      .update(documentRenewalRequests)
      .set(updateData)
      // Écriture conditionnelle : un changement concurrent ne se fait pas écraser.
      .where(and(eq(documentRenewalRequests.id, id), eq(documentRenewalRequests.status, current.status)))
      .returning();

    if (!updated) {
      return res.status(409).json({ message: "Cette demande vient d'être modifiée. Rechargez la page." });
    }

    // Diffusion au mieux : l'écriture est faite, un échec d'envoi ne la transforme pas en 500.
    try {
      broadcastDocumentRenewalEvent(
        "document_renewal_request_status_updated",
        {
          requestId: id,
          status,
          request: withoutDiskPaths(updated),
          vehicleId: updated.vehicleId,
          documentId: updated.vehicleDocumentId,
        },
        { requestId: id, actorUserId: req.session?.userId ?? null, actorRole: role },
      );
    } catch (broadcastError) {
      log.error({ err: broadcastError, requestId: req.requestId }, "diffusion du changement de statut d'une demande de renouvellement");
    }

    return res.status(200).json(withoutDiskPaths(updated));
  } catch (error) {
    return next(withLogContext(error instanceof AppError ? error : new AppError(500, "Erreur serveur", { cause: error }), { event: "changement de statut d'une demande de renouvellement" }));
  }
});

/**
 * Dépôt (ou remplacement) du récépissé provisoire d'une demande ouverte : fichier + date de validité.
 * Rôles : ceux qui créent et suivent déjà les demandes de ce routeur (DOCUMENT_RENEWAL_WRITER_ROLES),
 * le récépissé étant une pièce de la demande ; le technicien (lecture seule) et le client n'y écrivent pas.
 */
router.post(
  "/requests/:id/receipt",
  isDocumentRenewalWriter,
  (req: Request, res: Response, next: NextFunction) => {
    uploadRenewalReceipt(req, res, (uploadError) => {
      if (uploadError) {
        next(new AppError(400, "Fichier du récépissé invalide (8 Mo maximum, un seul fichier).", { cause: uploadError }));
        return;
      }
      next();
    });
  },
  async (req: Request, res: Response, next: NextFunction) => {
    const file = req.file;
    // Le fichier rangé par multer n'est gardé qu'une fois référencé par la demande enregistrée :
    // toute autre sortie le supprime dans le finally, jamais après le commit.
    let receiptRecorded = false;
    try {
      const id = parseRouteId(req.params.id, "Identifiant de demande invalide.");
      if (!file) throw new AppError(400, "Le fichier du récépissé est obligatoire (PDF, JPG, PNG ou WEBP).");
      if (!isInsideDirectory(renewalReceiptUploadDir, file.path)) {
        throw new AppError(400, "Fichier du récépissé invalide.");
      }

      const parsedBody = receiptDepositSchema.safeParse({ validUntil: readField(req.body?.validUntil) });
      if (!parsedBody.success) {
        throw new AppError(400, "Date de validité illisible (format attendu : AAAA-MM-JJ).");
      }
      const { validUntil } = parsedBody.data;
      // Un seul jour : le jour UTC, comme l'éligibilité (recepisseValide).
      const today = todayUtcDateOnly();
      if (validUntil < today) {
        throw new AppError(400, "La date de validité du récépissé est déjà passée.");
      }
      // Borne haute : date du dépôt + durée maximale, calculée en UTC sur des dates seules.
      if (validUntil > addDaysToIsoDate(today, RENEWAL_RECEIPT_MAX_VALIDITY_DAYS)) {
        throw new AppError(400, `La validité d'un récépissé ne peut pas dépasser ${RENEWAL_RECEIPT_MAX_VALIDITY_DAYS} jours après son dépôt.`);
      }

      const now = new Date();
      let outcome;
      try {
        // Verrou de ligne : l'ancien chemin lu est celui que cet UPDATE remplace (pas de course entre deux dépôts).
        outcome = await db.transaction(async (tx) => {
          const [current] = await tx
            .select({
              status: documentRenewalRequests.status,
              receiptFilePath: documentRenewalRequests.receiptFilePath,
            })
            .from(documentRenewalRequests)
            .where(eq(documentRenewalRequests.id, id))
            .for("update");
          if (!current) throw new AppError(404, "Demande introuvable.");
          if (!(OPEN_DOCUMENT_RENEWAL_STATUSES as readonly string[]).includes(current.status)) {
            throw new AppError(409, "Cette demande est clôturée : on ne peut plus y déposer de récépissé.");
          }
          const [row] = await tx
            .update(documentRenewalRequests)
            .set({
              receiptValidUntil: validUntil,
              receiptFileName: (file.originalname || file.filename).slice(0, 255),
              receiptFilePath: `${RECEIPT_STORED_PREFIX}/${file.filename}`,
              receiptUploadedAt: now,
              receiptUploadedBy: req.user!.id,
              updatedAt: now,
            })
            // Écriture conditionnelle : une clôture concurrente ne reçoit pas de récépissé.
            .where(and(eq(documentRenewalRequests.id, id), inArray(documentRenewalRequests.status, [...OPEN_DOCUMENT_RENEWAL_STATUSES])))
            .returning();
          return { updated: row, previousPath: current.receiptFilePath };
        });
      } catch (error) {
        throw renewalReceiptErrorOf(error) ?? error;
      }
      const { updated, previousPath } = outcome;
      if (!updated) throw new AppError(409, "Cette demande vient d'être modifiée. Rechargez la page.");
      receiptRecorded = true;

      // Remplacement : l'ancien fichier part une fois le nouveau enregistré.
      if (previousPath && previousPath !== updated.receiptFilePath) {
        removeUploadedFile(previousPath, req.requestId);
      }

      // Pas de chemin disque dans l'événement ni dans la réponse.
      const request = withoutDiskPaths(updated);
      // Diffusion au mieux : la base référence déjà le fichier, un échec ici ne doit ni le supprimer ni défaire le dépôt.
      try {
        broadcastDocumentRenewalEvent(
          "document_renewal_receipt_uploaded",
          { requestId: id, vehicleId: updated.vehicleId, documentId: updated.vehicleDocumentId, documentType: updated.documentType, request },
          {
            requestId: id,
            actorUserId: req.user!.id,
            actorRole: normalizeRole(req.user?.role),
            scope: REALTIME_EVENTS.document_renewal_receipt_uploaded.scope as RealtimeScope,
          },
        );
      } catch (broadcastError) {
        log.error({ err: broadcastError, requestId: req.requestId }, "diffusion du dépôt de récépissé");
      }
      return res.status(201).json(request);
    } catch (error) {
      next(withLogContext(error, { event: "dépôt du récépissé d'une demande de renouvellement" }));
    } finally {
      if (!receiptRecorded && file) removeUploadedFile(file.path, req.requestId);
    }
  },
);

router.post("/quick-renew", isDocumentRenewalWriter, (req: Request, res: Response, next: NextFunction) => {
  uploadRenewalProof(req, res, async (uploadError) => {
    // Le justificatif n'est gardé qu'une fois référencé par la demande enregistrée :
    // tout refus ou échec avant ce point le supprime (bloc finally), aucun orphelin dans uploads/.
    let proofRecorded = false;
    const removeUploadedProof = () => {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          log.error({ err: unlinkError, requestId: req.requestId }, "Suppression du justificatif du renouvellement rapide non enregistré impossible");
        }
      }
    };
    try {
      if (uploadError) {
        // Message lisible sans texte technique de multer (AGENTS.md §10) : le fileFilter lève déjà en français.
        const message =
          uploadError instanceof multer.MulterError
            ? uploadError.code === "LIMIT_FILE_SIZE"
              ? "Fichier trop volumineux (8 Mo maximum)."
              : "Upload justificatif invalide."
            : "Justificatif invalide. Formats acceptés: PDF, JPG, PNG, WEBP.";
        return res.status(400).json({ message });
      }

      const role = normalizeRole(req.user?.role);
      if (!hasRole(role, CREATE_ROLES)) {
        return res.status(403).json({ message: "Accès non autorisé" });
      }

      const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
      if (!actorUserId) {
        return res.status(401).json({ message: "Session invalide." });
      }

      if (!req.file) {
        return res.status(400).json({
          message: "Justificatif requis",
          details: "Le justificatif (image/PDF) est obligatoire pour valider le renouvellement.",
        });
      }

      const normalizedPayload = {
        requestId: readField(req.body?.requestId),
        vehicleId: readField(req.body?.vehicleId),
        vehicleDocumentId: readField(req.body?.vehicleDocumentId),
        comment: readField(req.body?.comment),
        assignedRole: readField(req.body?.assignedRole),
        centerId: readField(req.body?.centerId),
        centerName: readField(req.body?.centerName),
        centerAddress: readField(req.body?.centerAddress),
        centerContact: readField(req.body?.centerContact),
        centerAccreditationNumber: readField(req.body?.centerAccreditationNumber),
        visitReference: readField(req.body?.visitReference),
        visitDate: readField(req.body?.visitDate),
        inspectorName: readField(req.body?.inspectorName),
        inspectorCode: readField(req.body?.inspectorCode),
        newExpiryDate: readField(req.body?.newExpiryDate),
      };

      const parsedPayload = quickRenewPayloadSchema.safeParse(normalizedPayload);
      if (!parsedPayload.success) {
        return res.status(400).json({
          message: "Payload invalide.",
          errors: parsedPayload.error.errors,
        });
      }

      const payload = parsedPayload.data;
      // Corps multipart : la garde de montage ne voit pas le véhicule, la poignée le vérifie (409, L3).
      await assertVehicleWritable(payload.vehicleId);

      const [documentRow] = await db
        .select({
          documentId: vehicleDocuments.id,
          documentType: vehicleDocuments.type,
          documentName: vehicleDocuments.name,
          previousExpiryDate: vehicleDocuments.expiryDate,
          vehicleId: vehicleDocuments.vehicleId,
          vehicleRegistration: vehicles.registrationNumber,
          vehicleOwnerId: vehicles.ownerId,
        })
        .from(vehicleDocuments)
        .leftJoin(vehicles, eq(vehicleDocuments.vehicleId, vehicles.id))
        .where(
          and(
            eq(vehicleDocuments.id, payload.vehicleDocumentId),
            eq(vehicleDocuments.vehicleId, payload.vehicleId),
          ),
        )
        .limit(1);

      if (!documentRow) {
        return res.status(404).json({ message: "Document du véhicule introuvable." });
      }

      if (documentRow.documentType === "visite_technique") {
        if (!payload.visitReference || payload.visitReference.trim().length < 2) {
          return res.status(400).json({
            message: "Référence de visite technique obligatoire.",
          });
        }
        if (!payload.visitDate) {
          return res.status(400).json({
            message: "Date de visite technique obligatoire.",
          });
        }
        if (!payload.inspectorName || payload.inspectorName.trim().length < 2) {
          return res.status(400).json({
            message: "Nom de l'inspecteur obligatoire pour la visite technique.",
          });
        }
      }

      // Contrôles de la demande ciblée AVANT toute écriture : un refus ne laisse pas l'échéance avancée.
      if (payload.requestId) {
        const [existingRequest] = await db
          .select({
            id: documentRenewalRequests.id,
            vehicleId: documentRenewalRequests.vehicleId,
            vehicleDocumentId: documentRenewalRequests.vehicleDocumentId,
            status: documentRenewalRequests.status,
          })
          .from(documentRenewalRequests)
          .where(eq(documentRenewalRequests.id, payload.requestId))
          .limit(1);

        if (!existingRequest) {
          return res.status(404).json({ message: "Demande de renouvellement introuvable." });
        }
        // Une demande close garde sa preuve et son historique d'achèvement.
        if (!(OPEN_DOCUMENT_RENEWAL_STATUSES as readonly string[]).includes(existingRequest.status)) {
          return res.status(409).json({ message: "Cette demande est clôturée : on ne peut plus la renouveler." });
        }
        if (
          existingRequest.vehicleId !== payload.vehicleId ||
          existingRequest.vehicleDocumentId !== payload.vehicleDocumentId
        ) {
          return res.status(400).json({ message: "La demande ne correspond pas au document ciblé." });
        }
      }

      // Le centre est résolu (et créé au besoin) après les contrôles : un refus ne laisse pas de centre en base.
      const resolvedCenter = await resolveRenewalCenter({
        centerId: payload.centerId ?? null,
        centerName: payload.centerName,
        centerAddress: payload.centerAddress,
        centerContact: payload.centerContact,
        centerAccreditationNumber: payload.centerAccreditationNumber,
        documentType: null,
        actorUserId,
      });
      if (!resolvedCenter) {
        return res.status(400).json({ message: "Centre agréé obligatoire." });
      }
      if (!resolvedCenter.ok) {
        return res.status(resolvedCenter.status).json({ message: resolvedCenter.message });
      }
      const centerId = resolvedCenter.id;
      const centerNameSnapshot = resolvedCenter.name;
      const centerAccreditationSnapshot = resolveCenterAccreditation(resolvedCenter);

      const proofFileName = req.file.originalname;
      const proofFilePath = `/uploads/document-renewals/proofs/${req.file.filename}`;

      const now = new Date();
      const completion = {
        status: "completed" as const,
        assignedRole: payload.assignedRole ?? null,
        centerId,
        centerNameSnapshot,
        centerAccreditationSnapshot,
        comment: payload.comment,
        newExpiryDate: payload.newExpiryDate,
        renewalReference: payload.visitReference ?? null,
        renewalVisitDate: payload.visitDate ?? null,
        inspectorName: payload.inspectorName ?? null,
        inspectorCode: payload.inspectorCode ?? null,
        proofFileName,
        proofFilePath,
        completedBy: actorUserId,
        completedAt: now,
      };

      // Échéance, miroir véhicule, levée des alertes et demande : tout ou rien.
      const { updatedDocument, finalizedRequest } = await db.transaction(async (tx) => {
        const [updatedDocument] = await tx
          .update(vehicleDocuments)
          .set({
            expiryDate: payload.newExpiryDate,
            updatedBy: actorUserId,
            updatedAt: now,
          })
          .where(eq(vehicleDocuments.id, payload.vehicleDocumentId))
          .returning();

        await syncVehicleDocumentMirror(
          payload.vehicleId,
          String(documentRow.documentType || ""),
          payload.newExpiryDate,
          "set",
          tx,
        );

        // DOC3 : l'échéance renouvelée lève les alertes d'échéance de ce document.
        await alertInboxService.clearDocumentExpiryAlerts(payload.vehicleDocumentId, tx);

        let finalizedRequest: typeof documentRenewalRequests.$inferSelect | undefined;
        const targetRequestId =
          payload.requestId ??
          (
            await tx
              .select({ id: documentRenewalRequests.id })
              .from(documentRenewalRequests)
              .where(
                and(
                  eq(documentRenewalRequests.vehicleId, payload.vehicleId),
                  eq(documentRenewalRequests.vehicleDocumentId, payload.vehicleDocumentId),
                  inArray(documentRenewalRequests.status, ["pending", "in_progress"]),
                ),
              )
              .orderBy(desc(documentRenewalRequests.createdAt))
              .limit(1)
          )[0]?.id;

        if (targetRequestId) {
          // Condition de statut dans l'UPDATE : deux envois simultanés ne peuvent pas clore la même
          // demande deux fois (le second écraserait la preuve du premier).
          [finalizedRequest] = await tx
            .update(documentRenewalRequests)
            .set({ ...completion, updatedAt: now })
            .where(
              and(
                eq(documentRenewalRequests.id, targetRequestId),
                inArray(documentRenewalRequests.status, [...OPEN_DOCUMENT_RENEWAL_STATUSES]),
              ),
            )
            .returning();
          if (!finalizedRequest) {
            throw new AppError(409, "Cette demande vient d'être clôturée : rechargez la page.");
          }
        } else {
          [finalizedRequest] = await tx
            .insert(documentRenewalRequests)
            .values({
              ...completion,
              vehicleId: payload.vehicleId,
              vehicleDocumentId: payload.vehicleDocumentId,
              documentType: documentRow.documentType as any,
              requestedBy: actorUserId,
              source: "vehicle_document_quick_renew",
            })
            .returning();
        }

        if (!updatedDocument || !finalizedRequest) {
          throw new AppError(500, "Impossible de finaliser la demande de renouvellement.");
        }
        return { updatedDocument, finalizedRequest };
      });
      proofRecorded = true;

      const documentLabel =
        DOCUMENT_LABELS[(documentRow.documentType as keyof typeof DOCUMENT_LABELS) || "autre"] || "Document";
      const infoMessage = `${documentLabel} renouvelé - véhicule ${
        documentRow.vehicleRegistration || `#${payload.vehicleId}`
      }. Centre: ${centerNameSnapshot}${
        centerAccreditationSnapshot ? ` (${centerAccreditationSnapshot})` : ""
      }. Nouvelle échéance: ${payload.newExpiryDate}.`;

      // Notifications au mieux : le renouvellement est enregistré, le justificatif est référencé.
      // Un échec ici ne renvoie pas 500 et ne supprime rien.
      try {
        const recipients = [
          ...(await storage.getUsersByRole("admin")),
          ...(await storage.getUsersByRole("workshop_manager")),
          ...(await storage.getUsersByRole("secretary")),
          ...(await storage.getUsersByRole("logistics")),
          actorUserId ? ({ id: actorUserId } as any) : null,
        ].filter(Boolean) as Array<{ id: number }>;

        for (const recipient of recipients) {
          const alert = await storage.createAlert({
            userId: recipient.id,
            title: `${documentLabel} renouvelé`,
            message: infoMessage,
            type: "maintenance",
            priority: "medium",
            link: `/vehicles/${payload.vehicleId}`,
          });

          broadcastAlertCreated({
            id: alert.id,
            userId: alert.userId ?? null,
            title: alert.title,
            type: alert.type,
            priority: alert.priority,
            link: alert.link ?? null,
            message: alert.message,
          });
        }
      } catch (alertError) {
        log.error({ err: alertError, requestId: req.requestId }, "notification du renouvellement rapide");
      }

      // Diffusion au mieux : document et demande sont écrits ; un échec d'envoi ne renvoie pas 500
      // et ne supprime pas le justificatif enregistré (catch ci-dessous).
      try {
        broadcastDocumentRenewalEvent(
          "document_renewal_quick_completed",
          {
            request: withoutDiskPaths(finalizedRequest),
            document: withoutDiskPaths(updatedDocument),
            previousExpiryDate: documentRow.previousExpiryDate ?? null,
          },
          {
            requestId: finalizedRequest.id,
            actorUserId,
            actorRole: role,
          },
        );

        broadcastDocumentRenewalEvent(
          "vehicle_document_updated",
          {
            documentId: updatedDocument.id,
            vehicleId: updatedDocument.vehicleId,
            documentType: updatedDocument.type,
            newExpiryDate: updatedDocument.expiryDate,
          },
          {
            requestId: finalizedRequest.id,
            actorUserId,
            actorRole: role,
            // Même portée que vehicle_document_updated émis par vehicle-documents.routes.ts.
            scope: { type: "roles", roles: [...VEHICLE_DOCUMENT_EVENT_ROLES] },
          },
        );

        broadcastVehicleDocumentEvent(
          {
            vehicleId: updatedDocument.vehicleId,
            documentId: updatedDocument.id,
            documentType: String(updatedDocument.type || documentRow.documentType || ""),
            newExpiryDate: updatedDocument.expiryDate ?? null,
          },
          {
            actorUserId,
            actorRole: role,
            ownerId: documentRow.vehicleOwnerId ?? null,
          },
        );
      } catch (broadcastError) {
        log.error({ err: broadcastError, requestId: req.requestId }, "diffusion du renouvellement rapide");
      }

      return res.status(200).json({
        message: "Renouvellement enregistré et document mis à jour.",
        request: withoutDiskPaths(finalizedRequest),
        document: withoutDiskPaths(updatedDocument),
      });
    } catch (error) {
      if (error instanceof AppError) return next(error);
      return next(withLogContext(new AppError(500, "Erreur serveur", { cause: error }), { event: "renouvellement rapide d'un document" }));
    } finally {
      if (!proofRecorded) removeUploadedProof();
    }
  });
});

export default router;
