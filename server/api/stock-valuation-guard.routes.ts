import { Router } from "express";
import { isStockValuationReader } from "../middleware/auth";

const router = Router();

/**
 * Valuation du stock servie par server/routes.ts (gelé) : garde seule, la route prend le relais
 * par `next()`. `/api/parts/statistics` porte `totalValue` (quantité × prix unitaire) : réservé à
 * STOCK_VALUATION_READ_ROLES, chauffeur et client exclus. Les routes `/api/warehouse/*` portent
 * la même garde directement (server/api/warehouse.routes.ts).
 */
router.get("/parts/statistics", isStockValuationReader, (_req, _res, next) => next());

// Pièces extraites d'une facture : `unitPrice` et `totalValue` (prix × stock) par pièce. Même périmètre.
router.get("/invoices/:id/parts", isStockValuationReader, (_req, _res, next) => next());

export default router;
