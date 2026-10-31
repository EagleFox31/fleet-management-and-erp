import { Router, type RequestHandler } from "express";
import {
  createFuelPriceRequestSchema,
  fuelPriceSchema,
  fuelPricesResponseSchema,
} from "@shared/contracts/fuel-prices";
import { requireFeature } from "../lib/feature-flags";
import { authenticate, isFuelCardManager, isStaff } from "../middleware/auth";
import { listFuelPrices, setFuelPrice } from "../services/fuel-price-service";

/** Prix du litre daté (P-19). Lecture pour le personnel, écriture pour ceux qui gèrent la carte. */
const getPrices: RequestHandler = async (_req, res, next) => {
  try {
    res.status(200).json(fuelPricesResponseSchema.parse(await listFuelPrices()));
  } catch (error) {
    next(error);
  }
};

const postPrice: RequestHandler = async (req, res, next) => {
  try {
    const input = createFuelPriceRequestSchema.parse(req.body);
    res.status(201).json(fuelPriceSchema.parse(await setFuelPrice(req.user!.id, input)));
  } catch (error) {
    next(error);
  }
};

const router = Router();
router.get("/fuel-prices", requireFeature("fuel-prices"), authenticate, isStaff, getPrices);
router.post("/fuel-prices", requireFeature("fuel-prices"), authenticate, isFuelCardManager, postPrice);

export default router;
