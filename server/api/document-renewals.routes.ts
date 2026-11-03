import { Router, type NextFunction, type Request, type Response } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import fs from "fs";
import path from "path";
import { db } from "../db";
import { isAnyUser, isDocumentRenewalWriter } from "../middleware/auth";
import { storage } from "../storage";
import { isIsoCalendarDate } from "@shared/constants/calendar-date";
import { DOCUMENT_RENEWAL_VIEWER_ROLES, DOCUMENT_RENEWAL_WRITER_ROLES } from "@shared/constants/roles";
import {
  DOCUMENT_RENEWAL_REQUEST_STATUSES,
  documentRenewalTransitionRefusal,
  isDocumentRenewalRequestStatus,
} from "@shared/constants/document-renewal-statuses";
import { nameSchema, optionalText } from "@shared/contracts/document-renewal-centers";
import { resolveRenewalCenter } from "../lib/document-renewal-center-resolver";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { alertInboxService } from "../services/alert-inbox-service";
import {
  documentRenewalCenters,
  documentRenewalRequests,
  drivers,
  users,
  vehicleDocuments,
  vehicles,
} from "@shared/schema";

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

const normalizeDocumentType = (rawType: string | null | undefined): string => {
  const normalized = String(rawType || "")
    .trim()
    .toLowerCase();

  switch (normalized) {
    case "insurance":
      return "assurance";
    case "inspection":
    case "technical_inspection":
    case "controle_technique":
      return "visite_technique";
    case "license":
    case "registration":
    case "registration_card":
      return "carte_grise";
    default:
      return normalized;
  }
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
    scope: { type: "broadcast" },
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
  },
) => {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

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
    scope: { type: "broadcast" },
    actor: {
      userId: options?.actorUserId ?? null,
      role: options?.actorRole ?? null,
    },
    emittedAt: new Date().toISOString(),
  });
};

const broadcastAlertCreated = (alert: {
  id: number;
  userId: number | null;
  title: string;
  type: string;
  priority: string;
  link: string | null;
  message: string;
}) => {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate("alert_created", {
    version: 1,
    entity: "alert",
    entityId: alert.id,
    payload: { alert },
    scope: alert.userId ? { type: "user", userIds: [alert.userId] } : { type: "broadcast" },
    emittedAt: new Date().toISOString(),
  });
};

const renewalProofUploadDir = path.join(
  process.cwd(),
  "uploads",
  "document-renewals",
  "proofs",
);

if (!fs.existsSync(renewalProofUploadDir)) {
  fs.mkdirSync(renewalProofUploadDir, { recursive: true });
}

const uploadRenewalProof = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, renewalProofUploadDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const baseName = (file.originalname || "proof")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/\.[^.]+$/, "")
        .slice(0, 40);
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${baseName || "proof"}-${uniqueSuffix}${extension || ".bin"}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
      "image/webp",
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Justificatif invalide. Formats acceptés: PDF, JPG, PNG, WEBP."));
  },
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
}).single("proofFile");

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

const syncVehicleMasterDocumentExpiry = async (
  vehicleId: number,
  documentType: string,
  newExpiryDate: string,
): Promise<void> => {
  const normalizedType = normalizeDocumentType(documentType);

  switch (normalizedType) {
    case "carte_grise":
      await db
        .update(vehicles)
        .set({ licensePlateExpiry: newExpiryDate })
        .where(eq(vehicles.id, vehicleId));
      break;
    case "assurance":
      await db
        .update(vehicles)
        .set({ insuranceExpiry: newExpiryDate })
        .where(eq(vehicles.id, vehicleId));
      break;
    case "visite_technique":
      await db
        .update(vehicles)
        .set({ technicalInspectionDate: newExpiryDate })
        .where(eq(vehicles.id, vehicleId));
      break;
    default:
      break;
  }
};

router.get("/centers", async (req, res) => {
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
    log.error({ err: error, requestId: req.requestId }, "lecture des centres de renouvellement");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.get("/requests", async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!hasRole(role, VIEW_ROLES)) {
      return res.status(403).json({ message: "Accès non autorisé" });
    }

    const vehicleId = req.query.vehicleId ? Number.parseInt(String(req.query.vehicleId), 10) : null;
    const status = String(req.query.status || "").trim();
    const statusFilter = (REQUEST_STATUSES as readonly string[]).includes(status) ? status : null;

    const conditions = [sql`1=1`];
    if (vehicleId && Number.isInteger(vehicleId) && vehicleId > 0) {
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
        proofFilePath: documentRenewalRequests.proofFilePath,
        createdAt: documentRenewalRequests.createdAt,
        updatedAt: documentRenewalRequests.updatedAt,
      })
      .from(documentRenewalRequests)
      .leftJoin(users, eq(documentRenewalRequests.requestedBy, users.id))
      .where(and(...conditions))
      .orderBy(desc(documentRenewalRequests.createdAt));

    return res.status(200).json(rows);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "lecture des demandes de renouvellement");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

