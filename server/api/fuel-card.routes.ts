import { Router } from "express";
import { authenticate, authorize, isFuelCardManager } from "../middleware/auth";
import { isFeatureEnabled } from "../lib/feature-flags";
import { treasuryService } from "../services/treasury-service";
import { fuelCardService, toFuelCardAppError } from "../services/fuel-card-service";
import { moduleLogger } from "../lib/logger";
import { ownerScopeOf } from "../lib/client-scope";
import { presentFuelCardBalance } from "../lib/fuel-balance-scope";
import { withLogContext } from "../lib/error-log-context";
import { resolveFuelUnitPrice } from "../lib/fuel-unit-price";
import { AppError } from "../lib/app-error";
import { parseQueryId, parseRouteId } from "../lib/route-id";
import { toFieldErrors } from "@shared/errors";
import { z } from "zod";
import { MAX_DB_INTEGER_ID } from "@shared/contracts/common";
import { FUEL_RECHARGE_SOURCE_ROLES, STAFF_ROLES } from "@shared/constants/roles";

const log = moduleLogger("fuel-card");

const router = Router();
// Nombre ou chaîne de chiffres seulement : `z.coerce` seul ferait de `true` le compte 1.
const sourceAccountIdSchema = z.union([z.number(), z.string().trim().regex(/^\d+$/)]).pipe(z.coerce.number().int().positive().max(MAX_DB_INTEGER_ID));

/** Nombre JSON ou chaîne décimale (formulaires) : jamais « 100abc » lu 100 comme le faisait parseFloat. */
const positiveAmount = z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/)]).pipe(z.coerce.number().finite().positive());
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || undefined);

/**
 * Corps entier de POST /recharge, strict : une clé inconnue ou un type inattendu (`date: {}`) donne 400,
 * jamais 500. `sourceAccountId` reste brut ici : le rôle est contrôlé avant de lire l'identifiant.
 */
const rechargeBodySchema = z
  .object({
    amount: positiveAmount,
    quantity: positiveAmount.nullish(),
    unitPrice: positiveAmount.nullish(),
    priceSource: z.enum(["real", "fallback", "manual"]).nullish(),
    date: z.string().trim().min(1).max(40).refine((v) => !Number.isNaN(new Date(v).getTime()), "Date de recharge illisible."),
    paymentMode: z.string().trim().min(1).max(50),
    orderNumber: optionalText(100),
    notes: optionalText(2000),
    sourceAccountId: z.unknown().optional(),
  })
  .strict()
  .refine((body) => body.quantity != null || body.unitPrice != null, {
    message: "Indiquez la quantité ou le prix par litre.",
    path: ["unitPrice"],
  });

const broadcastFuelCardUpdate = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    entityId?: number | null;
    actorUserId?: number | null;
    actorRole?: string | null;
  },
) => {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate(eventType, {
    version: 1,
    entity: "fuel_card",
    entityId: options?.entityId ?? null,
    payload,
    scope: { type: "roles", roles: [...STAFF_ROLES] },
    actor: {
      userId: options?.actorUserId ?? null,
      role: options?.actorRole ?? null,
    },
    emittedAt: new Date().toISOString(),
  });
};

/**
 * Routes API Fuel Card Service
 * Exploitation des 24 enregistrements (14,1M FCFA solde)
 */

// Apply authentication middleware to ALL routes in this router
router.use(authenticate);

// Comptes qui peuvent payer une recharge (banque, caisse), sans solde : la logistique choisit le compte
// sans lire la trésorerie. Drapeau `finance` coupé : liste vide, le champ disparaît de l'écran.
router.get("/source-accounts", authorize([...FUEL_RECHARGE_SOURCE_ROLES]), async (_req, res, next) => {
  try {
    res.json(isFeatureEnabled("finance") ? await treasuryService.listRechargeSourceAccounts() : []);
  } catch (error) {
    next(withLogContext(error, { event: "liste des comptes source de recharge en échec" }));
  }
});

