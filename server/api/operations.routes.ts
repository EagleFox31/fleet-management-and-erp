import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { operationsService } from "../services/operations-service";
import { AppError } from "../lib/app-error";
import { authenticate, authorize } from "../middleware/auth";
import { moduleLogger } from "../lib/logger";
import { MISSION_MANAGER_ROLES } from "@shared/constants/roles";
import { driverScopeOf } from "../lib/driver-scope";

const log = moduleLogger("operations");
const router = Router();

/**
 * Cloison chauffeur (AGENTS §11) : coûts, rapprochement par client et statistiques couvrent
 * toute l'exploitation (carburant, prix d'achat du véhicule, chiffre d'affaires). Le chauffeur
 * n'y a pas accès, même pour sa propre mission ; ses missions se lisent par les listes
 * filtrées et par /api/missions/:id.
 */
const OPERATIONS_COSTS_DRIVER_MESSAGE = "Accès refusé : les coûts et statistiques d'exploitation sont réservés au personnel de gestion.";
const refuseDriver = (req: Request, _res: Response, next: NextFunction) => {
  if (req.user?.role === "driver") return next(new AppError(403, OPERATIONS_COSTS_DRIVER_MESSAGE));
  next();
};

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
const createFromFuelSchema = z.object({
  fuelRecordId: z.coerce.number().int().positive(),
  clientName: z.string().trim().min(1),
  orderNumber: z.string().trim().optional(),
  pickupAddress: z.string().trim().optional(),
  roadExpenses: z.coerce.number().nonnegative().optional(),
});

router.post("/missions/from-fuel", authorize([...MISSION_MANAGER_ROLES]), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = createFromFuelSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        message: "fuelRecordId et clientName sont requis.",
        errors: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
      });
    }
    const { fuelRecordId, clientName, orderNumber, pickupAddress, roadExpenses } = parsed.data;

    const result = await operationsService.createMissionFromFuel(
      fuelRecordId,
      {
        clientName,
        orderNumber,
        pickupAddress,
        roadExpenses,
        // authorize charge req.user : plus de repli sur l'utilisateur 1, qui attribuait la mission à l'admin.
        userId: req.user!.id,
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
        fuelRecordId,
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
    // Enregistrement carburant inconnu (404) : le gestionnaire central rend l'ApiErrorBody.
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Error creating mission from fuel:");
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * GET /api/operations/missions/upcoming
 * Missions planifiées / assignées (pas encore démarrées)
 */
router.get("/missions/upcoming", authenticate, async (req: Request, res: Response) => {
  try {
    const missions = await operationsService.getUpcomingMissions(await driverScopeOf(req.user));
    res.json(missions);
  } catch (error: any) {
    log.error({ err: error, requestId: req.requestId }, "Error fetching upcoming missions:");
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * GET /api/operations/missions/active
 * Missions en cours (in_progress)
 */
router.get("/missions/active", authenticate, async (req: Request, res: Response) => {
  try {
    const missions = await operationsService.getActiveMissions(await driverScopeOf(req.user));
    res.json(missions);
  } catch (error: any) {
    log.error({ err: error, requestId: req.requestId }, "Error fetching active missions:");
    res.status(500).json({ message: "Erreur serveur." });
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

    const missions = await operationsService.getAllMissions(filters, await driverScopeOf(req.user));

    res.json(missions);
  } catch (error: any) {
    log.error({ err: error, requestId: req.requestId }, "Error fetching missions:");
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * GET /api/operations/missions/by-client/:clientName
 * Récupérer missions et statistiques pour un client spécifique
 */
router.get("/missions/by-client/:clientName", authenticate, refuseDriver, async (req: Request, res: Response) => {
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
    log.error({ err: error, requestId: req.requestId }, "Error fetching missions by client:");
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * GET /api/operations/stats/by-client
 * Statistiques globales par client (MAERSK, CNPCC, AGL, SODECOTON)
 */
router.get("/stats/by-client", authenticate, refuseDriver, async (req: Request, res: Response) => {
  try {
    const stats = await operationsService.getStatsByClient();
    res.json(stats);
  } catch (error: any) {
    log.error({ err: error, requestId: req.requestId }, "Error fetching stats by client:");
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * GET /api/operations/stats/by-destination
 * Statistiques par destination (NDJAMENA, DLA-NDERE, TOUBORO)
 */
router.get("/stats/by-destination", authenticate, refuseDriver, async (req: Request, res: Response) => {
  try {
    const stats = await operationsService.getStatsByDestination();
    res.json(stats);
  } catch (error: any) {
    log.error({ err: error, requestId: req.requestId }, "Error fetching stats by destination:");
    res.status(500).json({ message: "Erreur serveur." });
  }
});

/**
 * GET /api/operations/missions/:id/costs
 * Calculer les coûts détaillés d'une mission
 */
router.get("/missions/:id/costs", authenticate, refuseDriver, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const costs = await operationsService.calculateMissionCosts(parseInt(id));
    res.json(costs);
  } catch (error: any) {
    log.error({ err: error, requestId: req.requestId }, "Error calculating mission costs:");
    res.status(500).json({ message: "Erreur serveur." });
  }
});

export default router;
