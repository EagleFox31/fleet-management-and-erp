import { Router, type NextFunction, type Request, type Response } from "express";
import {
  closePaymentInstrumentSchema,
  createPaymentInstrumentSchema,
  listPaymentInstrumentsQuerySchema,
  payPaymentInstrumentSchema,
  updatePaymentInstrumentSchema,
} from "@shared/contracts/payment-instruments";
import { TREASURY_READ_ROLES, TREASURY_WRITE_ROLES } from "@shared/constants/roles";
import { requireFeature } from "../lib/feature-flags";
import { parseRouteId } from "../lib/route-id";
import { authorize } from "../middleware/auth";
import { paymentInstrumentsService } from "../services/payment-instruments-service";

/**
 * Traites et chèques (lot T4), derrière le drapeau `finance`. Saisie : administrateur et secrétariat ;
 * lecture : + direction. Contrat : shared/contracts/payment-instruments.ts.
 */
const router = Router();
const finance = requireFeature("finance");
/** Routeur monté sous `/api` (server/api/index.ts) : chemins écrits en clair pour les cliquets, alignés sur PAYMENT_INSTRUMENTS_PATH (le test de contrat appelle ce chemin). */
const BAD_ID = "Identifiant de traite ou de chèque invalide.";

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (error) {
      next(error);
    }
  };

router.get(
  "/treasury/instruments",
  finance,
  authorize([...TREASURY_READ_ROLES]),
  handle(async (req, res) => {
    res.json(await paymentInstrumentsService.list(listPaymentInstrumentsQuerySchema.parse(req.query)));
  }),
);

router.get(
  "/treasury/instruments/:id",
  finance,
  authorize([...TREASURY_READ_ROLES]),
  handle(async (req, res) => {
    res.json(await paymentInstrumentsService.get(parseRouteId(req.params.id, BAD_ID)));
  }),
);

router.post(
  "/treasury/instruments",
  finance,
  authorize([...TREASURY_WRITE_ROLES]),
  handle(async (req, res) => {
    const input = createPaymentInstrumentSchema.parse(req.body);
    const audit = { createdBy: req.user!.id };
    const { instrument, replayed } = await paymentInstrumentsService.create(audit.createdBy, input);
    res.status(replayed ? 200 : 201).json(instrument);
  }),
);

router.patch(
  "/treasury/instruments/:id",
  finance,
  authorize([...TREASURY_WRITE_ROLES]),
  handle(async (req, res) => {
    const id = parseRouteId(req.params.id, BAD_ID);
    const input = updatePaymentInstrumentSchema.parse(req.body);
    const audit = { updatedBy: req.user!.id };
    res.json(await paymentInstrumentsService.update(audit.updatedBy, id, input));
  }),
);

router.post(
  "/treasury/instruments/:id/pay",
  finance,
  authorize([...TREASURY_WRITE_ROLES]),
  handle(async (req, res) => {
    const id = parseRouteId(req.params.id, BAD_ID);
    const input = payPaymentInstrumentSchema.parse(req.body);
    const audit = { updatedBy: req.user!.id };
    const { instrument, replayed } = await paymentInstrumentsService.pay(audit.updatedBy, id, input);
    res.json({ instrument, replayed });
  }),
);

router.post(
  "/treasury/instruments/:id/status",
  finance,
  authorize([...TREASURY_WRITE_ROLES]),
  handle(async (req, res) => {
    const id = parseRouteId(req.params.id, BAD_ID);
    const input = closePaymentInstrumentSchema.parse(req.body);
    const audit = { updatedBy: req.user!.id };
    const { instrument, replayed } = await paymentInstrumentsService.close(audit.updatedBy, id, input);
    res.json({ instrument, replayed });
  }),
);

export default router;
