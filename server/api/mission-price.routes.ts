import { Router } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { canEditMissionPrice, MISSION_PRICE_READ_ROLES } from "@shared/constants/roles";
import {
  missionPriceBodySchema,
  missionPriceResponseSchema,
  reasonLongEnough,
} from "@shared/contracts/mission-price";
import { clientInvoices, missionPriceHistory, missions, tariffGrid, users } from "@shared/schema";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { authorize } from "../middleware/auth";
import { broadcastMissionUpdate, parseMissionId } from "./missions.routes";

/**
 * Prix convenu d'une mission (O3 lot 3b). Monté sous /api/missions derrière authenticate + isStaff.
 * Route dédiée : le PATCH générique de la mission n'écrit jamais le prix (liste blanche), car le droit
 * d'écriture dépend du statut et de la facturation, pas seulement du rôle.
 */
const router = Router();
const log = moduleLogger("mission-price");

const num = (v: string | null) => (v === null ? null : Number(v));

async function readPrice(missionId: number) {
  const [mission] = await db
    .select({ agreedPrice: missions.agreedPrice, tariffGridId: missions.tariffGridId })
    .from(missions)
    .where(eq(missions.id, missionId))
    .limit(1);
  if (!mission) throw new AppError(404, "Mission non trouvée.");
  const rows = await db
    .select({
      id: missionPriceHistory.id,
      oldPrice: missionPriceHistory.oldPrice,
      newPrice: missionPriceHistory.newPrice,
      oldTariffGridId: missionPriceHistory.oldTariffGridId,
      newTariffGridId: missionPriceHistory.newTariffGridId,
      reason: missionPriceHistory.reason,
      changedBy: missionPriceHistory.changedBy,
      changedByName: users.name,
      changedAt: missionPriceHistory.changedAt,
    })
    .from(missionPriceHistory)
    .leftJoin(users, eq(users.id, missionPriceHistory.changedBy))
    .where(eq(missionPriceHistory.missionId, missionId))
    .orderBy(desc(missionPriceHistory.changedAt), desc(missionPriceHistory.id));
  return missionPriceResponseSchema.parse({
    agreedPrice: num(mission.agreedPrice),
    tariffGridId: mission.tariffGridId,
    history: rows.map((r) => ({
      ...r,
      oldPrice: num(r.oldPrice),
      newPrice: num(r.newPrice),
      changedAt: r.changedAt.toISOString(),
    })),
  });
}

router.get("/:id/agreed-price", authorize([...MISSION_PRICE_READ_ROLES]), async (req, res, next) => {
  try {
    res.json(await readPrice(parseMissionId(req.params.id)));
  } catch (err) {
    next(err);
  }
});

const BLOCKED_MESSAGES = {
  role: [403, "Votre rôle ne peut pas modifier le prix de cette mission à ce stade."],
  status: [409, "Mission terminée ou annulée : le prix est figé."],
  invoice: [409, "Une facture est liée à cette mission : corrigez le prix par un avoir."],
} as const;

router.put("/:id/agreed-price", authorize([...MISSION_PRICE_READ_ROLES]), async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);
    const body = missionPriceBodySchema.safeParse(req.body);
    if (!body.success) throw new AppError(400, "Prix ou tarif invalide : montant entier en XAF, sans décimale.");
    const { agreedPrice, reason } = body.data;
    const tariffId = agreedPrice === null ? null : (body.data.tariffGridId ?? null);
    const user = (req as unknown as { user: { id: number; role: string } }).user;

    const changed = await db.transaction(async (tx) => {
      // Mission verrouillée : deux corrections simultanées se suivent, l'historique garde l'ordre réel.
      const [mission] = await tx
        .select({ id: missions.id, status: missions.status, agreedPrice: missions.agreedPrice, tariffGridId: missions.tariffGridId })
        .from(missions)
        .where(eq(missions.id, missionId))
        .for("update")
        .limit(1);
      if (!mission) throw new AppError(404, "Mission non trouvée.");

      const [invoice] = await tx
        .select({ id: clientInvoices.id })
        .from(clientInvoices)
        .where(and(eq(clientInvoices.missionId, missionId), ne(clientInvoices.status, "cancelled")))
        .limit(1);
      const decision = canEditMissionPrice(user.role, mission.status, Boolean(invoice));
      if (!decision.allowed) {
        const [status, message] = BLOCKED_MESSAGES[decision.blockedBy];
        throw new AppError(status, message);
      }
      if (tariffId !== null) {
        const [tariff] = await tx.select({ id: tariffGrid.id }).from(tariffGrid).where(eq(tariffGrid.id, tariffId)).limit(1);
        if (!tariff) throw new AppError(400, "Tarif d'origine introuvable.");
      }

      const unchanged = num(mission.agreedPrice) === agreedPrice && mission.tariffGridId === tariffId;
      if (unchanged) return false;
      if (decision.reasonRequired && !reasonLongEnough(reason)) {
        throw new AppError(400, "Un motif d'au moins 5 caractères est obligatoire pour corriger le prix d'une mission en cours.");
      }

      await tx
        .update(missions)
        .set({ agreedPrice: agreedPrice === null ? null : String(agreedPrice), tariffGridId: tariffId, updatedAt: new Date() })
        .where(eq(missions.id, missionId));
      await tx.insert(missionPriceHistory).values({
        missionId,
        oldPrice: mission.agreedPrice,
        newPrice: agreedPrice === null ? null : String(agreedPrice),
        oldTariffGridId: mission.tariffGridId,
        newTariffGridId: tariffId,
        reason: reason?.trim() || null,
        changedBy: user.id,
      });
      log.info(
        { requestId: req.requestId, missionId, userId: user.id, oldPrice: num(mission.agreedPrice), newPrice: agreedPrice, hasReason: Boolean(reason?.trim()) },
        "prix convenu modifié",
      );
      return true;
    });

    if (changed) await broadcastMissionUpdate("mission_updated", { id: missionId }, { source: "mission_price_edit" }, req.requestId);
    res.json(await readPrice(missionId));
  } catch (err) {
    next(err);
  }
});

export default router;