// Solde actuel de la carte carburant
router.get("/balance", async (req, res, next) => {
  try {
    const balance = await fuelCardService.getCurrentBalance();
    return res.status(200).json(presentFuelCardBalance(req.user, balance));
  } catch (error) {
    next(withLogContext(error, { event: "lecture du solde de la carte carburant en échec" }));
  }
});

router.post("/recharge", isFuelCardManager, async (req, res, next) => {
  try {
    const body = rechargeBodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      return res.status(400).json({ message: "Données de recharge incomplètes", errors: toFieldErrors(body.error.issues) });
    }
    const { amount: amountValue, quantity, unitPrice, priceSource, date, paymentMode, orderNumber, notes, sourceAccountId } = body.data;
    // Compte de trésorerie qui paie la recharge (facultatif, lot T2).
    let sourceAccountValue: number | null = null;
    if (sourceAccountId !== undefined && sourceAccountId !== null && sourceAccountId !== "") {
      // Débiter une banque ou une caisse : liste explicite, refus avant toute lecture du compte.
      if (!(FUEL_RECHARGE_SOURCE_ROLES as readonly string[]).includes(String(req.user?.role ?? ""))) {
        throw new AppError(403, "Votre rôle ne permet pas de choisir le compte qui paie la recharge.");
      }
      const parsed = sourceAccountIdSchema.safeParse(sourceAccountId);
      if (!parsed.success) return res.status(400).json({ message: "Compte source de la recharge invalide" });
      sourceAccountValue = parsed.data;
    }

    const resolvedQuantity = quantity ?? amountValue / unitPrice!;
    const resolvedUnitPrice = unitPrice ?? amountValue / quantity!;
    
    const result = await fuelCardService.rechargeCard({
      amount: amountValue,
      quantity: resolvedQuantity,
      unitPrice: resolvedUnitPrice,
      priceSource: priceSource ?? undefined,
      date,
      paymentMode,
      orderNumber,
      notes,
      userId: (req as any).session.userId,
      sourceAccountId: sourceAccountValue,
    });

    broadcastFuelCardUpdate(
      "fuel_card_recharged",
      {
        recharge: result,
      },
      {
        entityId: typeof result?.recharge?.id === "number" ? result.recharge.id : null,
        actorUserId: (req as any).session?.userId ?? null,
        actorRole: (req as any).session?.role ?? null,
      },
    );
    
    return res.status(201).json(result);
  } catch (error) {
    return next(withLogContext(toFuelCardAppError(error), { event: "recharge de la carte carburant en échec" }));
  }
});

// Corps de POST /consumption : les nombres peuvent arriver en chaîne (formulaires), jamais en NaN.
// Un message par champ, repris de l'ancien contrôle : il sert de message principal et de `errors`.
const INCOMPLETE = "Données de consommation incomplètes";
const QUANTITY_MESSAGE = "La quantité doit être un nombre positif.";
const VEHICLE_MESSAGE = "Identifiant de véhicule invalide.";
const requiredText = z.string({ required_error: INCOMPLETE, invalid_type_error: INCOMPLETE }).trim().min(1, INCOMPLETE);
const consumptionBodySchema = z.object({
  vehicleId: z.coerce.number({ invalid_type_error: VEHICLE_MESSAGE }).int(VEHICLE_MESSAGE).positive(VEHICLE_MESSAGE).max(MAX_DB_INTEGER_ID, VEHICLE_MESSAGE),
  quantity: z.coerce.number({ invalid_type_error: QUANTITY_MESSAGE }).positive(QUANTITY_MESSAGE).finite(QUANTITY_MESSAGE),
  // Présent seulement : la lecture du prix (« Prix du litre invalide. ») reste à resolveFuelUnitPrice.
  unitPrice: z.any().refine((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== ""), INCOMPLETE),
  date: requiredText,
  stationName: requiredText,
  destination: requiredText,
  clientName: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
});

