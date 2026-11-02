import { Router, type RequestHandler } from "express";
import { partLabelsQuerySchema, partScanResolveQuerySchema } from "@shared/contracts/part-scans";
import { PART_LABEL_ROLES } from "@shared/constants/roles";
import { moduleLogger } from "../lib/logger";
import { authorize } from "../middleware/auth";
import { getPartLabels, resolveScannedPart } from "../services/part-scans-service";

const log = moduleLogger("part-scans");

/**
 * Scan et étiquettes des pièces (CDC-3). Monté sur `/api/part-scans` par `server/api/index.ts`,
 * derrière le drapeau `part-qr` puis `authorize(PART_SCAN_ROLES)` : le montage fait entrer
 * l'administrateur, le magasinier, le chef d'atelier et le technicien. Aucun client.
 *
 * Tout est en lecture : aucune écriture en base, aucun mouvement de stock. La sortie d'une
 * pièce reste `POST /api/work-orders/:id/part-requirements/:id/issue`.
 */

/** Code scanné -> fiche minimale (id, référence, désignation, quantité, emplacement, unité). Jamais de prix. */
const getResolve: RequestHandler = async (req, res, next) => {
  try {
    const { code } = partScanResolveQuerySchema.parse(req.query);
    const { part, format } = await resolveScannedPart(code);
    log.debug({ partId: part.id, format, userId: req.user?.id, requestId: req.requestId }, "code résolu");
    res.status(200).json(part);
  } catch (error) {
    next(error);
  }
};

/** Charge utile et textes à imprimer, dans l'ordre demandé. Magasin et administration seulement. */
const getLabels: RequestHandler = async (req, res, next) => {
  try {
    const { ids } = partLabelsQuerySchema.parse(req.query);
    const labels = await getPartLabels(ids);
    if (labels.missingIds.length > 0) {
      log.warn({ missingIds: labels.missingIds, userId: req.user?.id, requestId: req.requestId }, "étiquettes demandées pour des pièces inconnues");
    }
    res.status(200).json(labels);
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/resolve", getResolve);
// Le montage laisse passer les quatre rôles de scan : l'impression est réservée au magasin.
router.get("/labels", authorize([...PART_LABEL_ROLES]), getLabels);

export default router;
