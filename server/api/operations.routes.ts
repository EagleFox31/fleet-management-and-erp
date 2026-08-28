import { Router, Request, Response } from "express";
import { operationsService } from "../services/operations-service";
import { authenticate } from "../middleware/auth";

const router = Router();

const broadcastOperationMissionUpdate = (
  eventType: string,
  payload: Record<string, unknown>,
  options?: {
    missionId?: number | null;
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
    entity: "mission",
    entityId: options?.missionId ?? null,
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
 * Routes API Operations & Missions
 * 
 * Endpoints:
 * - POST /api/operations/missions/from-fuel - Créer mission depuis fuel record
 * - GET /api/operations/missions - Liste missions avec filtres
 * - GET /api/operations/missions/by-client/:clientName - Missions par client
 * - GET /api/operations/stats/by-client - Statistiques globales par client
 * - GET /api/operations/stats/by-destination - Statistiques par destination
 * - GET /api/operations/missions/:id/costs - Coûts détaillés d'une mission
 */

/**
 * POST /api/operations/missions/from-fuel
 * Créer une mission depuis un enregistrement carburant
 */
router.post("/missions/from-fuel", authenticate, async (req: Request, res: Response) => {
  try {
    const { fuelRecordId, clientName, orderNumber, pickupAddress, roadExpenses } = req.body;

    if (!fuelRecordId || !clientName) {
      return res.status(400).json({ error: "fuelRecordId et clientName sont requis" });
    }

    const result = await operationsService.createMissionFromFuel(
      parseInt(fuelRecordId),
      {
        clientName,
        orderNumber,
        pickupAddress,
        roadExpenses,
        userId: (req as any).user?.id || 1,
      }
    );

    const missionId =
      typeof (result as any)?.mission?.id === "number"
        ? (result as any).mission.id
        : typeof (result as any)?.id === "number"
          ? (result as any).id
          : null;

    broadcastOperationMissionUpdate(
      "mission_created_from_fuel",
      {
        fuelRecordId: parseInt(fuelRecordId),
        result,
      },
      {
        missionId,
        actorUserId: req.session?.userId ?? null,
        actorRole: req.session?.role ?? null,
      },
    );

    res.json(result);
  } catch (error: any) {
    console.error("Error creating mission from fuel:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/operations/missions/upcoming
 * Missions planifiées / assignées (pas encore démarrées)
 */
router.get("/missions/upcoming", authenticate, async (req: Request, res: Response) => {
  try {
    const missions = await operationsService.getUpcomingMissions();
    res.json(missions);
  } catch (error: any) {
    console.error("Error fetching upcoming missions:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/operations/missions/active
 * Missions en cours (in_progress)
 */
router.get("/missions/active", authenticate, async (req: Request, res: Response) => {
  try {
    const missions = await operationsService.getActiveMissions();
    res.json(missions);
  } catch (error: any) {
    console.error("Error fetching active missions:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/operations/missions
 * Liste toutes les missions avec filtres optionnels
 */
router.get("/missions", authenticate, async (req: Request, res: Response) => {
  try {
    const { status, clientId, startDate, endDate } = req.query;

    const filters: any = {};

    if (status) filters.status = status as string;
    if (clientId) filters.clientId = parseInt(clientId as string);
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const missions = await operationsService.getAllMissions(filters);

    res.json(missions);
  } catch (error: any) {
    console.error("Error fetching missions:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/operations/missions/by-client/:clientName
 * Récupérer missions et statistiques pour un client spécifique
 */
router.get("/missions/by-client/:clientName", authenticate, async (req: Request, res: Response) => {
  try {
    const { clientName } = req.params;
    const { status, startDate, endDate } = req.query;

    const filters: any = {};
    if (status) filters.status = status as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const result = await operationsService.getMissionsByClient(clientName, filters);

    res.json(result);
  } catch (error: any) {
    console.error("Error fetching missions by client:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/operations/stats/by-client
 * Statistiques globales par client (MAERSK, CNPCC, AGL, SODECOTON)
 */
router.get("/stats/by-client", authenticate, async (req: Request, res: Response) => {
  try {
    const stats = await operationsService.getStatsByClient();
    res.json(stats);
  } catch (error: any) {
    console.error("Error fetching stats by client:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/operations/stats/by-destination
 * Statistiques par destination (NDJAMENA, DLA-NDERE, TOUBORO)
 */
router.get("/stats/by-destination", authenticate, async (req: Request, res: Response) => {
  try {
    const stats = await operationsService.getStatsByDestination();
    res.json(stats);
  } catch (error: any) {
    console.error("Error fetching stats by destination:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/operations/missions/:id/costs
 * Calculer les coûts détaillés d'une mission
 */
router.get("/missions/:id/costs", authenticate, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const costs = await operationsService.calculateMissionCosts(parseInt(id));
    res.json(costs);
  } catch (error: any) {
    console.error("Error calculating mission costs:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