// Enregistrer une consommation de carburant (débit)
router.post("/consumption", isFuelCardManager, async (req, res, next) => {
  try {
    const parsedBody = consumptionBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      const fieldErrors = toFieldErrors(parsedBody.error.issues);
      throw new AppError(400, fieldErrors?.[0]?.message ?? "Données de consommation invalides.", {
        fieldErrors,
        cause: parsedBody.error,
      });
    }
    const { vehicleId, quantity, unitPrice, date, stationName, destination, clientName, notes } = parsedBody.data;
    const fillDate = new Date(date);
    if (Number.isNaN(fillDate.getTime())) throw new AppError(400, "Date de plein invalide.");
    // Prix obligatoire (contrat), retenu pour admin et logistique seulement ; sinon prix du jour imposé.
    const actorRole = String((req as any).user?.role ?? "").trim().toLowerCase();
    const resolvedUnitPrice = await resolveFuelUnitPrice(actorRole, Number.parseFloat(String(unitPrice)), fillDate);
    
    const result = await fuelCardService.recordConsumption({
      vehicleId,
      quantity,
      unitPrice: resolvedUnitPrice,
      date,
      stationName,
      destination,
      clientName: clientName ?? undefined,
      notes: notes ?? undefined,
      userId: (req as any).session.userId
    });

    broadcastFuelCardUpdate(
      "fuel_card_consumption_recorded",
      {
        consumption: result,
        vehicleId,
      },
      {
        entityId: typeof result?.consumption?.id === "number" ? result.consumption.id : null,
        actorUserId: (req as any).session?.userId ?? null,
        actorRole: (req as any).session?.role ?? null,
      },
    );
    
    return res.status(201).json(result);
  } catch (error) {
    return next(withLogContext(toFuelCardAppError(error), { event: "enregistrement de la consommation en échec" }));
  }
});

// Historique carburant avec filtres
router.get("/history", async (req, res, next) => {
  try {
    const { year, month, vehicleId, type } = req.query;
    
    const filters: any = {};
    
    if (year) filters.year = parseInt(year as string);
    if (month) filters.month = parseInt(month as string);
    if (vehicleId) filters.vehicleId = parseQueryId(vehicleId, "ID de véhicule invalide");
    if (type && ['credit', 'debit', 'all'].includes(type as string)) {
      filters.type = type as 'credit' | 'debit' | 'all';
    }
    
    const history = await fuelCardService.getFuelHistory(filters);
    
    return res.status(200).json(history);
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Get fuel history error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Statistiques de consommation par véhicule
router.get("/vehicle/:vehicleId/stats", async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.vehicleId, "ID de véhicule invalide");
    
    const stats = await fuelCardService.getConsumptionStatsByVehicle(vehicleId);
    
    return res.status(200).json(stats);
  } catch (error) {
    return next(withLogContext(toFuelCardAppError(error), { event: "statistiques carburant du véhicule en échec" }));
  }
});

// Détection d'anomalies de consommation
router.get("/vehicle/:vehicleId/anomalies", async (req, res, next) => {
  try {
    const vehicleId = parseRouteId(req.params.vehicleId, "ID de véhicule invalide");
    
    const anomalies = await fuelCardService.detectAnomalies(vehicleId);
    
    return res.status(200).json(anomalies);
  } catch (error) {
    return next(withLogContext(toFuelCardAppError(error), { event: "détection des anomalies carburant en échec" }));
  }
});

// Statistiques par client (MAERSK, CNPCC, etc.)
router.get("/stats-by-client", async (req, res, next) => {
  try {
    // Cloison client : un client ne voit que les pleins de ses véhicules (null = personnel).
    const stats = await fuelCardService.getStatsByClient(ownerScopeOf(req.user));

    return res.status(200).json(stats);
  } catch (error) {
    return next(withLogContext(toFuelCardAppError(error), { event: "statistiques carburant par client en échec" }));
  }
});

// Statistiques mensuelles
router.get("/monthly-stats", async (req, res, next) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    
    const stats = await fuelCardService.getMonthlyStats(year, month);
    
    return res.status(200).json(stats);
  } catch (error) {
    next(withLogContext(error, { event: "statistiques mensuelles carburant en échec" }));
  }
});

export default router;
