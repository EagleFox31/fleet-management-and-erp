import { Router, type RequestHandler } from "express";
import {
  fuelVoucherParamsSchema,
  fuelVouchersQuerySchema,
  fuelVouchersResponseSchema,
  fuelVoucherValidationResponseSchema,
} from "@shared/contracts/fuel-vouchers";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import { FUEL_READ_ROLES } from "@shared/constants/roles";
import { requireFeature } from "../lib/feature-flags";
import { moduleLogger } from "../lib/logger";
import { authenticate, authorize, isFuelCardManager } from "../middleware/auth";
import { listFuelVouchers, validateFuelVoucher } from "../services/fuel-voucher-service";

const log = moduleLogger("fuel-vouchers");

/** Liste des bons (P-17). Lecture ouverte au chef d'atelier et à la direction, sans action. */
const listVouchers: RequestHandler = async (req, res, next) => {
  try {
    const query = fuelVouchersQuerySchema.parse(req.query);
    res.status(200).json(fuelVouchersResponseSchema.parse(await listFuelVouchers(query)));
  } catch (error) {
    next(error);
  }
};

/** Validation d'un bon de carburant (P-17). Réservée à ceux qui gèrent la carte : le technicien reçoit 403. */
const validateVoucher: RequestHandler = async (req, res, next) => {
  try {
    const { id } = fuelVoucherParamsSchema.parse(req.params);
    const result = await validateFuelVoucher(req.user!.id, id);
    // Couche 2 : les autres profils carburant voient le bon passer à « Validé ».
    const broadcast = (global as { broadcastUpdate?: (event: string, data: unknown) => void }).broadcastUpdate;
    if (broadcast) broadcast("fuel_record_validated", { id: result.id, scope: REALTIME_EVENTS.fuel_record_validated.scope });
    else log.warn({ requestId: req.requestId }, "diffusion temps réel indisponible");
    res.status(200).json(fuelVoucherValidationResponseSchema.parse(result));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/fuel-vouchers", requireFeature("fuel-vouchers"), authenticate, authorize([...FUEL_READ_ROLES]), listVouchers);
router.post("/fuel-vouchers/:id/validate", requireFeature("fuel-vouchers"), authenticate, isFuelCardManager, validateVoucher);

export default router;
