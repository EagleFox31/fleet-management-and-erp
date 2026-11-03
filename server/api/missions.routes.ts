import { getFuelPriceAt } from "../services/fuel-price-service";
import { Router } from "express";
import { db } from "../db";
import { missions, clients, assignments, drivers, vehicles, vehicleDocuments, alerts, documentRenewalRequests } from "@shared/schema";
import { eq, and, desc, inArray, ne, or, ilike, isNull } from "drizzle-orm";
import { insertMissionSchema, insertAssignmentSchema } from "@shared/schema";
import { FuelCardService } from "../services/fuel-card-service";
import { storage } from "../storage";
import { z } from "zod";
import {
  getMissionEligibility,
  formatEligibilityRefusal,
} from "@shared/constants/vehicle-eligibility";
import {
  extractMissionActualRoadExpensesHT,
  mergeMissionActualFdrCost,
} from "@shared/constants/management-mission-profitability";
import { AppError } from "../lib/app-error";
import { canAccessMissionAsDriver, driverScopeOf, OUT_OF_DRIVER_SCOPE_MESSAGE } from "../lib/driver-scope";

const router = Router();
const fuelCardService = new FuelCardService();

// Cloison chauffeur (DRV2-3) : toute route `/:id/...` du routeur refuse un chauffeur
// non affecté à la mission. Le personnel n'est pas filtré. Mission inconnue : 403 aussi,
// pour ne pas révéler l'existence d'un identifiant.
router.param("id", async (req, _res, next, value) => {
  try {
    const missionId = Number(value);
    if (!Number.isInteger(missionId)) return next();
    if (!(await canAccessMissionAsDriver(req.user, missionId))) {
      throw new AppError(403, OUT_OF_DRIVER_SCOPE_MESSAGE);
    }
    next();
  } catch (error) {
    next(error);
  }
});

type MissionRealtimeEvent =
  | "mission_created"
  | "mission_updated"
  | "mission_completed"
  | "mission_status_changed";

type VehicleDocumentRequirementType = "carte_grise" | "assurance" | "visite_technique";

function broadcastMissionUpdate(
  eventType: MissionRealtimeEvent,
  mission: Record<string, unknown>,
  extraPayload: Record<string, unknown> = {},
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  const missionId =
    typeof mission.id === "number"
      ? mission.id
      : Number.parseInt(String(mission.id ?? ""), 10) || null;

  broadcastUpdate(eventType, {
    entity: "mission",
    entityId: missionId,
    payload: {
      mission,
      missionId,
      ...extraPayload,
    },
    scope: { type: "broadcast" },
  });
}

function broadcastAlertCreated(
  alert: {
    id: number;
    userId: number | null;
    title: string;
    type: string;
    priority: string;
    link: string | null;
    message: string;
  },
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  if (!alert.userId) {
    return;
  }

  broadcastUpdate("alert_created", {
    entity: "alert",
    entityId: alert.id,
    payload: {
      alertId: alert.id,
      userId: alert.userId,
      title: alert.title,
      type: alert.type,
      priority: alert.priority,
      link: alert.link,
      message: alert.message,
    },
    scope: { type: "user", userIds: [alert.userId] },
  });
}

function broadcastMissionFuelRecorded(params: {
  missionId: number;
  fuelRecord: Record<string, unknown>;
  actorUserId: number | null;
  actorRole: string | null;
}): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  broadcastUpdate("mission_fuel_recorded", {
    version: 1,
    entity: "mission",
    entityId: params.missionId,
    payload: {
      missionId: params.missionId,
      record: params.fuelRecord,
      vehicleId: params.fuelRecord.vehicleId ?? null,
    },
    scope: { type: "broadcast" },
    actor: {
      userId: params.actorUserId,
      role: params.actorRole,
    },
    emittedAt: new Date().toISOString(),
  });
}

const MISSION_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["planned", "cancelled"],
  planned: ["assigned", "in_progress", "cancelled"],
  assigned: ["in_progress", "cancelled"],
  in_progress: ["delivered", "cancelled"],
  delivered: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const ACTIVE_MISSION_STATUSES: string[] = ["planned", "assigned", "in_progress"];
const DOCUMENT_REQUESTABLE_TYPES: VehicleDocumentRequirementType[] = [
  "carte_grise",
  "assurance",
  "visite_technique",
];

const DOCUMENT_LABELS: Record<VehicleDocumentRequirementType, string> = {
  carte_grise: "Carte grise",
  assurance: "Assurance",
  visite_technique: "Visite technique",
};

const DOCUMENT_ALERT_TITLES: Record<VehicleDocumentRequirementType, string> = {
  carte_grise: "Renouvellement carte grise",
  assurance: "Renouvellement assurance",
  visite_technique: "Renouvellement visite technique",
};

const OPEN_RENEWAL_STATUSES = ["pending", "in_progress"] as const;
const MISSION_FUEL_ALLOWED_STATUSES = ["planned", "assigned", "in_progress", "delivered"] as const;
const MISSION_FUEL_REGULARIZATION_ALLOWED_STATUSES = ["delivered", "completed"] as const;
const MISSION_FUEL_DECLARATION_ALLOWED_STATUSES = ["delivered", "completed"] as const;
const MISSION_FUEL_MANAGERS = ["admin", "logistics", "secretary"] as const;

const ALERT_TITLE_TO_DOCUMENT_TYPE = Object.fromEntries(
  Object.entries(DOCUMENT_ALERT_TITLES).map(([documentType, alertTitle]) => [alertTitle, documentType]),
) as Record<string, VehicleDocumentRequirementType>;

function normalizeCpcStatus(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function isDateExpired(dateValue: Date | string | null | undefined): boolean {
  if (!dateValue) return true;
  const candidate = new Date(dateValue);
  if (Number.isNaN(candidate.getTime())) return true;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  candidate.setHours(0, 0, 0, 0);
  return candidate < now;
}

/**
 * Même règle que `getMissionEligibility` : le jour de l'échéance bloque (jours écoulés >= 0).
 * Date illisible : bloque.
 */
function isExpiredOnOrBeforeToday(dateValue: Date | string): boolean {
  const candidate = new Date(dateValue);
  if (Number.isNaN(candidate.getTime())) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  candidate.setHours(0, 0, 0, 0);
  return candidate <= today;
}

function overlaps(
  startA: Date | string | null | undefined,
  endA: Date | string | null | undefined,
  startB: Date | string | null | undefined,
  endB: Date | string | null | undefined,
): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  const sA = new Date(startA).getTime();
  const eA = new Date(endA).getTime();
  const sB = new Date(startB).getTime();
  const eB = new Date(endB).getTime();
  if ([sA, eA, sB, eB].some((v) => Number.isNaN(v))) return false;
  return sA <= eB && eA >= sB;
}

type MissionBudgetPlan = {
  fuelBudget: number | null;
  roadExpensesBudget: number | null;
  contingencyBudget: number | null;
};

type MissionBudgetPatch = Partial<MissionBudgetPlan>;

type MissionBudgetSuggestion = MissionBudgetPlan & {
  confidence: "low" | "medium" | "high";
  assumptions: {
    distanceKm: number;
    consumptionL100: number;
    fuelUnitPrice: number;
    delayFactor: number;
    clientFactor: number;
    loadFactor: number;
    riskRate: number;
  };
};

type MissionNoRefuelDeclaration = {
  reason: string;
  declaredAt: string;
  declaredBy: number | null;
  declaredRole: string | null;
};

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseBudgetNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue;
}

function extractMissionBudgetPlan(
  workflowData: unknown,
  fallbackEstimatedFuelCost?: unknown,
): MissionBudgetPlan {
  const workflowDataObj = asPlainObject(workflowData);
  const budgetPlanObj = asPlainObject(workflowDataObj?.budgetPlan);

  const fuelBudget =
    parseBudgetNumber(budgetPlanObj?.fuelBudget) ??
    parseBudgetNumber(budgetPlanObj?.fuel) ??
    parseBudgetNumber(fallbackEstimatedFuelCost);
  const roadExpensesBudget =
    parseBudgetNumber(budgetPlanObj?.roadExpensesBudget) ??
    parseBudgetNumber(budgetPlanObj?.roadBudget) ??
    parseBudgetNumber(budgetPlanObj?.fdrBudget);
  const contingencyBudget =
    parseBudgetNumber(budgetPlanObj?.contingencyBudget) ??
    parseBudgetNumber(budgetPlanObj?.unexpectedBudget) ??
    parseBudgetNumber(budgetPlanObj?.imprevuBudget);

  return {
    fuelBudget: fuelBudget !== null ? fuelBudget : null,
    roadExpensesBudget: roadExpensesBudget !== null ? roadExpensesBudget : null,
    contingencyBudget: contingencyBudget !== null ? contingencyBudget : null,
  };
}

function mergeMissionBudgetPlan(
  existingWorkflowData: unknown,
  patch: MissionBudgetPatch,
): Record<string, unknown> {
  const workflowDataObj = asPlainObject(existingWorkflowData) ?? {};
  const existingBudgetPlan = asPlainObject(workflowDataObj.budgetPlan) ?? {};

  const nextBudgetPlan: Record<string, unknown> = {
    ...existingBudgetPlan,
  };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    nextBudgetPlan[key] = value;
  }

  return {
    ...workflowDataObj,
    budgetPlan: nextBudgetPlan,
  };
}

function isMissionFuelManagerRole(role: string | null | undefined): boolean {
  const normalizedRole = String(role || "").trim().toLowerCase();
  return MISSION_FUEL_MANAGERS.includes(normalizedRole as (typeof MISSION_FUEL_MANAGERS)[number]);
}

function extractMissionNoRefuelDeclaration(workflowData: unknown): MissionNoRefuelDeclaration | null {
  const workflowDataObj = asPlainObject(workflowData);
  const fuelTrackingObj = asPlainObject(workflowDataObj?.fuelTracking);
  const declarationObj = asPlainObject(fuelTrackingObj?.noRefuelDeclaration);
  if (!declarationObj) return null;

  const reason = String(declarationObj.reason || "").trim();
  const declaredAtRaw = String(declarationObj.declaredAt || "").trim();
  const declaredAt = toIsoIfValid(declaredAtRaw);
  if (!reason || !declaredAt) return null;

  const declaredByRaw = declarationObj.declaredBy;
  const declaredBy =
    typeof declaredByRaw === "number" && Number.isFinite(declaredByRaw)
      ? declaredByRaw
      : declaredByRaw !== null && declaredByRaw !== undefined
        ? Number.parseInt(String(declaredByRaw), 10) || null
        : null;

  const declaredRoleRaw = String(declarationObj.declaredRole || "").trim();
  const declaredRole = declaredRoleRaw.length > 0 ? declaredRoleRaw : null;

  return {
    reason,
    declaredAt,
    declaredBy,
    declaredRole,
  };
}

function mergeMissionFuelTracking(
  existingWorkflowData: unknown,
  patch: {
    noRefuelDeclaration?: MissionNoRefuelDeclaration | null;
    regularizationEntry?: Record<string, unknown> | null;
  },
): Record<string, unknown> {
  const workflowDataObj = asPlainObject(existingWorkflowData) ?? {};
  const fuelTrackingObj = asPlainObject(workflowDataObj.fuelTracking) ?? {};
  const nextFuelTracking: Record<string, unknown> = {
    ...fuelTrackingObj,
  };

  if (Object.prototype.hasOwnProperty.call(patch, "noRefuelDeclaration")) {
    nextFuelTracking.noRefuelDeclaration = patch.noRefuelDeclaration ?? null;
  }

  if (patch.regularizationEntry) {
    const existingRegularizations = Array.isArray(fuelTrackingObj.regularizations)
      ? fuelTrackingObj.regularizations.filter((entry) => Boolean(asPlainObject(entry)))
      : [];
    nextFuelTracking.regularizations = [
      patch.regularizationEntry,
      ...existingRegularizations,
    ];
  }

  nextFuelTracking.updatedAt = new Date().toISOString();

  return {
    ...workflowDataObj,
    fuelTracking: nextFuelTracking,
  };
}

type MissionExecutionDates = {
  actualStartDate: string | null;
  actualDeliveryDate: string | null;
};