const createRequestPayloadSchema = z.object({
  vehicleId: z.number().int().positive(),
  vehicleDocumentId: z.number().int().positive(),
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
  centerId: z.number().int().positive().optional().nullable(),
  centerName: centerNameField,
  centerAddress: optionalText(300),
  centerContact: optionalText(200),
  centerAccreditationNumber: optionalText(80),
  escortRole: z.enum(ESCORT_ROLES).optional().nullable(),
  escortUserId: z.number().int().positive().optional().nullable(),
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
    z.coerce.number().int().positive().nullable().optional(),
  ),
  vehicleId: z.coerce.number().int().positive(),
  vehicleDocumentId: z.coerce.number().int().positive(),
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
    z.coerce.number().int().positive().nullable().optional(),
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

router.post("/requests", async (req, res, next) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!hasRole(role, CREATE_ROLES)) {
      return res.status(403).json({ message: "Accès non autorisé" });
    }

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
    const recipients = [
      ...(await storage.getUsersByRole("admin")),
      ...(await storage.getUsersByRole("workshop_manager")),
      ...(await storage.getUsersByRole("secretary")),
      ...(await storage.getUsersByRole("logistics")),
      ...(await storage.getUsersByRole("technician")),
    ];

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
        request: createdRequest,
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
      request: createdRequest,
    });
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "création d'une demande de renouvellement");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

/**
 * PATCH /api/document-renewals/requests/:id/status
 * Mettre à jour le statut d'une demande (ex: marquer comme traité)
 */
