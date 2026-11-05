import { Router } from "express";
import { canReadFinanceReceivable } from "@shared/constants/roles";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import { clientStatementQuerySchema } from "@shared/contracts/client-statement";
import { AppError } from "../lib/app-error";
import { canAccessOwned, OUT_OF_SCOPE_MESSAGE } from "../lib/client-scope";
import { requireFeature } from "../lib/feature-flags";
import { parseRouteId } from "../lib/route-id";
import { isAnyUser } from "../middleware/auth";
import { clientStatementService } from "../services/client-statement-service";

/**
 * Relevé de compte client. Monté sur /api avant `/clients` (gardé `isStaff`), pour que la cloison
 * client (§11) s'applique ici et pas le refus générique du personnel.
 */
const router = Router();

/** Aucun compte utilisateur n'est rattaché à une fiche `clients` (donneur d'ordre) : un client n'en possède aucune. */
const statementOwner = async (): Promise<number | null> => null;

router.get("/clients/:id/statement", requireFeature("finance"), isAnyUser, async (req, res, next) => {
  try {
    const clientId = parseRouteId(req.params.id, "Identifiant client invalide");
    if (!(await canAccessOwned(req.user, statementOwner))) {
      throw new AppError(403, OUT_OF_SCOPE_MESSAGE);
    }
    if (!canReadFinanceReceivable(req.user?.role)) {
      throw new AppError(403, "Accès refusé : le relevé de compte est réservé aux profils finance.");
    }
    const parsed = clientStatementQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError(400, parsed.error.issues[0]?.message ?? "Période invalide.");
    }
    const to = parsed.data.to ?? isoDateInZone(new Date());
    const from = parsed.data.from ?? null;
    if (from && from > to) {
      throw new AppError(400, "La date de début doit précéder la date de fin.");
    }
    const statement = await clientStatementService.statement(clientId, from, to);
    if (!statement) throw new AppError(404, "Client non trouvé.");
    res.json(statement);
  } catch (err) {
    next(err);
  }
});

export default router;