function toIsoIfValid(value: unknown): string | null {
  if (!value) return null;
  const parsed = new Date(value as string | number | Date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function extractMissionExecutionDates(params: {
  workflowData: unknown;
  status: string | null | undefined;
  updatedAt: Date | string | null | undefined;
  completedAt: Date | string | null | undefined;
  assignmentStartedAt?: Date | string | null;
  assignmentCompletedAt?: Date | string | null;
}): MissionExecutionDates {
  const workflowDataObj = asPlainObject(params.workflowData);
  const executionObj = asPlainObject(workflowDataObj?.execution);

  const actualStartDate =
    toIsoIfValid(executionObj?.actualStartDate) ??
    toIsoIfValid(params.assignmentStartedAt) ??
    null;

  let actualDeliveryDate =
    toIsoIfValid(executionObj?.actualDeliveryDate) ??
    toIsoIfValid(params.assignmentCompletedAt) ??
    toIsoIfValid(params.completedAt) ??
    null;

  if (!actualDeliveryDate && (params.status === "delivered" || params.status === "completed")) {
    actualDeliveryDate = toIsoIfValid(params.updatedAt);
  }

  return {
    actualStartDate,
    actualDeliveryDate,
  };
}

function roundFcfa(value: number): number {
  return Math.max(0, Math.round(value));
}

function normalizeMissionType(missionType: string | null | undefined): "delivery" | "pickup" | "round_trip" | "other" {
  if (missionType === "delivery" || missionType === "pickup" || missionType === "round_trip") {
    return missionType;
  }
  return "other";
}

function estimateConsumptionL100({
  tonnage,
  missionType,
  loadRatio,
}: {
  tonnage: number | null;
  missionType: "delivery" | "pickup" | "round_trip" | "other";
  loadRatio: number;
}): number {
  const tonnageValue = tonnage ?? 0;
  let baseConsumption = 26;

  if (tonnageValue >= 20) baseConsumption = 33;
  else if (tonnageValue >= 15) baseConsumption = 30;
  else if (tonnageValue >= 10) baseConsumption = 26;
  else if (tonnageValue >= 5) baseConsumption = 22;
  else baseConsumption = 18;

  if (missionType === "round_trip") baseConsumption += 2;
  if (missionType === "pickup") baseConsumption += 1;

  if (loadRatio >= 0.85) baseConsumption += 3;
  else if (loadRatio >= 0.6) baseConsumption += 1.5;

  return Number(baseConsumption.toFixed(2));
}

function computeMissionBudgetSuggestion({
  missionType,
  estimatedDistance,
  pickupDate,
  weight,
  volume,
  vehicleTonnage,
  clientName,
  fuelUnitPrice,
}: {
  missionType: string | null | undefined;
  estimatedDistance: number | null;
  pickupDate: Date | string | null;
  weight: number | null;
  volume: number | null;
  vehicleTonnage: number | null;
  clientName: string | null;
  fuelUnitPrice: number;
}): MissionBudgetSuggestion {
  const safeDistance = Math.max(0, Number(estimatedDistance || 0));
  const missionKind = normalizeMissionType(missionType);
  const safeWeight = Math.max(0, Number(weight || 0));
  const safeVolume = Math.max(0, Number(volume || 0));
  const safeTonnage = vehicleTonnage && vehicleTonnage > 0 ? vehicleTonnage : null;
  const loadRatio = safeTonnage ? Math.min(1.5, safeWeight / safeTonnage) : 0;

  const consumptionL100 = estimateConsumptionL100({
    tonnage: safeTonnage,
    missionType: missionKind,
    loadRatio,
  });

  const plannedPickup = pickupDate ? new Date(pickupDate) : null;
  const now = new Date();
  const pickupDelayHours =
    plannedPickup && Number.isFinite(plannedPickup.getTime())
      ? Math.max(0, (now.getTime() - plannedPickup.getTime()) / (1000 * 60 * 60))
      : 0;

  const delayFactor = pickupDelayHours >= 24 ? 1.12 : pickupDelayHours >= 4 ? 1.06 : 1;
  const normalizedClientName = (clientName || "").toLowerCase();
  const clientFactor = /(port|douane|express|urgent)/i.test(normalizedClientName) ? 1.05 : 1;
  const loadFactor = loadRatio >= 0.85 ? 1.06 : loadRatio >= 0.6 ? 1.03 : 1;

  const litersEstimate = (safeDistance * consumptionL100) / 100;
  const baseFuelBudget = litersEstimate * fuelUnitPrice;
  const fuelBudget = roundFcfa(baseFuelBudget * delayFactor * clientFactor * loadFactor);

  const missionBaseFdrByType: Record<"delivery" | "pickup" | "round_trip" | "other", number> = {
    delivery: 18000,
    pickup: 14000,
    round_trip: 28000,
    other: 12000,
  };

  const distanceFdrRate = missionKind === "round_trip" ? 240 : 190;
  const weightComponent = safeWeight > 0 ? safeWeight * 250 : 0;
  const volumeComponent = safeVolume > 0 ? Math.min(20000, safeVolume * 120) : 0;
  const baseRoadExpenses =
    missionBaseFdrByType[missionKind] + safeDistance * distanceFdrRate + weightComponent + volumeComponent;
  const roadExpensesBudget = roundFcfa(baseRoadExpenses * delayFactor * clientFactor);

  let riskRate = 0.08;
  if (safeDistance >= 300) riskRate += 0.03;
  if (safeDistance >= 700) riskRate += 0.02;
  if (loadRatio >= 0.85) riskRate += 0.02;
  if (pickupDelayHours >= 8) riskRate += 0.02;
  if (clientFactor > 1) riskRate += 0.01;
  riskRate = Math.min(0.2, riskRate);

  const contingencyBudget = roundFcfa((fuelBudget + roadExpensesBudget) * riskRate);

  const hasVehicleContext = Boolean(safeTonnage && safeTonnage > 0);
  const hasDistanceContext = safeDistance > 0;
  const hasWeightContext = safeWeight > 0 || safeVolume > 0;
  const confidence: "low" | "medium" | "high" =
    hasVehicleContext && hasDistanceContext && hasWeightContext
      ? "high"
      : hasDistanceContext
        ? "medium"
        : "low";

  return {
    fuelBudget,
    roadExpensesBudget,
    contingencyBudget,
    confidence,
    assumptions: {
      distanceKm: safeDistance,
      consumptionL100,
      fuelUnitPrice,
      delayFactor: Number(delayFactor.toFixed(2)),
      clientFactor: Number(clientFactor.toFixed(2)),
      loadFactor: Number(loadFactor.toFixed(2)),
      riskRate: Number(riskRate.toFixed(3)),
    },
  };
}

function isDocumentTypeValid(
  documentType: VehicleDocumentRequirementType,
  docs: Array<{ expiryDate: Date | string | null }>,
): boolean {
  if (!docs.length) return false;

  if (documentType === "carte_grise") {
    return true;
  }

  return docs.some((doc) => !isDateExpired(doc.expiryDate));
}

function broadcastDocumentRenewalCreatedFromMission(
  request: Record<string, unknown>,
  actor: { userId: number | null; role: string | null },
  extraPayload: Record<string, unknown> = {},
): void {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }

  const requestId =
    typeof request.id === "number"
      ? request.id
      : Number.parseInt(String(request.id ?? ""), 10) || null;

  broadcastUpdate("document_renewal_request_created", {
    version: 1,
    entity: "document_renewal_request",
    entityId: requestId,
    payload: {
      request,
      ...extraPayload,
    },
    scope: { type: "broadcast" },
    actor: {
      userId: actor.userId,
      role: actor.role,
    },
    emittedAt: new Date().toISOString(),
  });
}

// GET /api/missions - Liste toutes les missions
router.get("/", async (req, res) => {
  try {
    // Chauffeur : seulement les missions où il est affecté (DRV2-3).
    const driverScope = await driverScopeOf(req.user);
    if (driverScope !== undefined && driverScope.length === 0) {
      return res.json([]);
    }
    const allMissions = await db
      .select({
        id: missions.id,
        clientId: missions.clientId,
        orderNumber: missions.orderNumber,
        missionType: missions.missionType,
        pickupAddress: missions.pickupAddress,
        pickupDate: missions.pickupDate,
        deliveryAddress: missions.deliveryAddress,
        deliveryDate: missions.deliveryDate,
        cargo: missions.cargo,
        weight: missions.weight,
        volume: missions.volume,
        estimatedDistance: missions.estimatedDistance,
        actualDistance: missions.actualDistance,
        estimatedFuelCost: missions.estimatedFuelCost,
        actualFuelCost: missions.actualFuelCost,
        actualFuelQuantity: missions.actualFuelQuantity,
        specialInstructions: missions.specialInstructions,
        status: missions.status,
        currentStep: missions.currentStep,
        podUrl: missions.podUrl,
        podUploadedAt: missions.podUploadedAt,
        validatedBy: missions.validatedBy,
        validatedAt: missions.validatedAt,
        workflowData: missions.workflowData,
        sessionId: missions.sessionId,
        createdBy: missions.createdBy,
        createdAt: missions.createdAt,
        updatedAt: missions.updatedAt,
        completedAt: missions.completedAt,
        cancelledAt: missions.cancelledAt,
        cancellationReason: missions.cancellationReason,
        client: {
          id: clients.id,
          name: clients.name,
        },
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .where(
        driverScope === undefined
          ? undefined
          : inArray(
              missions.id,
              db.select({ id: assignments.missionId }).from(assignments).where(inArray(assignments.driverId, driverScope)),
            ),
      )
      .orderBy(desc(missions.createdAt));

    // Get assignments for each mission
    const missionsWithAssignments = await Promise.all(
      allMissions.map(async (mission) => {
        const [assignment] = await db
          .select({
            id: assignments.id,
            missionId: assignments.missionId,
            vehicleId: assignments.vehicleId,
            driverId: assignments.driverId,
            status: assignments.status,
            startedAt: assignments.startedAt,
            completedAt: assignments.completedAt,
            vehicle: {
              id: vehicles.id,
              registrationNumber: vehicles.registrationNumber,
              brand: vehicles.brand,
              model: vehicles.model,
              tonnage: vehicles.tonnage,
              fuelType: vehicles.fuelType,
            },
            driver: {
              id: drivers.id,
              firstName: drivers.firstName,
              lastName: drivers.lastName,
              employeeNumber: drivers.employeeNumber,
              cpcStatus: drivers.cpcStatus,
            },
          })
          .from(assignments)
          .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
          .leftJoin(drivers, eq(assignments.driverId, drivers.id))
          .where(eq(assignments.missionId, mission.id))
          .limit(1);

        const executionDates = extractMissionExecutionDates({
          workflowData: mission.workflowData,
          status: mission.status,
          updatedAt: mission.updatedAt,
          completedAt: mission.completedAt,
          assignmentStartedAt: assignment?.startedAt,
          assignmentCompletedAt: assignment?.completedAt,
        });

        return {
          ...mission,
          ...executionDates,
          assignment: assignment || null,
        };
      })
    );

    return res.json(missionsWithAssignments);
  } catch (error) {
    console.error("Get missions error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/missions/:id - Détails d'une mission
router.get("/:id", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id);

    const [mission] = await db
      .select({
        id: missions.id,
        clientId: missions.clientId,
        orderNumber: missions.orderNumber,
        missionType: missions.missionType,
        pickupAddress: missions.pickupAddress,
        pickupDate: missions.pickupDate,
        deliveryAddress: missions.deliveryAddress,
        deliveryDate: missions.deliveryDate,
        cargo: missions.cargo,
        weight: missions.weight,
        volume: missions.volume,
        estimatedDistance: missions.estimatedDistance,
        actualDistance: missions.actualDistance,
        estimatedFuelCost: missions.estimatedFuelCost,
        actualFuelCost: missions.actualFuelCost,
        actualFuelQuantity: missions.actualFuelQuantity,
        specialInstructions: missions.specialInstructions,
        status: missions.status,
        currentStep: missions.currentStep,
        podUrl: missions.podUrl,
        podUploadedAt: missions.podUploadedAt,
        validatedBy: missions.validatedBy,
        validatedAt: missions.validatedAt,
        workflowData: missions.workflowData,
        sessionId: missions.sessionId,
        createdBy: missions.createdBy,
        createdAt: missions.createdAt,
        updatedAt: missions.updatedAt,
        completedAt: missions.completedAt,
        cancelledAt: missions.cancelledAt,
        cancellationReason: missions.cancellationReason,
        client: {
          id: clients.id,
          name: clients.name,
          contactPerson: clients.contactPerson,
          email: clients.email,
          phone: clients.phone,
        },
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .where(eq(missions.id, missionId));

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée" });
    }

    // Get assignment
    const [assignment] = await db
      .select({
        id: assignments.id,
        missionId: assignments.missionId,
        vehicleId: assignments.vehicleId,
        driverId: assignments.driverId,
        status: assignments.status,
        startedAt: assignments.startedAt,
        completedAt: assignments.completedAt,
        assignedAt: assignments.assignedAt,
        vehicle: {
          id: vehicles.id,
          registrationNumber: vehicles.registrationNumber,
          brand: vehicles.brand,
          model: vehicles.model,
          tonnage: vehicles.tonnage,
          fuelType: vehicles.fuelType,
          mileage: vehicles.mileage,
        },
        driver: {
          id: drivers.id,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
          employeeNumber: drivers.employeeNumber,
          // Pas de donnée personnelle ici (permis, CNI...) : le détail mission est lu par tout le
          // personnel. La fiche complète passe par /api/drivers/:id, qui applique la rédaction.
          cpcStatus: drivers.cpcStatus,
        },
      })
      .from(assignments)
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(eq(assignments.missionId, missionId))
      .limit(1);

    const executionDates = extractMissionExecutionDates({
      workflowData: mission.workflowData,
      status: mission.status,
      updatedAt: mission.updatedAt,
      completedAt: mission.completedAt,
      assignmentStartedAt: assignment?.startedAt,
      assignmentCompletedAt: assignment?.completedAt,
    });

    return res.json({
      ...mission,
      ...executionDates,
      assignment: assignment || null,
    });
  } catch (error) {
    console.error("Get mission error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/missions/:id/fuel-records - Historique carburant lié à la mission
router.get("/:id/fuel-records", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(missionId)) {
      return res.status(400).json({ message: "ID mission invalide." });
    }

    const [mission] = await db
      .select({
        id: missions.id,
        status: missions.status,
        estimatedFuelCost: missions.estimatedFuelCost,
        actualFuelCost: missions.actualFuelCost,
        actualFuelQuantity: missions.actualFuelQuantity,
        workflowData: missions.workflowData,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée." });
    }

    const fuelData = await fuelCardService.getFuelRecordsByMission(missionId);
    const estimatedBudget = Number(mission.estimatedFuelCost || 0);

    return res.status(200).json({
      missionId,
      missionStatus: mission.status,
      records: fuelData.records,
      totals: {
        totalQuantity: fuelData.totalQuantity,
        totalCost: fuelData.totalCost,
        estimatedBudget,
        budgetDelta: estimatedBudget > 0 ? fuelData.totalCost - estimatedBudget : 0,
        recordsCount: fuelData.records.length,
      },
      missionTotals: {
        actualFuelCost: Number(mission.actualFuelCost || 0),
        actualFuelQuantity: Number(mission.actualFuelQuantity || 0),
      },
      tracking: {
        noRefuelDeclaration: extractMissionNoRefuelDeclaration(mission.workflowData),
      },
    });
  } catch (error) {
    console.error("Get mission fuel records error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/missions/:id/fuel-records - Enregistrer un plein lié à une mission
router.post("/:id/fuel-records", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(missionId)) {
      return res.status(400).json({ message: "ID mission invalide." });
    }

    const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const actorRole = String(req.user?.role || "").trim().toLowerCase();

    if (!actorUserId) {
      return res.status(401).json({ message: "Session invalide. Veuillez vous reconnecter." });
    }

    const payloadSchema = z.object({
      vehicleId: z.coerce.number().int().positive(),
      quantity: z.coerce.number().positive(),
      unitPrice: z.coerce.number().positive(),
      date: z.string().trim().min(1).optional(),
      stationName: z.string().trim().min(1).optional(),
      notes: z.string().trim().optional(),
      isPreDeparture: z.coerce.boolean().optional().default(false),
    });

    const parsedPayload = payloadSchema.safeParse(req.body ?? {});
    if (!parsedPayload.success) {
      return res.status(400).json({
        message: "Payload invalide.",
        errors: parsedPayload.error.errors,
      });
    }

    const payload = parsedPayload.data;
    const parsedDate = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: "Date de plein invalide." });
    }

    const [mission] = await db
      .select({
        id: missions.id,
        status: missions.status,
        deliveryAddress: missions.deliveryAddress,
        clientName: clients.name,
        assignmentId: assignments.id,
        assignmentVehicleId: assignments.vehicleId,
        assignmentDriverId: assignments.driverId,
        assignmentDriverUserId: drivers.userId,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(assignments, eq(assignments.missionId, missions.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée." });
    }

    if (!MISSION_FUEL_ALLOWED_STATUSES.includes(mission.status as (typeof MISSION_FUEL_ALLOWED_STATUSES)[number])) {
      return res.status(400).json({
        message: `Enregistrement carburant impossible pour une mission ${mission.status}.`,
      });
    }

    if (!mission.assignmentId || !mission.assignmentVehicleId) {
      return res.status(400).json({ message: "Aucun véhicule affecté à cette mission." });
    }

    if (payload.vehicleId !== mission.assignmentVehicleId) {
      return res.status(400).json({
        message: "Le véhicule renseigné ne correspond pas au véhicule affecté à la mission.",
      });
    }

    if (actorRole === "driver") {
      if (!mission.assignmentDriverId || !mission.assignmentDriverUserId) {
        return res.status(403).json({ message: "Aucun chauffeur valide affecté à cette mission." });
      }

      if (mission.assignmentDriverUserId !== actorUserId) {
        return res.status(403).json({
          message: "Accès refusé: seul le chauffeur affecté peut enregistrer ce plein.",
        });
      }
    }

    const result = await fuelCardService.recordConsumption({
      vehicleId: payload.vehicleId,
      quantity: payload.quantity,
      unitPrice: payload.unitPrice,
      date: parsedDate.toISOString(),
      stationName: payload.stationName || "MISSION",
      destination: mission.deliveryAddress || "Mission",
      clientName: mission.clientName || undefined,
      notes: payload.notes,
      missionId,
      isPreDeparture: payload.isPreDeparture,
      userId: actorUserId,
    });

    const fuelData = await fuelCardService.getFuelRecordsByMission(missionId);
    const [updatedMission] = await db
      .select({
        id: missions.id,
        status: missions.status,
        actualFuelCost: missions.actualFuelCost,
        actualFuelQuantity: missions.actualFuelQuantity,
        updatedAt: missions.updatedAt,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (updatedMission) {
      broadcastMissionUpdate("mission_updated", updatedMission as unknown as Record<string, unknown>, {
        source: "mission_fuel_recorded",
      });
    }

    broadcastMissionFuelRecorded({
      missionId,
      fuelRecord: result.consumption as unknown as Record<string, unknown>,
      actorUserId,
      actorRole,
    });

    return res.status(201).json({
      record: result.consumption,
      totals: {
        totalQuantity: fuelData.totalQuantity,
        totalCost: fuelData.totalCost,
        recordsCount: fuelData.records.length,
      },
      mission: updatedMission || null,
    });
  } catch (error) {
    console.error("Create mission fuel record error:", error);

    if (error instanceof Error && (error as Error & { code?: string }).code === "INSUFFICIENT_BALANCE") {
      return res.status(422).json({
        message: error.message,
        code: "INSUFFICIENT_BALANCE",
      });
    }

    return res.status(500).json({
      message: error instanceof Error ? error.message : "Erreur serveur",
    });
  }
});

// POST /api/missions/:id/fuel-records/regularize - Régulariser un plein oublié après clôture/livraison
router.post("/:id/fuel-records/regularize", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(missionId)) {
      return res.status(400).json({ message: "ID mission invalide." });
    }

    const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const actorRole = String(req.user?.role || "").trim().toLowerCase();

    if (!actorUserId) {
      return res.status(401).json({ message: "Session invalide. Veuillez vous reconnecter." });
    }

    if (!isMissionFuelManagerRole(actorRole)) {
      return res.status(403).json({
        message: "Seuls admin, logistique ou secrétariat peuvent régulariser un plein mission.",
      });
    }

    const payloadSchema = z.object({
      vehicleId: z.coerce.number().int().positive(),
      quantity: z.coerce.number().positive(),
      unitPrice: z.coerce.number().positive(),
      date: z.string().trim().min(1).optional(),
      stationName: z.string().trim().min(1).optional(),
      notes: z.string().trim().optional(),
      regularizationReason: z.string().trim().min(8, "Le motif de régularisation est obligatoire."),
      isPreDeparture: z.coerce.boolean().optional().default(false),
    });

    const parsedPayload = payloadSchema.safeParse(req.body ?? {});
    if (!parsedPayload.success) {
      return res.status(400).json({
        message: "Payload invalide.",
        errors: parsedPayload.error.errors,
      });
    }

    const payload = parsedPayload.data;
    const parsedDate = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ message: "Date de plein invalide." });
    }

    const [mission] = await db
      .select({
        id: missions.id,
        status: missions.status,
        workflowData: missions.workflowData,
        deliveryAddress: missions.deliveryAddress,
        clientName: clients.name,
        assignmentId: assignments.id,
        assignmentVehicleId: assignments.vehicleId,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .leftJoin(assignments, eq(assignments.missionId, missions.id))
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée." });
    }

    if (
      !MISSION_FUEL_REGULARIZATION_ALLOWED_STATUSES.includes(
        mission.status as (typeof MISSION_FUEL_REGULARIZATION_ALLOWED_STATUSES)[number],
      )
    ) {
      return res.status(400).json({
        message: `Régularisation impossible pour une mission ${mission.status}.`,
      });
    }

    if (!mission.assignmentId || !mission.assignmentVehicleId) {
      return res.status(400).json({ message: "Aucun véhicule affecté à cette mission." });
    }

    if (payload.vehicleId !== mission.assignmentVehicleId) {
      return res.status(400).json({
        message: "Le véhicule renseigné ne correspond pas au véhicule affecté à la mission.",
      });
    }

    const regularizationNotePrefix = `[REGULARISATION] ${payload.regularizationReason}`;
    const mergedNotes = payload.notes?.trim()
      ? `${regularizationNotePrefix} | ${payload.notes.trim()}`
      : regularizationNotePrefix;

    const result = await fuelCardService.recordConsumption({
      vehicleId: payload.vehicleId,
      quantity: payload.quantity,
      unitPrice: payload.unitPrice,
      date: parsedDate.toISOString(),
      stationName: payload.stationName || "MISSION",
      destination: mission.deliveryAddress || "Mission",
      clientName: mission.clientName || undefined,
      notes: mergedNotes,
      missionId,
      isPreDeparture: payload.isPreDeparture,
      userId: actorUserId,
    });

    const regularizationEntry = {
      id: result.consumption?.id ?? null,
      reason: payload.regularizationReason,
      createdAt: new Date().toISOString(),
      createdBy: actorUserId,
      createdRole: actorRole || null,
      quantity: payload.quantity,
      unitPrice: payload.unitPrice,
      debitAmount: result.cost,
    };

    const nextWorkflowData = mergeMissionFuelTracking(mission.workflowData, {
      noRefuelDeclaration: null,
      regularizationEntry,
    });

    const [updatedMission] = await db
      .update(missions)
      .set({
        workflowData: nextWorkflowData,
        updatedAt: new Date(),
      })
      .where(eq(missions.id, missionId))
      .returning({
        id: missions.id,
        status: missions.status,
        actualFuelCost: missions.actualFuelCost,
        actualFuelQuantity: missions.actualFuelQuantity,
        workflowData: missions.workflowData,
        updatedAt: missions.updatedAt,
      });

    const fuelData = await fuelCardService.getFuelRecordsByMission(missionId);

    if (updatedMission) {
      broadcastMissionUpdate("mission_updated", updatedMission as unknown as Record<string, unknown>, {
        source: "mission_fuel_regularized",
      });
    }

    broadcastMissionFuelRecorded({
      missionId,
      fuelRecord: result.consumption as unknown as Record<string, unknown>,
      actorUserId,
      actorRole,
    });

    return res.status(201).json({
      record: result.consumption,
      totals: {
        totalQuantity: fuelData.totalQuantity,
        totalCost: fuelData.totalCost,
        recordsCount: fuelData.records.length,
      },
      mission: updatedMission || null,
      regularization: regularizationEntry,
    });
  } catch (error) {
    console.error("Regularize mission fuel record error:", error);

    if (error instanceof Error && (error as Error & { code?: string }).code === "INSUFFICIENT_BALANCE") {
      return res.status(422).json({
        message: error.message,
        code: "INSUFFICIENT_BALANCE",
      });
    }

    return res.status(500).json({
      message: error instanceof Error ? error.message : "Erreur serveur",
    });
  }
});

// POST /api/missions/:id/fuel-records/declare-no-refuel - Déclarer une mission terminée sans ravitaillement
router.post("/:id/fuel-records/declare-no-refuel", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(missionId)) {
      return res.status(400).json({ message: "ID mission invalide." });
    }

    const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const actorRole = String(req.user?.role || "").trim().toLowerCase();

    if (!actorUserId) {
      return res.status(401).json({ message: "Session invalide. Veuillez vous reconnecter." });
    }

    if (!isMissionFuelManagerRole(actorRole)) {
      return res.status(403).json({
        message: "Seuls admin, logistique ou secrétariat peuvent déclarer une mission sans ravitaillement.",
      });
    }

    const payloadSchema = z.object({
      reason: z.string().trim().min(8, "Le motif est obligatoire."),
    });

    const parsedPayload = payloadSchema.safeParse(req.body ?? {});
    if (!parsedPayload.success) {
      return res.status(400).json({
        message: "Payload invalide.",
        errors: parsedPayload.error.errors,
      });
    }

    const [mission] = await db
      .select({
        id: missions.id,
        status: missions.status,
        workflowData: missions.workflowData,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée." });
    }

    if (
      !MISSION_FUEL_DECLARATION_ALLOWED_STATUSES.includes(
        mission.status as (typeof MISSION_FUEL_DECLARATION_ALLOWED_STATUSES)[number],
      )
    ) {
      return res.status(400).json({
        message: `Déclaration impossible pour une mission ${mission.status}.`,
      });
    }

    const hasFuelRecords = await fuelCardService.hasFuelRecordsForMission(missionId);
    if (hasFuelRecords) {
      return res.status(409).json({
        message: "Cette mission contient déjà un ou plusieurs pleins. La déclaration sans ravitaillement est impossible.",
      });
    }

    const declaration: MissionNoRefuelDeclaration = {
      reason: parsedPayload.data.reason,
      declaredAt: new Date().toISOString(),
      declaredBy: actorUserId,
      declaredRole: actorRole || null,
    };

    const nextWorkflowData = mergeMissionFuelTracking(mission.workflowData, {
      noRefuelDeclaration: declaration,
    });

    const [updatedMission] = await db
      .update(missions)
      .set({
        workflowData: nextWorkflowData,
        updatedAt: new Date(),
      })
      .where(eq(missions.id, missionId))
      .returning({
        id: missions.id,
        status: missions.status,
        actualFuelCost: missions.actualFuelCost,
        actualFuelQuantity: missions.actualFuelQuantity,
        workflowData: missions.workflowData,
        updatedAt: missions.updatedAt,
      });

    if (updatedMission) {
      broadcastMissionUpdate("mission_updated", updatedMission as unknown as Record<string, unknown>, {
        source: "mission_no_refuel_declared",
      });
    }

    return res.status(200).json({
      mission: updatedMission || null,
      declaration,
    });
  } catch (error) {
    console.error("Declare mission no-refuel error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/missions/:id/launch-readiness - Checklist métier de lancement mission
router.get("/:id/launch-readiness", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (!Number.isInteger(missionId)) {
      return res.status(400).json({ message: "ID mission invalide." });
    }

    const [mission] = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        missionType: missions.missionType,
        status: missions.status,
        pickupDate: missions.pickupDate,
        deliveryDate: missions.deliveryDate,
        estimatedDistance: missions.estimatedDistance,
        weight: missions.weight,
        volume: missions.volume,
        estimatedFuelCost: missions.estimatedFuelCost,
        workflowData: missions.workflowData,
        clientName: clients.name,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée." });
    }

    const [missionAssignment] = await db
      .select({
        id: assignments.id,
        vehicleId: assignments.vehicleId,
        driverId: assignments.driverId,
        vehicleRegistration: vehicles.registrationNumber,
        vehicleStatus: vehicles.status,
        vehicleTonnage: vehicles.tonnage,
        vehicleFuelType: vehicles.fuelType,
        driverFirstName: drivers.firstName,
        driverLastName: drivers.lastName,
        driverIsActive: drivers.isActive,
        driverCpcStatus: drivers.cpcStatus,
        driverLicenseExpiry: drivers.licenseExpiry,
      })
      .from(assignments)
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(eq(assignments.missionId, missionId))
      .limit(1);

    const hasVehicle = Boolean(missionAssignment?.vehicleId);
    const hasDriver = Boolean(missionAssignment?.driverId);

    const docs = missionAssignment?.vehicleId
      ? await db
          .select({
            type: vehicleDocuments.type,
            expiryDate: vehicleDocuments.expiryDate,
          })
          .from(vehicleDocuments)
          .where(eq(vehicleDocuments.vehicleId, missionAssignment.vehicleId))
      : [];

    const docsByType = new Map<VehicleDocumentRequirementType, Array<{ expiryDate: Date | string | null }>>();
    for (const doc of docs) {
      if (!DOCUMENT_REQUESTABLE_TYPES.includes(doc.type as VehicleDocumentRequirementType)) continue;
      const typed = doc.type as VehicleDocumentRequirementType;
      const bucket = docsByType.get(typed) || [];
      bucket.push({ expiryDate: doc.expiryDate });
      docsByType.set(typed, bucket);
    }

    const carteGriseValid = hasVehicle && isDocumentTypeValid("carte_grise", docsByType.get("carte_grise") || []);
    const assuranceValid = hasVehicle && isDocumentTypeValid("assurance", docsByType.get("assurance") || []);
    const visiteTechniqueValid = hasVehicle && isDocumentTypeValid("visite_technique", docsByType.get("visite_technique") || []);
    const permisValid = hasDriver && Boolean(missionAssignment?.driverLicenseExpiry) && !isDateExpired(missionAssignment?.driverLicenseExpiry);
    const cpcValid = hasDriver && normalizeCpcStatus(missionAssignment?.driverCpcStatus) === "FORME";
    const driverActive = hasDriver && Boolean(missionAssignment?.driverIsActive);
    const vehicleOperational = hasVehicle && missionAssignment?.vehicleStatus === "operational";

    const missionBudgetPlan = extractMissionBudgetPlan(mission.workflowData, mission.estimatedFuelCost);
    const fuelBudgetValue = missionBudgetPlan.fuelBudget;
    const roadExpensesBudgetValue = missionBudgetPlan.roadExpensesBudget;
    const contingencyBudgetValue = missionBudgetPlan.contingencyBudget;

    const hasFuelBudget = fuelBudgetValue !== null && Number.isFinite(fuelBudgetValue) && fuelBudgetValue > 0;
    const hasRoadExpensesBudget =
      roadExpensesBudgetValue !== null &&
      Number.isFinite(roadExpensesBudgetValue) &&
      roadExpensesBudgetValue >= 0;
    const hasContingencyBudget =
      contingencyBudgetValue !== null &&
      Number.isFinite(contingencyBudgetValue) &&
      contingencyBudgetValue >= 0;

    let fuelBalanceValue = 0;
    let fuelBalanceUnavailable = false;
    const missionFuelFallbackPrice = await getFuelPriceAt();
    let fuelUnitPriceUsed = missionFuelFallbackPrice;
    let fuelUnitPriceReal: number | null = null;
    let fuelUnitPriceFallback = missionFuelFallbackPrice;
    let fuelUnitPriceSource: "real" | "fallback" = "fallback";
    try {
      const fuelBalance = await fuelCardService.getCurrentBalance();
      fuelBalanceValue = Number(fuelBalance?.balance || 0);

      const fallbackUnitPrice = Number(
        (fuelBalance as any)?.averagePricePerLiterFallback || missionFuelFallbackPrice,
      );
      if (Number.isFinite(fallbackUnitPrice) && fallbackUnitPrice > 0) {
        fuelUnitPriceFallback = Math.round(fallbackUnitPrice);
      }

      const realUnitPrice = Number((fuelBalance as any)?.averagePricePerLiterReal || 0);
      if (Number.isFinite(realUnitPrice) && realUnitPrice > 0) {
        fuelUnitPriceReal = Math.round(realUnitPrice);
      }

      const usedUnitPrice = Number(
        (fuelBalance as any)?.averagePricePerLiterUsed ||
          (fuelBalance as any)?.averagePricePerLiter ||
          fuelUnitPriceFallback,
      );
      if (Number.isFinite(usedUnitPrice) && usedUnitPrice > 0) {
        fuelUnitPriceUsed = Math.round(usedUnitPrice);
      }

      const source = String((fuelBalance as any)?.priceSource || "");
      fuelUnitPriceSource = source === "real" ? "real" : "fallback";
    } catch (fuelBalanceError) {
      fuelBalanceUnavailable = true;
      console.error("Mission launch-readiness fuel balance error:", fuelBalanceError);
    }

    const fuelOk = hasFuelBudget && !fuelBalanceUnavailable && fuelBalanceValue >= Number(fuelBudgetValue || 0);

    const missionBudgetSuggestion = computeMissionBudgetSuggestion({
      missionType: mission.missionType,
      estimatedDistance:
        mission.estimatedDistance !== null && mission.estimatedDistance !== undefined
          ? Number(mission.estimatedDistance)
          : null,
      pickupDate: mission.pickupDate,
      weight: mission.weight !== null && mission.weight !== undefined ? Number(mission.weight) : null,
      volume: mission.volume !== null && mission.volume !== undefined ? Number(mission.volume) : null,
      vehicleTonnage:
        missionAssignment?.vehicleTonnage !== null && missionAssignment?.vehicleTonnage !== undefined
          ? Number(missionAssignment.vehicleTonnage)
          : null,
      clientName: mission.clientName || null,
      fuelUnitPrice: fuelUnitPriceUsed,
    });

    let noPlanningConflict = true;
    if (
      missionAssignment?.vehicleId &&
      missionAssignment?.driverId &&
      mission.pickupDate &&
      mission.deliveryDate
    ) {
      const planningConflicts = await db
        .select({
          missionId: assignments.missionId,
          orderNumber: missions.orderNumber,
          pickupDate: missions.pickupDate,
          deliveryDate: missions.deliveryDate,
        })
        .from(assignments)
        .innerJoin(missions, eq(assignments.missionId, missions.id))
        .where(
          and(
            ne(assignments.missionId, mission.id),
            inArray(missions.status, ACTIVE_MISSION_STATUSES as any),
            or(
              eq(assignments.vehicleId, missionAssignment.vehicleId),
              eq(assignments.driverId, missionAssignment.driverId),
            ),
          ),
        );

      noPlanningConflict = !planningConflicts.some((candidate) =>
        overlaps(
          mission.pickupDate,
          mission.deliveryDate,
          candidate.pickupDate,
          candidate.deliveryDate,
        ),
      );
    }

    const checks = [
      {
        key: "vehicle_assigned",
        label: "Véhicule assigné",
        passed: hasVehicle,
        blocking: true,
        detail: hasVehicle ? "Véhicule affecté." : "Aucun véhicule assigné.",
      },
      {
        key: "driver_assigned",
        label: "Chauffeur assigné",
        passed: hasDriver,
        blocking: true,
        detail: hasDriver ? "Chauffeur affecté." : "Aucun chauffeur assigné.",
      },
      {
        key: "vehicle_operational",
        label: "Véhicule opérationnel",
        passed: vehicleOperational,
        blocking: true,
        detail: hasVehicle
          ? vehicleOperational
            ? "Véhicule en statut opérationnel."
            : `Statut véhicule: ${missionAssignment?.vehicleStatus || "inconnu"}.`
          : "Assignez d'abord un véhicule.",
      },
      {
        key: "driver_active",
        label: "Chauffeur actif",
        passed: driverActive,
        blocking: true,
        detail: hasDriver
          ? driverActive
            ? "Chauffeur actif."
            : "Chauffeur inactif."
          : "Assignez d'abord un chauffeur.",
      },
      {
        key: "driver_permit_valid",
        label: "Permis chauffeur valide",
        passed: permisValid,
        blocking: true,
        detail: hasDriver
          ? permisValid
            ? "Permis en cours de validité."
            : "Permis expiré ou non renseigné."
          : "Assignez d'abord un chauffeur.",
      },
      {
        key: "driver_cpc_valid",
        label: "CPC chauffeur valide",
        passed: cpcValid,
        blocking: true,
        detail: hasDriver
          ? cpcValid
            ? "CPC conforme."
            : `CPC non valide (${missionAssignment?.driverCpcStatus || "non défini"}).`
          : "Assignez d'abord un chauffeur.",
      },
      {
        key: "doc_carte_grise",
        label: "Carte grise conforme",
        passed: carteGriseValid,
        blocking: true,
        detail: carteGriseValid ? "Document présent." : "Carte grise manquante.",
      },
      {
        key: "doc_assurance",
        label: "Assurance conforme",
        passed: assuranceValid,
        blocking: true,
        detail: assuranceValid ? "Assurance valide." : "Assurance manquante ou expirée.",
      },
      {
        key: "doc_visite_technique",
        label: "Visite technique conforme",
        passed: visiteTechniqueValid,
        blocking: true,
        detail: visiteTechniqueValid ? "Visite technique valide." : "Visite technique manquante ou expirée.",
      },
      {
        key: "budget_fuel",
        label: "Budget carburant",
        passed: hasFuelBudget,
        blocking: true,
        detail: hasFuelBudget
          ? `${Math.round(Number(fuelBudgetValue || 0))} FCFA renseigné.`
          : "Budget carburant non renseigné.",
      },
      {
        key: "budget_road_expenses",
        label: "Budget frais de route (FDR)",
        passed: hasRoadExpensesBudget,
        blocking: true,
        detail: hasRoadExpensesBudget
          ? `${Math.round(Number(roadExpensesBudgetValue || 0))} FCFA renseigné.`
          : "Budget frais de route non renseigné.",
      },
      {
        key: "budget_contingency",
        label: "Budget imprévus",
        passed: hasContingencyBudget,
        blocking: true,
        detail: hasContingencyBudget
          ? `${Math.round(Number(contingencyBudgetValue || 0))} FCFA renseigné.`
          : "Budget imprévus non renseigné.",
      },
      {
        key: "fuel_balance",
        label: "Carburant disponible",
        passed: hasFuelBudget ? fuelOk : false,
        status: hasFuelBudget
          ? fuelBalanceUnavailable
            ? "failed"
            : fuelOk
              ? "passed"
              : "failed"
          : "warning",
        blocking: hasFuelBudget,
        detail: hasFuelBudget
          ? fuelBalanceUnavailable
            ? "Solde carte carburant indisponible pour contrôle. Réessayez."
            : fuelOk
              ? `Solde OK (${Math.round(fuelBalanceValue)} FCFA).`
              : `Solde insuffisant (${Math.round(fuelBalanceValue)} FCFA < ${Math.round(Number(fuelBudgetValue || 0))} FCFA).`
          : "Renseignez le budget carburant pour activer le contrôle de solde.",
      },
      {
        key: "planning_conflict",
        label: "Conflit planning",
        passed: noPlanningConflict,
        blocking: true,
        detail: noPlanningConflict
          ? "Aucun conflit détecté."
          : "Conflit détecté (chauffeur ou véhicule déjà planifié).",
      },
    ] as Array<{
      key: string;
      label: string;
      passed: boolean;
      blocking: boolean;
      detail: string;
      status?: "passed" | "warning" | "failed";
    }>;

    const openRenewalRequests = missionAssignment?.vehicleId
      ? await db
          .select({
            id: documentRenewalRequests.id,
            status: documentRenewalRequests.status,
            documentType: documentRenewalRequests.documentType,
            createdAt: documentRenewalRequests.createdAt,
          })
          .from(documentRenewalRequests)
          .where(
            and(
              eq(documentRenewalRequests.vehicleId, missionAssignment.vehicleId),
              inArray(documentRenewalRequests.status, OPEN_RENEWAL_STATUSES as any),
            ),
          )
          .orderBy(desc(documentRenewalRequests.createdAt))
      : [];

    const blockingFailures = checks.filter((check) => check.blocking && !check.passed);

    return res.status(200).json({
      missionId: mission.id,
      missionStatus: mission.status,
      canLaunch: blockingFailures.length === 0,
      summary: {
        total: checks.length,
        passed: checks.filter((check) => check.passed).length,
        failed: checks.filter((check) => !check.passed).length,
        warnings: checks.filter((check: any) => check.status === "warning").length,
      },
      checks,
      blockingFailures,
      fuel: {
        requiredBudget: hasFuelBudget ? Number(fuelBudgetValue || 0) : 0,
        balance: fuelBalanceValue,
        balanceUnavailable: fuelBalanceUnavailable,
        fuelUnitPriceUsed,
        fuelUnitPriceReal,
        fuelUnitPriceFallback,
        fuelUnitPriceSource,
      },
      budgets: {
        fuelBudget: fuelBudgetValue,
        roadExpensesBudget: roadExpensesBudgetValue,
        contingencyBudget: contingencyBudgetValue,
        totalBudget:
          (fuelBudgetValue || 0) +
          (roadExpensesBudgetValue || 0) +
          (contingencyBudgetValue || 0),
      },
      budgetSuggestion: missionBudgetSuggestion,
      openRenewalRequests,
    });
  } catch (error) {
    console.error("Get mission launch readiness error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/missions - Créer une nouvelle mission
router.post("/", async (req, res) => {
  try {
    // Le routeur est monté derrière authenticate: la session porte toujours
    // l'auteur réel. Plus de repli sur l'utilisateur 1, qui attribuait la
    // création à l'admin.
    const userId = req.session.userId;
    if (typeof userId !== "number") {
      return res.status(401).json({ message: "Non authentifié" });
    }
    const missionData = req.body;

    // Validate mission data
    const validatedData = insertMissionSchema.parse({
      ...missionData,
      createdBy: userId,
    });

    const hasAssignment =
      missionData.assignment &&
      missionData.assignment.vehicleId &&
      missionData.assignment.driverId;

    let assignmentVehicleId: number | null = null;
    let assignmentDriverId: number | null = null;

    if (hasAssignment) {
      assignmentVehicleId = Number(missionData.assignment.vehicleId);
      assignmentDriverId = Number(missionData.assignment.driverId);

      if (!Number.isInteger(assignmentVehicleId) || !Number.isInteger(assignmentDriverId)) {
        return res.status(400).json({
          message: "Affectation invalide (véhicule/chauffeur).",
        });
      }

      const [selectedVehicle] = await db
        .select({
          id: vehicles.id,
          registrationNumber: vehicles.registrationNumber,
          tonnage: vehicles.tonnage,
          status: vehicles.status,
          insuranceExpiry: vehicles.insuranceExpiry,
          technicalInspectionDate: vehicles.technicalInspectionDate,
          licensePlateExpiry: vehicles.licensePlateExpiry,
        })
        .from(vehicles)
        .where(and(eq(vehicles.id, assignmentVehicleId), isNull(vehicles.deletedAt)))
        .limit(1);

      // Un véhicule supprimé (deletedAt posé) est traité comme introuvable.
      if (!selectedVehicle) {
        return res.status(400).json({ message: "Véhicule introuvable pour l'affectation." });
      }

      // Le filtre de l'écran de création ne portait que sur `status`, et
      // seulement côté client: l'API acceptait n'importe quel véhicule, y
      // compris un camion à l'atelier ou sans assurance valide. Le refus vit
      // ici, et nomme chaque motif — « à l'atelier » et « plus d'assurance »
      // n'appellent pas la même action du logisticien.
      const eligibilite = getMissionEligibility(selectedVehicle);
      if (!eligibilite.eligible) {
        return res.status(400).json({
          message: formatEligibilityRefusal(
            selectedVehicle.registrationNumber,
            eligibilite.blockers,
          ),
          blockers: eligibilite.blockers,
        });
      }

      const [selectedDriver] = await db
        .select({
          id: drivers.id,
          firstName: drivers.firstName,
          lastName: drivers.lastName,
          cpcStatus: drivers.cpcStatus,
          isActive: drivers.isActive,
        })
        .from(drivers)
        .where(eq(drivers.id, assignmentDriverId))
        .limit(1);

      if (!selectedDriver) {
        return res.status(400).json({ message: "Chauffeur introuvable pour l'affectation." });
      }
      if (selectedDriver.isActive === false) {
        return res.status(400).json({ message: "Ce chauffeur est désactivé, il ne peut pas être affecté." });
      }

      const missionWeight =
        validatedData.weight !== null && validatedData.weight !== undefined
          ? Number(validatedData.weight)
          : null;
      const vehicleTonnage =
        selectedVehicle.tonnage !== null && selectedVehicle.tonnage !== undefined
          ? Number(selectedVehicle.tonnage)
          : null;

      if (
        missionWeight !== null &&
        !Number.isNaN(missionWeight) &&
        vehicleTonnage !== null &&
        !Number.isNaN(vehicleTonnage) &&
        missionWeight > vehicleTonnage
      ) {
        return res.status(400).json({
          message: `Charge incompatible: ${missionWeight}T > tonnage véhicule ${selectedVehicle.registrationNumber} (${vehicleTonnage}T).`,
        });
      }

      if ((selectedDriver.cpcStatus || "").toUpperCase() !== "FORMÉ") {
        return res.status(400).json({
          message: `CPC invalide pour ${selectedDriver.firstName} ${selectedDriver.lastName}: statut ${selectedDriver.cpcStatus || "non défini"}.`,
        });
      }
    }

    // Create mission
    const [newMission] = await db
      .insert(missions)
      .values(validatedData)
      .returning();

    // If assignment data is provided, create assignment
    if (assignmentVehicleId !== null && assignmentDriverId !== null) {
      const assignmentData = insertAssignmentSchema.parse({
        missionId: newMission.id,
        vehicleId: assignmentVehicleId,
        driverId: assignmentDriverId,
        status: "pending" as const,
      });
      
      await db.insert(assignments).values(assignmentData);
    }

    broadcastMissionUpdate("mission_created", newMission as unknown as Record<string, unknown>, {
      hasAssignment: assignmentVehicleId !== null && assignmentDriverId !== null,
    });

    return res.status(201).json(newMission);
  } catch (error) {
    console.error("Create mission error:", error);
    return res.status(500).json({ message: "Erreur lors de la création de la mission" });
  }
});

const updateMissionSchema = z.object({
  orderNumber: z.string().trim().min(1).optional(),
  missionType: z.enum(["delivery", "pickup", "round_trip", "other"]).optional(),
  pickupAddress: z.string().trim().min(1).optional(),
  pickupDate: z.string().optional().nullable(),
  deliveryAddress: z.string().trim().min(1).optional(),
  deliveryDate: z.string().optional().nullable(),
  cargoDescription: z.string().optional().nullable(),
  weight: z.union([z.string(), z.number()]).optional().nullable(),
  volume: z.union([z.string(), z.number()]).optional().nullable(),
  estimatedDistance: z.union([z.string(), z.number()]).optional().nullable(),
  estimatedFuelCost: z.union([z.string(), z.number()]).optional().nullable(),
  budget: z.object({
    fuelBudget: z.union([z.string(), z.number()]).optional().nullable(),
    roadExpensesBudget: z.union([z.string(), z.number()]).optional().nullable(),
    contingencyBudget: z.union([z.string(), z.number()]).optional().nullable(),
  }).optional().nullable(),
  specialInstructions: z.string().optional().nullable(),
  assignment: z.object({
    vehicleId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
    driverId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  }).optional().nullable(),
});

// PATCH /api/missions/:id - Mettre à jour les infos de mission
router.patch("/:id", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id);
    if (!Number.isInteger(missionId)) {
      return res.status(400).json({ message: "ID mission invalide." });
    }

    const payload = updateMissionSchema.parse(req.body || {});
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ message: "Aucune donnée à mettre à jour." });
    }

    const [existingMission] = await db
      .select({
        id: missions.id,
        status: missions.status,
        orderNumber: missions.orderNumber,
        weight: missions.weight,
        pickupDate: missions.pickupDate,
        deliveryDate: missions.deliveryDate,
        estimatedFuelCost: missions.estimatedFuelCost,
        workflowData: missions.workflowData,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!existingMission) {
      return res.status(404).json({ message: "Mission non trouvée" });
    }

    if (existingMission.status === "completed" || existingMission.status === "cancelled") {
      return res.status(400).json({
        message: `Mission ${existingMission.status === "completed" ? "terminée" : "annulée"}: édition bloquée.`,
      });
    }

    if (payload.orderNumber && payload.orderNumber !== existingMission.orderNumber) {
      const [duplicateOrder] = await db
        .select({ id: missions.id })
        .from(missions)
        .where(and(eq(missions.orderNumber, payload.orderNumber), ne(missions.id, missionId)))
        .limit(1);

      if (duplicateOrder) {
        return res.status(400).json({ message: "Ce N° commande / BL existe déjà." });
      }
    }

    const missionUpdates: Record<string, any> = {
      updatedAt: new Date(),
    };

    if (payload.orderNumber !== undefined) missionUpdates.orderNumber = payload.orderNumber;
    if (payload.missionType !== undefined) missionUpdates.missionType = payload.missionType;
    if (payload.pickupAddress !== undefined) missionUpdates.pickupAddress = payload.pickupAddress;
    if (payload.deliveryAddress !== undefined) missionUpdates.deliveryAddress = payload.deliveryAddress;
    if (payload.specialInstructions !== undefined) missionUpdates.specialInstructions = payload.specialInstructions || null;

    if (payload.pickupDate !== undefined) {
      missionUpdates.pickupDate = payload.pickupDate ? new Date(payload.pickupDate) : null;
    }
    if (payload.deliveryDate !== undefined) {
      missionUpdates.deliveryDate = payload.deliveryDate ? new Date(payload.deliveryDate) : null;
    }

    if (missionUpdates.pickupDate && missionUpdates.deliveryDate) {
      const pickupTs = new Date(missionUpdates.pickupDate).getTime();
      const deliveryTs = new Date(missionUpdates.deliveryDate).getTime();
      if (!Number.isNaN(pickupTs) && !Number.isNaN(deliveryTs) && pickupTs > deliveryTs) {
        return res.status(400).json({
          message: "Dates invalides: la date de départ doit être antérieure à la date de livraison.",
        });
      }
    }

    if (payload.weight !== undefined) {
      if (payload.weight === null || payload.weight === "") {
        missionUpdates.weight = null;
      } else {
        const n = Number(payload.weight);
        if (Number.isNaN(n) || n < 0) {
          return res.status(400).json({ message: "Poids mission invalide." });
        }
        missionUpdates.weight = String(n);
      }
    }

    if (payload.volume !== undefined) {
      if (payload.volume === null || payload.volume === "") {
        missionUpdates.volume = null;
      } else {
        const n = Number(payload.volume);
        if (Number.isNaN(n) || n < 0) {
          return res.status(400).json({ message: "Volume mission invalide." });
        }
        missionUpdates.volume = String(n);
      }
    }

    if (payload.estimatedDistance !== undefined) {
      if (payload.estimatedDistance === null || payload.estimatedDistance === "") {
        missionUpdates.estimatedDistance = null;
      } else {
        const n = Number(payload.estimatedDistance);
        if (!Number.isInteger(n) || n < 0) {
          return res.status(400).json({ message: "Distance estimée invalide." });
        }
        missionUpdates.estimatedDistance = n;
      }
    }

    const budgetPatch: MissionBudgetPatch = {};
    const hasBudgetPatchField = (field: keyof MissionBudgetPlan): boolean =>
      Object.prototype.hasOwnProperty.call(budgetPatch, field);

    const parseBudgetValue = (
      value: string | number | null | undefined,
      label: string,
    ): number | null => {
      if (value === null || value === undefined || value === "") {
        return null;
      }
      const numericValue = Number(value);
      if (Number.isNaN(numericValue) || numericValue < 0) {
        throw new Error(label);
      }
      return numericValue;
    };

    if (payload.estimatedFuelCost !== undefined) {
      try {
        budgetPatch.fuelBudget = parseBudgetValue(payload.estimatedFuelCost, "Budget carburant estimé invalide.");
      } catch {
        return res.status(400).json({ message: "Budget carburant estimé invalide." });
      }
    }

    if (payload.budget !== undefined) {
      if (payload.budget === null) {
        budgetPatch.fuelBudget = null;
        budgetPatch.roadExpensesBudget = null;
        budgetPatch.contingencyBudget = null;
      } else {
        if (Object.prototype.hasOwnProperty.call(payload.budget, "fuelBudget")) {
          try {
            budgetPatch.fuelBudget = parseBudgetValue(
              payload.budget.fuelBudget,
              "Budget carburant invalide.",
            );
          } catch {
            return res.status(400).json({ message: "Budget carburant invalide." });
          }
        }
        if (Object.prototype.hasOwnProperty.call(payload.budget, "roadExpensesBudget")) {
          try {
            budgetPatch.roadExpensesBudget = parseBudgetValue(
              payload.budget.roadExpensesBudget,
              "Budget frais de route invalide.",
            );
          } catch {
            return res.status(400).json({ message: "Budget frais de route invalide." });
          }
        }
        if (Object.prototype.hasOwnProperty.call(payload.budget, "contingencyBudget")) {
          try {
            budgetPatch.contingencyBudget = parseBudgetValue(
              payload.budget.contingencyBudget,
              "Budget imprévus invalide.",
            );
          } catch {
            return res.status(400).json({ message: "Budget imprévus invalide." });
          }
        }
      }
    }

    if (Object.keys(budgetPatch).length > 0) {
      missionUpdates.workflowData = mergeMissionBudgetPlan(existingMission.workflowData, budgetPatch);
    }

    if (hasBudgetPatchField("fuelBudget")) {
      const fuelBudget = budgetPatch.fuelBudget;
      missionUpdates.estimatedFuelCost =
        fuelBudget !== null && fuelBudget !== undefined && fuelBudget > 0
          ? String(fuelBudget)
          : null;
    }

    if (payload.cargoDescription !== undefined) {
      missionUpdates.cargo = payload.cargoDescription
        ? { description: payload.cargoDescription }
        : null;
    }

    const [existingAssignment] = await db
      .select({
        id: assignments.id,
        status: assignments.status,
      })
      .from(assignments)
      .where(eq(assignments.missionId, missionId))
      .limit(1);

    const assignmentProvided = Object.prototype.hasOwnProperty.call(payload, "assignment");
    if (assignmentProvided) {
      if (payload.assignment == null) {
        if (existingAssignment?.id) {
          await db.delete(assignments).where(eq(assignments.id, existingAssignment.id));
        }
        if (existingMission.status === "assigned") {
          missionUpdates.status = "planned";
        }
      } else {
        const assignmentPayload = payload.assignment;
        const { vehicleId, driverId } = assignmentPayload;
        if (!Number.isInteger(vehicleId) || vehicleId <= 0 || !Number.isInteger(driverId) || driverId <= 0) {
          return res.status(400).json({ message: "Affectation invalide (véhicule/chauffeur)." });
        }

        const [selectedVehicle] = await db
          .select({
            id: vehicles.id,
            registrationNumber: vehicles.registrationNumber,
            tonnage: vehicles.tonnage,
            status: vehicles.status,
            insuranceExpiry: vehicles.insuranceExpiry,
            technicalInspectionDate: vehicles.technicalInspectionDate,
            licensePlateExpiry: vehicles.licensePlateExpiry,
          })
          .from(vehicles)
          .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.deletedAt)))
          .limit(1);

        if (!selectedVehicle) {
          return res.status(400).json({ message: "Véhicule introuvable pour l'affectation." });
        }

        // Même règle que la création (POST /) : un véhicule à l'atelier ou en défaut
        // d'assurance, de visite technique ou de plaque ne s'affecte pas non plus par PATCH.
        const eligibilite = getMissionEligibility(selectedVehicle);
        if (!eligibilite.eligible) {
          return res.status(400).json({
            message: formatEligibilityRefusal(selectedVehicle.registrationNumber, eligibilite.blockers),
            blockers: eligibilite.blockers,
            errors: eligibilite.blockers.map((blocker) => ({
              field: "assignment.vehicleId",
              message: blocker.reason,
            })),
          });
        }

        const [selectedDriver] = await db
          .select({
            id: drivers.id,
            firstName: drivers.firstName,
            lastName: drivers.lastName,
            cpcStatus: drivers.cpcStatus,
            isActive: drivers.isActive,
          })
          .from(drivers)
          .where(eq(drivers.id, driverId))
          .limit(1);

        if (!selectedDriver) {
          return res.status(400).json({ message: "Chauffeur introuvable pour l'affectation." });
        }
        if (selectedDriver.isActive === false) {
          return res.status(400).json({ message: "Ce chauffeur est désactivé, il ne peut pas être affecté." });
        }

        const missionWeightRaw = missionUpdates.weight ?? existingMission.weight;
        const missionWeight = missionWeightRaw !== null && missionWeightRaw !== undefined ? Number(missionWeightRaw) : null;
        const vehicleTonnage = selectedVehicle.tonnage !== null && selectedVehicle.tonnage !== undefined ? Number(selectedVehicle.tonnage) : null;

        if (
          missionWeight !== null &&
          !Number.isNaN(missionWeight) &&
          vehicleTonnage !== null &&
          !Number.isNaN(vehicleTonnage) &&
          missionWeight > vehicleTonnage
        ) {
          return res.status(400).json({
            message: `Charge incompatible: ${missionWeight}T > tonnage véhicule ${selectedVehicle.registrationNumber} (${vehicleTonnage}T).`,
          });
        }

        if (normalizeCpcStatus(selectedDriver.cpcStatus) !== "FORME") {
          return res.status(400).json({
            message: `CPC invalide pour ${selectedDriver.firstName} ${selectedDriver.lastName}: statut ${selectedDriver.cpcStatus || "non défini"}.`,
          });
        }

        if (existingAssignment?.id) {
          await db
            .update(assignments)
            .set({
              vehicleId,
              driverId,
              status: existingAssignment.status === "in_progress" ? "in_progress" : "pending",
              updatedAt: new Date(),
            })
            .where(eq(assignments.id, existingAssignment.id));
        } else {
          await db.insert(assignments).values({
            missionId,
            vehicleId,
            driverId,
            status: "pending",
          });
        }

        if (existingMission.status === "planned") {
          missionUpdates.status = "assigned";
        }
      }
    }

    const [updatedMission] = await db
      .update(missions)
      .set(missionUpdates)
      .where(eq(missions.id, missionId))
      .returning();

    broadcastMissionUpdate("mission_updated", updatedMission as unknown as Record<string, unknown>, {
      source: "mission_edit",
    });

    return res.json(updatedMission);
  } catch (error) {
    console.error("Update mission error:", error);
    return res.status(500).json({ message: "Erreur lors de la mise à jour de la mission" });
  }
});

