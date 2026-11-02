import { Router } from "express";
import { eq } from "drizzle-orm";
import { documentRenewalCenters } from "@shared/schema";
import {
  createDocumentRenewalCenterRequestSchema,
  setDocumentRenewalCenterActiveRequestSchema,
  updateDocumentRenewalCenterRequestSchema,
} from "@shared/contracts/document-renewal-centers";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { assertCenterNameFree, cleanCenterName, DUPLICATE_CENTER_MESSAGE, isUniqueViolation } from "../lib/document-renewal-center-resolver";
import { broadcastCenterChanged } from "../lib/document-renewal-center-events";
import { moduleLogger } from "../lib/logger";
import { isDocumentRenewalWriter } from "../middleware/auth";

const log = moduleLogger("document-renewal-centers");
const router = Router();

const CENTER_COLUMNS = {
  id: documentRenewalCenters.id,
  name: documentRenewalCenters.name,
  documentType: documentRenewalCenters.documentType,
  accreditationNumber: documentRenewalCenters.accreditationNumber,
  address: documentRenewalCenters.address,
  contact: documentRenewalCenters.contact,
  isActive: documentRenewalCenters.isActive,
};

function parseCenterId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(404, "Centre agréé introuvable.");
  return id;
}

const EDITABLE_FIELDS = ["name", "documentType", "accreditationNumber", "address", "contact"];

router.post("/centers", isDocumentRenewalWriter, async (req, res, next) => {
  try {
    const body = createDocumentRenewalCenterRequestSchema.parse(req.body ?? {});
    const documentType = body.documentType ?? null;
    const name = cleanCenterName(body.name);
    await assertCenterNameFree(name);
    let created;
    try {
      [created] = await db
        .insert(documentRenewalCenters)
        .values({ ...body, name, documentType, createdBy: req.user?.id ?? null })
        .returning(CENTER_COLUMNS);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, DUPLICATE_CENTER_MESSAGE, { cause: err });
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
    // Champs nommés seulement : rien d'autre ne passe du corps à la base, et un champ inconnu est refusé.
    const unknown = Object.keys(req.body ?? {}).filter((key) => !EDITABLE_FIELDS.includes(key));
    if (unknown.length > 0) throw new AppError(400, "Champ non modifiable dans la requête.");
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

    if (body.name !== undefined) {
      body.name = cleanCenterName(body.name);
      await assertCenterNameFree(body.name, id);
    }

    let updated;
    try {
      [updated] = await db
        .update(documentRenewalCenters)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(documentRenewalCenters.id, id))
        .returning(CENTER_COLUMNS);
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, DUPLICATE_CENTER_MESSAGE, { cause: err });
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
    // Champ nommé seulement ; un champ inconnu est refusé en 400, comme au PATCH principal.
    const unknown = Object.keys(req.body ?? {}).filter((key) => key !== "isActive");
    if (unknown.length > 0) throw new AppError(400, "Champ non modifiable dans la requête.");
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
