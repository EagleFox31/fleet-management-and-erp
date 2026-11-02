import { Router } from "express";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { documentRenewalCenters } from "@shared/schema";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import {
  createDocumentRenewalCenterRequestSchema,
  setDocumentRenewalCenterActiveRequestSchema,
  updateDocumentRenewalCenterRequestSchema,
} from "@shared/contracts/document-renewal-centers";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { isDocumentRenewalWriter } from "../middleware/auth";

const log = moduleLogger("document-renewal-centers");
const router = Router();

const DUPLICATE_MESSAGE = "Un centre de ce nom existe déjà pour ce type de document.";
const CENTER_COLUMNS = {
  id: documentRenewalCenters.id,
  name: documentRenewalCenters.name,
  documentType: documentRenewalCenters.documentType,
  accreditationNumber: documentRenewalCenters.accreditationNumber,
  address: documentRenewalCenters.address,
  contact: documentRenewalCenters.contact,
  isActive: documentRenewalCenters.isActive,
};

/** Couche 2 : les profils qui choisissent un centre rechargent la liste. */
function broadcastCenterChanged(id: number): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") return;
  broadcastUpdate("document_renewal_center_changed", {
    entity: "document_renewal_center",
    entityId: id,
    payload: { id },
    scope: REALTIME_EVENTS.document_renewal_center_changed.scope,
  });
}

function parseCenterId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(404, "Centre agréé introuvable.");
  return id;
}

/** Violation de l'unicité SQL du nom (23505), même nom sous un autre type compris. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function assertNameFree(name: string, documentType: string | null, excludeId?: number): Promise<void> {
  const [clash] = await db
    .select({ id: documentRenewalCenters.id })
    .from(documentRenewalCenters)
    .where(
      and(
        sql`lower(${documentRenewalCenters.name}) = lower(${name})`,
        documentType === null
          ? isNull(documentRenewalCenters.documentType)
          : eq(documentRenewalCenters.documentType, documentType as any),
        excludeId === undefined ? undefined : ne(documentRenewalCenters.id, excludeId),
      ),
    )
    .limit(1);
  if (clash) throw new AppError(409, DUPLICATE_MESSAGE);
}

router.post("/centers", isDocumentRenewalWriter, async (req, res, next) => {
  try {
    const body = createDocumentRenewalCenterRequestSchema.parse(req.body ?? {});
    const documentType = body.documentType ?? null;
    await assertNameFree(body.name, documentType);
    let created;
    try {
      [created] = await db
        .insert(documentRenewalCenters)
        .values({ ...body, documentType, createdBy: req.user?.id ?? null })
        .returning(CENTER_COLUMNS);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, DUPLICATE_MESSAGE, { cause: err });
      throw err;
    }
    log.info({ centerId: created.id, userId: req.user?.id, requestId: req.requestId }, "centre de renouvellement créé");
    broadcastCenterChanged(created.id);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch("/centers/:id", isDocumentRenewalWriter, async (req, res, next) => {
  try {
    const id = parseCenterId(req.params.id);
    // Champs nommés seulement : rien d'autre ne passe du corps à la base.
    const { name, documentType, accreditationNumber, address, contact } = req.body ?? {};
    const picked = Object.fromEntries(
      Object.entries({ name, documentType, accreditationNumber, address, contact }).filter(([, value]) => value !== undefined),
    );
    const body = updateDocumentRenewalCenterRequestSchema.parse(picked);
    const [current] = await db
      .select(CENTER_COLUMNS)
      .from(documentRenewalCenters)
      .where(eq(documentRenewalCenters.id, id))
      .limit(1);
    if (!current) throw new AppError(404, "Centre agréé introuvable.");

    const nextName = body.name ?? current.name;
    const nextType = body.documentType === undefined ? current.documentType : body.documentType;
    if (body.name !== undefined || body.documentType !== undefined) await assertNameFree(nextName, nextType, id);

    let updated;
    try {
      [updated] = await db
        .update(documentRenewalCenters)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(documentRenewalCenters.id, id))
        .returning(CENTER_COLUMNS);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, DUPLICATE_MESSAGE, { cause: err });
      throw err;
    }
    log.info({ centerId: id, userId: req.user?.id, requestId: req.requestId }, "centre de renouvellement modifié");
    broadcastCenterChanged(id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/** Désactiver / réactiver. Les demandes existantes gardent leur snapshot de nom. */
router.patch("/centers/:id/active", isDocumentRenewalWriter, async (req, res, next) => {
  try {
    const id = parseCenterId(req.params.id);
    const { isActive: requested } = req.body ?? {};
    const { isActive } = setDocumentRenewalCenterActiveRequestSchema.parse({ isActive: requested });
    const [updated] = await db
      .update(documentRenewalCenters)
      .set({ isActive, updatedAt: new Date() })
      .where(eq(documentRenewalCenters.id, id))
      .returning(CENTER_COLUMNS);
    if (!updated) throw new AppError(404, "Centre agréé introuvable.");
    log.info(
      { centerId: id, isActive, userId: req.user?.id, requestId: req.requestId },
      isActive ? "centre de renouvellement réactivé" : "centre de renouvellement désactivé",
    );
    broadcastCenterChanged(id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
