import { Router } from "express";
import { requireFeature } from "../lib/feature-flags";
import { authorize } from "../middleware/auth";
import { aggregateReadsService } from "../services/aggregate-reads-service";

const router = Router();

/** Opérations clients à facturer, regroupées par client. */
router.get(
  "/billing/pending-invoices",
  requireFeature("pending-invoices"),
  authorize(["admin", "management", "secretary", "logistics"]),
  async (_req, res, next) => {
    try {
      res.json(await aggregateReadsService.pendingInvoices());
    } catch (err) {
      next(err);
    }
  },
);

export default router;