router.patch("/requests/:id/status", async (req, res) => {
  try {
    const role = normalizeRole(req.user?.role);
    if (!hasRole(role, CREATE_ROLES)) {
      return res.status(403).json({ message: "Accès non autorisé" });
    }

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID invalide" });
    }

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

    broadcastDocumentRenewalEvent(
      "document_renewal_request_status_updated",
      {
        requestId: id,
        status,
        request: updated,
        vehicleId: updated.vehicleId,
        documentId: updated.vehicleDocumentId,
      },
      { requestId: id, actorUserId: req.session?.userId ?? null, actorRole: role },
    );

    return res.status(200).json(updated);
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "changement de statut d'une demande de renouvellement");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/quick-renew", isDocumentRenewalWriter, (req: Request, res: Response, next: NextFunction) => {
  uploadRenewalProof(req, res, async (uploadError) => {
    try {
      if (uploadError) {
        return res.status(400).json({
          message: "Upload justificatif invalide",
          details: uploadError.message,
        });
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
        if (req.file?.path && fs.existsSync(req.file.path)) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (unlinkError) {
            log.error({ err: unlinkError, requestId: req.requestId }, "Suppression du justificatif après payload invalide impossible");
          }
        }
        return res.status(400).json({
          message: "Payload invalide.",
          errors: parsedPayload.error.errors,
        });
      }

      const payload = parsedPayload.data;

      let centerId: number | null = payload.centerId ?? null;
      let centerNameSnapshot: string | null = null;
      let centerAccreditationSnapshot: string | null = null;

      const removeUploadedProof = () => {
        if (req.file?.path && fs.existsSync(req.file.path)) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (unlinkError) {
            log.error({ err: unlinkError, requestId: req.requestId }, "Suppression du justificatif après refus du centre impossible");
          }
        }
      };

      const resolvedCenter = await resolveRenewalCenter({
        centerId,
        centerName: payload.centerName,
        centerAddress: payload.centerAddress,
        centerContact: payload.centerContact,
        centerAccreditationNumber: payload.centerAccreditationNumber,
        documentType: null,
        actorUserId,
      });
      if (!resolvedCenter) {
        removeUploadedProof();
        return res.status(400).json({ message: "Centre agréé obligatoire." });
      }
      if (!resolvedCenter.ok) {
        removeUploadedProof();
        return res.status(resolvedCenter.status).json({ message: resolvedCenter.message });
      }
      centerId = resolvedCenter.id;
      centerNameSnapshot = resolvedCenter.name;
      centerAccreditationSnapshot = resolveCenterAccreditation(resolvedCenter);

      const [documentRow] = await db
        .select({
          documentId: vehicleDocuments.id,
          documentType: vehicleDocuments.type,
          documentName: vehicleDocuments.name,
          previousExpiryDate: vehicleDocuments.expiryDate,
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

      const proofFileName = req.file.originalname;
      const proofFilePath = `/uploads/document-renewals/proofs/${req.file.filename}`;

      const now = new Date();

      const [updatedDocument] = await db
        .update(vehicleDocuments)
        .set({
          expiryDate: payload.newExpiryDate,
          updatedBy: actorUserId,
          updatedAt: now,
        })
        .where(eq(vehicleDocuments.id, payload.vehicleDocumentId))
        .returning();

      await syncVehicleMasterDocumentExpiry(
        payload.vehicleId,
        String(documentRow.documentType || ""),
        payload.newExpiryDate,
      );

      // DOC3 : l'échéance renouvelée lève les alertes d'échéance de ce document.
      await alertInboxService.clearDocumentExpiryAlerts(payload.vehicleDocumentId);

      let finalizedRequest: typeof documentRenewalRequests.$inferSelect | undefined;

      if (payload.requestId) {
        const [existingRequest] = await db
          .select({
            id: documentRenewalRequests.id,
            vehicleId: documentRenewalRequests.vehicleId,
            vehicleDocumentId: documentRenewalRequests.vehicleDocumentId,
          })
          .from(documentRenewalRequests)
          .where(eq(documentRenewalRequests.id, payload.requestId))
          .limit(1);

        if (!existingRequest) {
          return res.status(404).json({ message: "Demande de renouvellement introuvable." });
        }
        if (
          existingRequest.vehicleId !== payload.vehicleId ||
          existingRequest.vehicleDocumentId !== payload.vehicleDocumentId
        ) {
          return res.status(400).json({ message: "La demande ne correspond pas au document ciblé." });
        }

        const [updatedRequest] = await db
          .update(documentRenewalRequests)
          .set({
            status: "completed",
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
            updatedAt: now,
          })
          .where(eq(documentRenewalRequests.id, payload.requestId))
          .returning();

        finalizedRequest = updatedRequest;
      } else {
        const [openRequest] = await db
          .select({
            id: documentRenewalRequests.id,
          })
          .from(documentRenewalRequests)
          .where(
            and(
              eq(documentRenewalRequests.vehicleId, payload.vehicleId),
              eq(documentRenewalRequests.vehicleDocumentId, payload.vehicleDocumentId),
              inArray(documentRenewalRequests.status, ["pending", "in_progress"]),
            ),
          )
          .orderBy(desc(documentRenewalRequests.createdAt))
          .limit(1);

        if (openRequest) {
          const [updatedRequest] = await db
            .update(documentRenewalRequests)
            .set({
              status: "completed",
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
              updatedAt: now,
            })
            .where(eq(documentRenewalRequests.id, openRequest.id))
            .returning();

          finalizedRequest = updatedRequest;
        } else {
          const [createdRequest] = await db
            .insert(documentRenewalRequests)
            .values({
              vehicleId: payload.vehicleId,
              vehicleDocumentId: payload.vehicleDocumentId,
              documentType: documentRow.documentType as any,
              status: "completed",
              requestedBy: actorUserId,
              assignedRole: payload.assignedRole ?? null,
              centerId,
              centerNameSnapshot,
              centerAccreditationSnapshot,
              comment: payload.comment,
              source: "vehicle_document_quick_renew",
              newExpiryDate: payload.newExpiryDate,
              renewalReference: payload.visitReference ?? null,
              renewalVisitDate: payload.visitDate ?? null,
              inspectorName: payload.inspectorName ?? null,
              inspectorCode: payload.inspectorCode ?? null,
              proofFileName,
              proofFilePath,
              completedBy: actorUserId,
              completedAt: now,
            })
            .returning();

          finalizedRequest = createdRequest;
        }
      }

      if (!finalizedRequest) {
        return res.status(500).json({ message: "Impossible de finaliser la demande de renouvellement." });
      }

      const documentLabel =
        DOCUMENT_LABELS[(documentRow.documentType as keyof typeof DOCUMENT_LABELS) || "autre"] || "Document";
      const infoMessage = `${documentLabel} renouvelé - véhicule ${
        documentRow.vehicleRegistration || `#${payload.vehicleId}`
      }. Centre: ${centerNameSnapshot}${
        centerAccreditationSnapshot ? ` (${centerAccreditationSnapshot})` : ""
      }. Nouvelle échéance: ${payload.newExpiryDate}.`;

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

      broadcastDocumentRenewalEvent(
        "document_renewal_quick_completed",
        {
          request: finalizedRequest,
          document: updatedDocument,
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
        },
      );

      return res.status(200).json({
        message: "Renouvellement enregistré et document mis à jour.",
        request: finalizedRequest,
        document: updatedDocument,
      });
    } catch (error) {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          log.error({ err: unlinkError, requestId: req.requestId }, "Suppression du justificatif après échec du renouvellement rapide impossible");
        }
      }
      if (error instanceof AppError) return next(error);
      log.error({ err: error, requestId: req.requestId }, "renouvellement rapide d'un document");
      return res.status(500).json({ message: "Erreur serveur" });
    }
  });
});

export default router;
