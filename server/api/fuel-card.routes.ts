import { Router } from "express";
import { authenticate, isFuelCardManager } from "../middleware/auth";
import { fuelCardService } from "../services/fuel-card-service";

const router = Router();

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
    scope: { type: "broadcast" },
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

// Solde actuel de la carte carburant
router.get("/balance", async (_req, res) => {
  try {
    const balance = await fuelCardService.getCurrentBalance();
    return res.status(200).json(balance);
  } catch (error) {
    console.error("Get fuel card balance error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Recharger la carte carburant (crédit)
// Rôles autorisés: admin, logistics, secretary
router.post("/recharge", isFuelCardManager, async (req, res) => {
  try {
    const { amount, quantity, unitPrice, priceSource, date, paymentMode, orderNumber, notes } = req.body;

    const amountValue = Number.parseFloat(String(amount));
    const quantityValue = quantity !== undefined && quantity !== null
      ? Number.parseFloat(String(quantity))
      : NaN;
    const unitPriceValue = unitPrice !== undefined && unitPrice !== null
      ? Number.parseFloat(String(unitPrice))
      : NaN;
    const hasQuantity = Number.isFinite(quantityValue) && quantityValue > 0;
    const hasUnitPrice = Number.isFinite(unitPriceValue) && unitPriceValue > 0;

    if (!Number.isFinite(amountValue) || amountValue <= 0 || !date || !paymentMode || (!hasQuantity && !hasUnitPrice)) {
      return res.status(400).json({ message: "Données de recharge incomplètes" });
    }

    const resolvedQuantity = hasQuantity
      ? quantityValue
      : amountValue / unitPriceValue;
    const resolvedUnitPrice = hasUnitPrice
      ? unitPriceValue
      : amountValue / quantityValue;
    
    const result = await fuelCardService.rechargeCard({
      amount: amountValue,
      quantity: resolvedQuantity,
      unitPrice: resolvedUnitPrice,
      priceSource:
        priceSource === "real" || priceSource === "fallback" || priceSource === "manual"
          ? priceSource
          : undefined,
      date,
      paymentMode,
      orderNumber,
      notes,
      userId: (req as any).session.userId
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
    console.error("Fuel card recharge error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

// Enregistrer une consommation de carburant (débit)
router.post("/consumption", async (req, res) => {
  try {
    const { vehicleId, quantity, unitPrice, date, stationName, destination, clientName, notes } = req.body;
    
    if (!vehicleId || !quantity || !unitPrice || !date || !stationName || !destination) {
      return res.status(400).json({ message: "Données de consommation incomplètes" });
    }
    
    const result = await fuelCardService.recordConsumption({
      vehicleId: parseInt(vehicleId),
      quantity: parseFloat(quantity),
      unitPrice: parseFloat(unitPrice),
      date,
      stationName,
      destination,
      clientName,
      notes,
      userId: (req as any).session.userId
    });

    broadcastFuelCardUpdate(
      "fuel_card_consumption_recorded",
      {
        consumption: result,
        vehicleId: parseInt(vehicleId),
      },
      {
        entityId: typeof result?.consumption?.id === "number" ? result.consumption.id : null,
        actorUserId: (req as any).session?.userId ?? null,
        actorRole: (req as any).session?.role ?? null,
      },
    );
    
    return res.status(201).json(result);
  } catch (error) {
    console.error("Record fuel consumption error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

// Historique carburant avec filtres
router.get("/history", async (req, res) => {
  try {
    const { year, month, vehicleId, type } = req.query;
    
    const filters: any = {};
    
    if (year) filters.year = parseInt(year as string);
    if (month) filters.month = parseInt(month as string);
    if (vehicleId) filters.vehicleId = parseInt(vehicleId as string);
    if (type && ['credit', 'debit', 'all'].includes(type as string)) {
      filters.type = type as 'credit' | 'debit' | 'all';
    }
    
    const history = await fuelCardService.getFuelHistory(filters);
    
    return res.status(200).json(history);
  } catch (error) {
    console.error("Get fuel history error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Statistiques de consommation par véhicule
router.get("/vehicle/:vehicleId/stats", async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    
    if (isNaN(vehicleId)) {
      return res.status(400).json({ message: "ID de véhicule invalide" });
    }
    
    const stats = await fuelCardService.getConsumptionStatsByVehicle(vehicleId);
    
    return res.status(200).json(stats);
  } catch (error) {
    console.error("Get vehicle fuel stats error:", error);
    return res.status(500).json({ 
      message: error instanceof Error ? error.message : "Erreur serveur" 
    });
  }
});

// Détection d'anomalies de consommation
router.get("/vehicle/:vehicleId/anomalies", async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId);
    
    if (isNaN(vehicleId)) {
      return res.status(400).json({ message: "ID de véhicule invalide" });
    }
    
    const anomalies = await fuelCardService.detectAnomalies(vehicleId);
    
    return res.status(200).json(anomalies);
  } catch (error) {
    console.error("Detect fuel anomalies error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Statistiques par client (MAERSK, CNPCC, etc.)
router.get("/stats-by-client", async (_req, res) => {
  try {
    const stats = await fuelCardService.getStatsByClient();
    
    return res.status(200).json(stats);
  } catch (error) {
    console.error("Get fuel stats by client error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// Statistiques mensuelles
router.get("/monthly-stats", async (req, res) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = parseInt(req.query.month as string) || new Date().getMonth() + 1;
    
    const stats = await fuelCardService.getMonthlyStats(year, month);
    
    return res.status(200).json(stats);
  } catch (error) {
    console.error("Get monthly fuel stats error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