// PUT /api/missions/:id/status - Mettre à jour le statut d'une mission
router.put("/:id/status", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id);
    const { status, actualFdrCost: actualFdrCostBody } = req.body || {};
    const targetStatus = String(status || "").trim();

    if (!targetStatus) {
      return res.status(400).json({ message: "Le statut est requis" });
    }

    if (!Object.prototype.hasOwnProperty.call(MISSION_STATUS_TRANSITIONS, targetStatus)) {
      return res.status(400).json({ message: "Statut mission invalide." });
    }

    const [mission] = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        status: missions.status,
        pickupDate: missions.pickupDate,
        deliveryDate: missions.deliveryDate,
        estimatedFuelCost: missions.estimatedFuelCost,
        workflowData: missions.workflowData,
        currentStep: missions.currentStep,
      })
      .from(missions)
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée" });
    }

    const currentStatus = mission.status;
    if (targetStatus !== currentStatus) {
      const allowedTargets = MISSION_STATUS_TRANSITIONS[currentStatus] || [];
      if (!allowedTargets.includes(targetStatus)) {
        return res.status(400).json({
          message: `Transition non autorisée: ${currentStatus} -> ${targetStatus}.`,
        });
      }
    }

    const [missionAssignment] = await db
      .select({
        id: assignments.id,
        vehicleId: assignments.vehicleId,
        driverId: assignments.driverId,
        status: assignments.status,
        acceptedAt: assignments.acceptedAt,
        startedAt: assignments.startedAt,
        completedAt: assignments.completedAt,
        vehicleRegistration: vehicles.registrationNumber,
        vehicleStatus: vehicles.status,
        vehicleInsuranceExpiry: vehicles.insuranceExpiry,
        vehicleTechnicalInspectionDate: vehicles.technicalInspectionDate,
        vehicleLicensePlateExpiry: vehicles.licensePlateExpiry,
        driverFirstName: drivers.firstName,
        driverLastName: drivers.lastName,
        driverIsActive: drivers.isActive,
        driverCpcStatus: drivers.cpcStatus,
        driverLicenseExpiry: drivers.licenseExpiry,
      })
      .from(assignments)
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(eq(assignments.missionId, missionId))
      .limit(1);

    if (targetStatus === "assigned") {
      if (!missionAssignment?.vehicleId || !missionAssignment?.driverId) {
        return res.status(400).json({
          message: "Affectation requise: assignez d'abord un véhicule et un chauffeur.",
        });
      }
    }

    if (targetStatus === "in_progress") {
      const launchErrors: string[] = [];

      if (!missionAssignment?.vehicleId || !missionAssignment?.driverId) {
        launchErrors.push("Affectation incomplète (véhicule + chauffeur requis).");
      } else {
        if (missionAssignment.vehicleStatus !== "operational") {
          launchErrors.push(
            `Véhicule ${missionAssignment.vehicleRegistration || ""} non opérationnel (${missionAssignment.vehicleStatus}).`,
          );
        }

        if (!missionAssignment.driverIsActive) {
          launchErrors.push("Chauffeur inactif.");
        }

        if (normalizeCpcStatus(missionAssignment.driverCpcStatus) !== "FORME") {
          launchErrors.push(
            `CPC chauffeur non valide (${missionAssignment.driverCpcStatus || "non défini"}).`,
          );
        }

        if (missionAssignment.driverLicenseExpiry && isDateExpired(missionAssignment.driverLicenseExpiry)) {
          launchErrors.push("Permis chauffeur expiré.");
        }

        const docs = await db
          .select({
            type: vehicleDocuments.type,
            expiryDate: vehicleDocuments.expiryDate,
          })
          .from(vehicleDocuments)
          .where(eq(vehicleDocuments.vehicleId, missionAssignment.vehicleId));

        // Par type, la date d'expiration la plus lointaine : un ancien document
        // échu ne masque pas le renouvellement (même règle que vehicle-documentation-service).
        const docsByType = new Map<string, { expiryDate: Date | string | null }>();
        docs.forEach((doc) => {
          const known = docsByType.get(doc.type);
          const candidate = doc.expiryDate ? new Date(doc.expiryDate).getTime() : Number.NEGATIVE_INFINITY;
          const current = known?.expiryDate ? new Date(known.expiryDate).getTime() : Number.NEGATIVE_INFINITY;
          if (!known || candidate > current) {
            docsByType.set(doc.type, { expiryDate: doc.expiryDate });
          }
        });

        const carteGrise = docsByType.get("carte_grise");
        const assurance = docsByType.get("assurance");
        const visiteTechnique = docsByType.get("visite_technique");

        // Carte grise : sa présence ET son échéance (une date absente ne bloque pas,
        // comme dans getMissionEligibility).
        let carteGriseErreur = false;
        if (!carteGrise) {
          launchErrors.push("Carte grise manquante.");
        } else if (carteGrise.expiryDate && isExpiredOnOrBeforeToday(carteGrise.expiryDate)) {
          launchErrors.push("Carte grise expirée.");
          carteGriseErreur = true;
        }

        const assuranceErreur = !assurance || !assurance.expiryDate || isExpiredOnOrBeforeToday(assurance.expiryDate);
        if (assuranceErreur) {
          launchErrors.push("Assurance manquante ou expirée.");
        }

        const visiteErreur = !visiteTechnique || !visiteTechnique.expiryDate || isExpiredOnOrBeforeToday(visiteTechnique.expiryDate);
        if (visiteErreur) {
          launchErrors.push("Visite technique manquante ou expirée.");
        }

        // Règle unique d'éligibilité, la même qu'à l'affectation : couvre les
        // colonnes miroir de `vehicles` (assurance, visite, plaque). L'état
        // mécanique est déjà refusé plus haut ; on n'ajoute que les motifs de
        // conformité qui ne sont pas déjà énoncés.
        const eligibilite = getMissionEligibility({
          status: missionAssignment.vehicleStatus,
          insuranceExpiry: missionAssignment.vehicleInsuranceExpiry,
          technicalInspectionDate: missionAssignment.vehicleTechnicalInspectionDate,
          licensePlateExpiry: missionAssignment.vehicleLicensePlateExpiry,
        });
        for (const blocker of eligibilite.blockers) {
          if (blocker.kind !== "compliance") continue;
          if (blocker.code === "insurance" && assuranceErreur) continue;
          if (blocker.code === "technical_inspection" && visiteErreur) continue;
          if (blocker.code === "license_plate" && carteGriseErreur) continue;
          launchErrors.push(`${blocker.reason.charAt(0).toUpperCase()}${blocker.reason.slice(1)}.`);
        }

        if (mission.pickupDate && mission.deliveryDate) {
          const planningConflicts = await db
            .select({
              missionId: assignments.missionId,
              orderNumber: missions.orderNumber,
              pickupDate: missions.pickupDate,
              deliveryDate: missions.deliveryDate,
              vehicleId: assignments.vehicleId,
              driverId: assignments.driverId,
            })
            .from(assignments)
            .innerJoin(missions, eq(assignments.missionId, missions.id))
            .where(
              and(
                ne(assignments.missionId, mission.id),
                inArray(missions.status, ACTIVE_MISSION_STATUSES as any),
                or(
                  eq(assignments.vehicleId, missionAssignment.vehicleId),
                  eq(assignments.driverId, missionAssignment.driverId),
                ),
              ),
            );

          const hasOverlap = planningConflicts.some((candidate) =>
            overlaps(
              mission.pickupDate,
              mission.deliveryDate,
              candidate.pickupDate,
              candidate.deliveryDate,
            ),
          );

          if (hasOverlap) {
            launchErrors.push("Conflit planning détecté sur ce véhicule ou ce chauffeur.");
          }
        }

        const missionBudgetPlan = extractMissionBudgetPlan(mission.workflowData, mission.estimatedFuelCost);
        const fuelBudget = missionBudgetPlan.fuelBudget;
        const roadExpensesBudget = missionBudgetPlan.roadExpensesBudget;
        const contingencyBudget = missionBudgetPlan.contingencyBudget;

        if (fuelBudget === null || !Number.isFinite(fuelBudget) || fuelBudget <= 0) {
          launchErrors.push("Budget carburant non renseigné.");
        } else {
          const fuelBalance = await fuelCardService.getCurrentBalance();
          if (fuelBalance.balance < fuelBudget) {
            launchErrors.push(
              `Solde carte carburant insuffisant (${Math.round(fuelBalance.balance)} FCFA < ${Math.round(fuelBudget)} FCFA).`,
            );
          }
        }

        if (roadExpensesBudget === null || !Number.isFinite(roadExpensesBudget) || roadExpensesBudget < 0) {
          launchErrors.push("Budget frais de route (FDR) non renseigné.");
        }

        if (contingencyBudget === null || !Number.isFinite(contingencyBudget) || contingencyBudget < 0) {
          launchErrors.push("Budget imprévus non renseigné.");
        }
      }

      if (launchErrors.length > 0) {
        return res.status(400).json({
          // Les motifs vont dans le message : le gestionnaire central réduit
          // un `details` de chaînes à « Ce champ n'est pas valide. ».
          message: `Impossible de lancer la mission : ${launchErrors.join(" ")}`,
          errors: launchErrors.map((motif) => ({ field: "status", message: motif })),
        });
      }
    }

    const now = new Date();
    const workflowDataForStatus = asPlainObject(mission.workflowData) ?? {};
    const executionData = asPlainObject(workflowDataForStatus.execution) ?? {};
    let hasExecutionDataPatch = false;

    if (targetStatus === "in_progress" && !toIsoIfValid(executionData.actualStartDate)) {
      executionData.actualStartDate = now.toISOString();
      hasExecutionDataPatch = true;
    }

    if ((targetStatus === "delivered" || targetStatus === "completed") && !toIsoIfValid(executionData.actualDeliveryDate)) {
      executionData.actualDeliveryDate = now.toISOString();
      hasExecutionDataPatch = true;
    }

    if (hasExecutionDataPatch) {
      workflowDataForStatus.execution = executionData;
    }

    let nextWorkflowData: Record<string, unknown> = workflowDataForStatus;
    let hasWorkflowDataPatch = hasExecutionDataPatch;

    if (targetStatus === "completed") {
      let actualFdrCost: number | null = null;

      if (actualFdrCostBody !== undefined && actualFdrCostBody !== null && actualFdrCostBody !== "") {
        actualFdrCost = parseBudgetNumber(actualFdrCostBody);
        if (actualFdrCost === null || actualFdrCost < 0) {
          return res.status(400).json({
            message: "FDR réels invalides. Saisissez un montant HT ≥ 0 (0 si aucun frais de route).",
          });
        }
      } else {
        actualFdrCost = extractMissionActualRoadExpensesHT(mission.workflowData);
        if (actualFdrCost === null) {
          return res.status(400).json({
            message:
              "FDR réels obligatoires à la clôture. Saisissez le montant HT réel des frais de route (0 si aucun).",
          });
        }
      }

      nextWorkflowData = mergeMissionActualFdrCost(nextWorkflowData, actualFdrCost);
      hasWorkflowDataPatch = true;
    }

    const [updatedMission] = await db
      .update(missions)
      .set({
        status: targetStatus as any,
        updatedAt: now,
        currentStep: targetStatus === "in_progress"
          ? Math.max(Number(mission.currentStep || 1), 3)
          : mission.currentStep,
        completedAt: targetStatus === "completed" ? now : undefined,
        cancelledAt: targetStatus === "cancelled" ? now : undefined,
        workflowData: hasWorkflowDataPatch ? nextWorkflowData : mission.workflowData,
      })
      .where(eq(missions.id, missionId))
      .returning();

    if (missionAssignment?.id) {
      const assignmentUpdate: Record<string, any> = {
        updatedAt: now,
      };

      if (targetStatus === "assigned") {
        assignmentUpdate.status = "accepted";
        assignmentUpdate.acceptedAt = missionAssignment.acceptedAt || new Date();
      }

      if (targetStatus === "in_progress") {
        assignmentUpdate.status = "in_progress";
        assignmentUpdate.acceptedAt = missionAssignment.acceptedAt || now;
        assignmentUpdate.startedAt = missionAssignment.startedAt || now;
      }

      if (targetStatus === "delivered") {
        assignmentUpdate.status = "completed";
        assignmentUpdate.acceptedAt = missionAssignment.acceptedAt || now;
        assignmentUpdate.startedAt = missionAssignment.startedAt || now;
        assignmentUpdate.completedAt = missionAssignment.completedAt || now;
      }

      if (targetStatus === "completed") {
        assignmentUpdate.status = "completed";
        assignmentUpdate.completedAt = missionAssignment.completedAt || now;
      }

      if (targetStatus === "cancelled") {
        assignmentUpdate.status = "cancelled";
      }

      if (Object.keys(assignmentUpdate).length > 1) {
        await db
          .update(assignments)
          .set(assignmentUpdate)
          .where(eq(assignments.id, missionAssignment.id));
      }
    }

    broadcastMissionUpdate(
      targetStatus === "completed" ? "mission_completed" : "mission_status_changed",
      {
        ...(updatedMission as unknown as Record<string, unknown>),
        ...extractMissionExecutionDates({
          workflowData: (updatedMission as any)?.workflowData,
          status: (updatedMission as any)?.status,
          updatedAt: (updatedMission as any)?.updatedAt,
          completedAt: (updatedMission as any)?.completedAt,
          assignmentStartedAt: targetStatus === "in_progress" ? (missionAssignment?.startedAt || now) : missionAssignment?.startedAt,
          assignmentCompletedAt:
            targetStatus === "delivered" || targetStatus === "completed"
              ? (missionAssignment?.completedAt || now)
              : missionAssignment?.completedAt,
        }),
      },
      {
        source: "mission_status_update",
        previousStatus: currentStatus,
        nextStatus: targetStatus,
      },
    );

    const noFuelRecordsWarning = targetStatus === "completed"
      ? !(await fuelCardService.hasFuelRecordsForMission(missionId))
      : false;

    const warnings =
      targetStatus === "completed"
        ? (() => {
            const noRefuelDeclaration = extractMissionNoRefuelDeclaration((updatedMission as any)?.workflowData);
            if (noRefuelDeclaration || !noFuelRecordsWarning) return [];
            return ["no_fuel_records"];
          })()
        : [];

    return res.json({
      ...updatedMission,
      ...extractMissionExecutionDates({
        workflowData: (updatedMission as any)?.workflowData,
        status: (updatedMission as any)?.status,
        updatedAt: (updatedMission as any)?.updatedAt,
        completedAt: (updatedMission as any)?.completedAt,
        assignmentStartedAt:
          targetStatus === "in_progress"
            ? (missionAssignment?.startedAt || now)
            : missionAssignment?.startedAt,
        assignmentCompletedAt:
          targetStatus === "delivered" || targetStatus === "completed"
            ? (missionAssignment?.completedAt || now)
            : missionAssignment?.completedAt,
      }),
      warnings,
    });
  } catch (error) {
    console.error("Update mission status error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/missions/:id/document-renewal-requests - Lister les demandes documentaires ouvertes pour cette mission
router.get("/:id/document-renewal-requests", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (Number.isNaN(missionId)) {
      return res.status(400).json({ message: "ID mission invalide." });
    }

    // Fetch mission + vehicle to scope requests
    const [mission] = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        vehicleId: assignments.vehicleId,
      })
      .from(missions)
      .leftJoin(assignments, eq(assignments.missionId, missions.id))
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée." });
    }

    // Priority 1: true workflow requests (pending/in_progress) if they exist
    if (mission.vehicleId) {
      const openRequests = await db
        .select({
          id: documentRenewalRequests.id,
          status: documentRenewalRequests.status,
          documentType: documentRenewalRequests.documentType,
          createdAt: documentRenewalRequests.createdAt,
          comment: documentRenewalRequests.comment,
        })
        .from(documentRenewalRequests)
        .where(
          and(
            eq(documentRenewalRequests.vehicleId, mission.vehicleId),
            inArray(documentRenewalRequests.status, OPEN_RENEWAL_STATUSES as any),
          ),
        )
        .orderBy(desc(documentRenewalRequests.createdAt));

      if (openRequests.length > 0) {
        const payload = openRequests.map((request) => {
          const typedDocument = request.documentType as VehicleDocumentRequirementType;
          return {
            id: request.id,
            title: DOCUMENT_ALERT_TITLES[typedDocument] || "Renouvellement document",
            message: request.comment || "Demande documentaire en cours de traitement.",
            status: request.status,
            documentType: typedDocument,
            createdAt: request.createdAt,
            source: "workflow_request",
          };
        });

        return res.status(200).json(payload);
      }
    }

    // Legacy fallback: historical alert-based workflow, but only for documents still invalid
    const orderNum = String(mission.orderNumber || "");
    if (!orderNum || !mission.vehicleId) {
      return res.status(200).json([]);
    }

    const docs = await db
      .select({
        type: vehicleDocuments.type,
        expiryDate: vehicleDocuments.expiryDate,
      })
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.vehicleId, mission.vehicleId));

    const docsByType = new Map<VehicleDocumentRequirementType, Array<{ expiryDate: Date | string | null }>>();
    for (const doc of docs) {
      if (!DOCUMENT_REQUESTABLE_TYPES.includes(doc.type as VehicleDocumentRequirementType)) continue;
      const typedType = doc.type as VehicleDocumentRequirementType;
      const bucket = docsByType.get(typedType) || [];
      bucket.push({ expiryDate: doc.expiryDate });
      docsByType.set(typedType, bucket);
    }

    const invalidDocTypes = DOCUMENT_REQUESTABLE_TYPES.filter((docType) => {
      const typedDocs = docsByType.get(docType) || [];
      return !isDocumentTypeValid(docType, typedDocs);
    });

    if (invalidDocTypes.length === 0) {
      return res.status(200).json([]);
    }

    const renewalTitles = Object.values(DOCUMENT_ALERT_TITLES);
    const matchingAlerts = await db
      .select({
        id: alerts.id,
        title: alerts.title,
        message: alerts.message,
        createdAt: alerts.createdAt,
      })
      .from(alerts)
      .where(
        and(
          inArray(alerts.title, renewalTitles),
          ilike(alerts.message, `%${orderNum}%`),
        ),
      )
      .orderBy(alerts.createdAt);

    const seen = new Set<string>();
    const legacyOpen = matchingAlerts
      .filter((alert) => {
        if (seen.has(alert.title)) return false;
        seen.add(alert.title);
        const relatedType = ALERT_TITLE_TO_DOCUMENT_TYPE[alert.title];
        if (!relatedType) return true;
        return invalidDocTypes.includes(relatedType);
      })
      .map((alert) => ({
        id: alert.id,
        title: alert.title,
        message: alert.message,
        status: "pending",
        documentType: ALERT_TITLE_TO_DOCUMENT_TYPE[alert.title] || "autre",
        createdAt: alert.createdAt,
        source: "legacy_alert",
      }));

    return res.status(200).json(legacyOpen);
  } catch (error) {
    console.error("Get mission document renewal requests error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/missions/:id/document-renewal-requests - Créer des demandes documentaires depuis un blocage mission
router.post("/:id/document-renewal-requests", async (req, res) => {
  try {
    const missionId = parseInt(req.params.id, 10);
    if (Number.isNaN(missionId)) {
      return res.status(400).json({ message: "ID mission invalide." });
    }

    const actorId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const actorRole = String(req.user?.role || "").trim().toLowerCase();
    const allowedRequesterRoles = new Set(["admin", "logistics", "workshop_manager", "secretary"]);

    if (!actorId) {
      return res.status(401).json({ message: "Session invalide. Veuillez vous reconnecter." });
    }

    if (!allowedRequesterRoles.has(actorRole)) {
      return res.status(403).json({
        message: "Accès refusé: seuls Admin, Secrétaire, Logisticien et Chef d'atelier peuvent créer cette demande.",
      });
    }

    const payloadSchema = z.object({
      documentTypes: z.array(z.enum(["carte_grise", "assurance", "visite_technique"])).optional().default([]),
      note: z.string().optional(),
    });

    const parsedPayload = payloadSchema.safeParse(req.body ?? {});
    if (!parsedPayload.success) {
      return res.status(400).json({
        message: "Payload invalide.",
        errors: parsedPayload.error.errors,
      });
    }

    const [mission] = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        assignmentId: assignments.id,
        vehicleId: assignments.vehicleId,
        vehicleRegistration: vehicles.registrationNumber,
      })
      .from(missions)
      .leftJoin(assignments, eq(assignments.missionId, missions.id))
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée." });
    }

    if (!mission.vehicleId) {
      return res.status(400).json({ message: "Aucun véhicule affecté à cette mission." });
    }

    const docs = await db
      .select({
        id: vehicleDocuments.id,
        type: vehicleDocuments.type,
        expiryDate: vehicleDocuments.expiryDate,
        updatedAt: vehicleDocuments.updatedAt,
      })
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.vehicleId, mission.vehicleId))
      .orderBy(desc(vehicleDocuments.updatedAt), desc(vehicleDocuments.id));

    const docsByType = new Map<VehicleDocumentRequirementType, Array<{ id: number; expiryDate: Date | string | null }>>();
    const latestDocByType = new Map<VehicleDocumentRequirementType, { id: number; expiryDate: Date | string | null }>();
    for (const doc of docs) {
      if (!DOCUMENT_REQUESTABLE_TYPES.includes(doc.type as VehicleDocumentRequirementType)) continue;
      const typedDocType = doc.type as VehicleDocumentRequirementType;
      const bucket = docsByType.get(typedDocType) || [];
      bucket.push({ id: doc.id, expiryDate: doc.expiryDate });
      docsByType.set(typedDocType, bucket);
      if (!latestDocByType.has(typedDocType)) {
        latestDocByType.set(typedDocType, {
          id: doc.id,
          expiryDate: doc.expiryDate,
        });
      }
    }

    const invalidDocTypes = DOCUMENT_REQUESTABLE_TYPES.filter((docType) => {
      const typedDocs = docsByType.get(docType) || [];
      return !isDocumentTypeValid(docType, typedDocs);
    });

    const requestedDocTypes = parsedPayload.data.documentTypes as VehicleDocumentRequirementType[];
    const targetDocTypes = (requestedDocTypes.length > 0 ? requestedDocTypes : invalidDocTypes)
      .filter((docType, index, arr) => arr.indexOf(docType) === index)
      .filter((docType) => invalidDocTypes.includes(docType));

    if (targetDocTypes.length === 0) {
      return res.status(200).json({
        message: "Aucune demande créée: les documents ciblés sont déjà conformes.",
        workflow: { open: "À traiter", done: "Traitée" },
        createdCount: 0,
        created: [],
      });
    }

    const recipients = [
      ...(await storage.getUsersByRole("admin")),
      ...(await storage.getUsersByRole("secretary")),
    ];

    // Inclure le demandeur pour confirmation immédiate dans sa cloche.
    const recipientIds = Array.from(
      new Set([
        ...recipients.map((recipient) => recipient.id),
        actorId,
      ]),
    );
    if (recipientIds.length === 0) {
      return res.status(409).json({
        message: "Aucun destinataire disponible (Admin/Secrétaire).",
      });
    }

    const requestLink = `/vehicles/${mission.vehicleId}`;
    const created: Array<{
      documentType: VehicleDocumentRequirementType;
      label: string;
      recipientId: number;
      alertId: number;
    }> = [];
    const createdRenewalRequests: Array<{
      id: number;
      documentType: VehicleDocumentRequirementType;
      status: string;
      vehicleId: number;
      vehicleDocumentId: number;
      createdAt: Date;
    }> = [];

    for (const documentType of targetDocTypes) {
      const documentLabel = DOCUMENT_LABELS[documentType];
      const alertTitle = DOCUMENT_ALERT_TITLES[documentType];
      const noteSuffix = parsedPayload.data.note?.trim() ? ` Note: ${parsedPayload.data.note.trim()}` : "";
      const message = `${documentLabel} à renouveler pour mission ${mission.orderNumber} (${mission.vehicleRegistration || "véhicule"}). Statut: À traiter.${noteSuffix}`;

      const latestDocument = latestDocByType.get(documentType);
      if (latestDocument) {
        const [existingOpenRequest] = await db
          .select({
            id: documentRenewalRequests.id,
          })
          .from(documentRenewalRequests)
          .where(
            and(
              eq(documentRenewalRequests.vehicleId, mission.vehicleId),
              eq(documentRenewalRequests.vehicleDocumentId, latestDocument.id),
              inArray(documentRenewalRequests.status, OPEN_RENEWAL_STATUSES as any),
            ),
          )
          .limit(1);

        if (!existingOpenRequest) {
          const [newRenewalRequest] = await db
            .insert(documentRenewalRequests)
            .values({
              vehicleId: mission.vehicleId,
              vehicleDocumentId: latestDocument.id,
              documentType,
              status: "pending",
              requestedBy: actorId,
              assignedRole: "secretary",
              comment: `Demande créée depuis mission ${mission.orderNumber}.`,
              source: "mission_launch_blocked",
            })
            .returning({
              id: documentRenewalRequests.id,
              documentType: documentRenewalRequests.documentType,
              status: documentRenewalRequests.status,
              vehicleId: documentRenewalRequests.vehicleId,
              vehicleDocumentId: documentRenewalRequests.vehicleDocumentId,
              createdAt: documentRenewalRequests.createdAt,
            });

          createdRenewalRequests.push({
            id: newRenewalRequest.id,
            documentType: newRenewalRequest.documentType as VehicleDocumentRequirementType,
            status: newRenewalRequest.status,
            vehicleId: newRenewalRequest.vehicleId,
            vehicleDocumentId: newRenewalRequest.vehicleDocumentId,
            createdAt: newRenewalRequest.createdAt,
          });
        }
      }

      for (const recipientId of recipientIds) {
        const unreadAlerts = await storage.getUnreadAlertsByUserId(recipientId);
        const duplicate = unreadAlerts.some((alert) => {
          const sameTitle = alert.title === alertTitle;
          const sameLink = (alert.link || "") === requestLink;
          const sameMission = alert.message.includes(String(mission.orderNumber || ""));
          return sameTitle && sameLink && sameMission;
        });

        if (duplicate) {
          continue;
        }

        const alert = await storage.createAlert({
          userId: recipientId,
          title: alertTitle,
          message,
          type: "maintenance",
          priority: "high",
          link: requestLink,
        });

        broadcastAlertCreated({
          id: alert.id,
          userId: alert.userId ?? null,
          title: alert.title,
          type: alert.type,
          priority: alert.priority,
          link: alert.link ?? null,
          message: alert.message,
        });

        created.push({
          documentType,
          label: documentLabel,
          recipientId,
          alertId: alert.id,
        });
      }
    }

    broadcastMissionUpdate("mission_updated", mission as unknown as Record<string, unknown>, {
      source: "mission_document_renewal_request",
      missionId: mission.id,
      requestedDocumentTypes: targetDocTypes,
      requestCount: created.length,
    });

    for (const createdRequest of createdRenewalRequests) {
      broadcastDocumentRenewalCreatedFromMission(
        createdRequest as unknown as Record<string, unknown>,
        { userId: actorId, role: actorRole },
        {
          missionId: mission.id,
          source: "mission_document_renewal_request",
        },
      );
    }

    return res.status(201).json({
      message:
        created.length > 0
          ? "Demande de renouvellement créée."
          : "Demande déjà existante pour ces documents.",
      workflow: { open: "À traiter", done: "Traitée" },
      createdCount: created.length,
      createdRequestCount: createdRenewalRequests.length,
      created,
      targetDocumentTypes: targetDocTypes,
    });
  } catch (error) {
    console.error("Create mission document renewal request error:", error);
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

export default router;
