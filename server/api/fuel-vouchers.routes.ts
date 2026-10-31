import { Router, type RequestHandler } from "express";
import { fuelVoucherParamsSchema, fuelVoucherValidationResponseSchema } from "@shared/contracts/fuel-vouchers";
import { requireFeature } from "../lib/feature-flags";
import { authenticate, isFuelCardManager } from "../middleware/auth";
import { validateFuelVoucher } from "../services/fuel-voucher-service";

/** Validation d'un bon de carburant (P-17). Réservée à ceux qui gèrent la carte : le technicien reçoit 403. */
const validateVoucher: RequestHandler = async (req, res, next) => {
  try {
    const { id } = fuelVoucherParamsSchema.parse(req.params);
    const result = await validateFuelVoucher(req.user!.id, id);
    res.status(200).json(fuelVoucherValidationResponseSchema.parse(result));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.post("/fuel-vouchers/:id/validate", requireFeature("fuel-vouchers"), authenticate, isFuelCardManager, validateVoucher);

export default router;
