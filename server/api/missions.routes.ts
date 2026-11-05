import { getFuelPriceAt } from "../services/fuel-price-service";
import { onMissionStatusChange, resolveLaunchBudget } from "../services/mission-budgets-service";
import { resolveFuelUnitPrice } from "../lib/fuel-unit-price";
import { Router } from "express";
import { db } from "../db";
import { missions, clients, assignments, drivers, vehicles, vehicleDocuments, alerts, documentRenewalRequests, fuelRecords, tariffGrid } from "@shared/schema";
import { eq, and, asc, desc, inArray, ne, notInArray, or, ilike, isNull } from "drizzle-orm";
import { insertMissionSchema, insertAssignmentSchema } from "@shared/schema";
import { FuelCardService, toFuelCardAppError } from "../services/fuel-card-service";
import { storage } from "../storage";
import { z } from "zod";
import {
  getMissionEligibility,
  formatEligibilityRefusal,
  isRenewalReceiptValid,
} from "@shared/constants/vehicle-eligibility";
import { loadOpenRenewalReceipts } from "../lib/renewal-receipts";
import {
  extractMissionActualRoadExpensesHT,
  mergeMissionActualFdrCost,
} from "@shared/constants/management-mission-profitability";
import { isDriverLicenseExpiredOn, isExpiredOn, toExpiryDateOnly, todayUtcDateOnly } from "@shared/constants/expiry-day";
import { AppError } from "../lib/app-error";
import { MISSION_ID_INVALID_MESSAGE, parseRouteId } from "../lib/route-id";
import { assertValidDbId } from "../lib/work-order-scope";
import { assertPlanningStateUnchanged, findPlanningClash, launchRefusalMessage, lockPlanningPairs, lockPlanningResources, planningClashMessage, planningStateKey } from "../services/mission-planning";
import { ACTIVE_ASSIGNMENT_STATUSES, VOID_ASSIGNMENT_STATUSES, isActiveAssignmentStatus, isVoidAssignmentStatus } from "@shared/constants/assignments";
import { getDriverCpcEligibility } from "@shared/constants/driver-cpc-eligibility";
import { withAssignmentsCpcVerdict } from "../lib/mission-driver-cpc";
import { toFieldErrors } from "@shared/errors";
import {
  activeDriverAssignmentsOnMission,
  canAccessMissionAsDriver,
  driverLiveAssignmentFilter,
  driverScopeOf,
  missionsOfDriversFilter,
  missionVehicleIdsForStaff,
  OUT_OF_DRIVER_SCOPE_MESSAGE,
  pickMissionAssignment,
} from "../lib/driver-scope";
import { authorize } from "../middleware/auth";
import { validateBody } from "../middleware/validate-body";
import { moduleLogger } from "../lib/logger";
import {
  DOCUMENT_RENEWAL_VIEWER_ROLES,
  MISSION_EVENT_ROLES,
  MISSION_MANAGER_ROLES,
  MISSION_STATUS_ROLES,
  canRoleSetMissionStatus,
} from "@shared/constants/roles";
import { withLogContext } from "../lib/error-log-context";
import { lockFuelCard, type DbExecutor } from "../lib/fuel-card-lock";
import {
  DIFFERENT_FUEL_SUBMISSION_MESSAGE,
  MISSING_FUEL_REQUEST_KEY_MESSAGE,
  MISSION_FUEL_REQUEST_KEY_PATTERN,
  buildEnteredFuelNotes,
  findMissionRegularization,
  isSameFuelSubmission,
  type FuelSubmission,
  type MissionRegularizationEntry,
} from "../lib/mission-fuel-regularization";
import type { FuelRecord } from "@shared/schema";
import { idSchema } from "@shared/contracts/common";
import { omitMissionBudget, redactMissionBudget, redactMissionPrice } from "../lib/mission-response-scope";

const log = moduleLogger("missions");

const router = Router();
const fuelCardService = new FuelCardService();

/**
 * workflowData de la mission relu sous verrou de ligne (SELECT … FOR UPDATE), dans la transaction
 * qui va le réécrire. Toute écriture de workflowData part de cette lecture, jamais d'une copie lue
 * plus tôt dans la requête : sinon une régularisation de plein validée entre-temps serait effacée,
 * et son rejeu débiterait la carte une seconde fois. Ordre des verrous : carte carburant, puis ligne.
 */
async function lockMissionWorkflowData(tx: DbExecutor, missionId: number): Promise<{ workflowData: unknown } | undefined> {
  const [row] = await tx
    .select({ workflowData: missions.workflowData })
    .from(missions)
    .where(eq(missions.id, missionId))
    .for("update");
  return row;
}

/**
 * Clé de requête d'un plein de mission, obligatoire : sans elle, un nouvel envoi après une coupure
 * débiterait la carte une seconde fois. Lue avant le schéma du corps pour un message qui dit quoi faire.
 */
function readFuelRequestKey(body: unknown): string {
  const raw = (body as { requestKey?: unknown } | null)?.requestKey;
  const key = typeof raw === "string" ? raw.trim() : "";
  if (!key) throw new AppError(400, MISSING_FUEL_REQUEST_KEY_MESSAGE);
  if (!MISSION_FUEL_REQUEST_KEY_PATTERN.test(key)) throw new AppError(400, "Clé de saisie invalide. Rechargez la page.");
  return key;
}

/**
 * Plein déjà enregistré sous cette clé, lu sous le verrou de la carte (aucun débit concurrent ne
 * peut s'intercaler). Même plein : renvoyé pour un rejeu sans débit. Autre plein : 409.
 * `legacyRegularizations` : une régularisation enregistrée avant la colonne request_key n'a sa clé
 * que dans le journal de la mission ; son plein est retrouvé par l'id noté dans l'entrée.
 */
async function findReplayedFuelSubmission(
  tx: DbExecutor,
  requestKey: string,
  submission: FuelSubmission,
  options: { legacyRegularizations?: boolean } = {},
): Promise<FuelRecord | null> {
  let [record] = await tx.select().from(fuelRecords).where(eq(fuelRecords.requestKey, requestKey)).limit(1);
  if (!record && options.legacyRegularizations) {
    const [current] = await tx
      .select({ workflowData: missions.workflowData })
      .from(missions)
      .where(eq(missions.id, submission.missionId));
    const entry = findMissionRegularization(current?.workflowData, requestKey);
    if (!entry) return null;
    [record] = typeof entry.id === "number"
      ? await tx.select().from(fuelRecords).where(eq(fuelRecords.id, entry.id))
      : [];
    if (!record) {
      throw new AppError(409, "Cette régularisation a déjà été enregistrée, puis son plein supprimé. Rechargez la page.");
    }
  }
  if (!record) return null;
  // La clé reste portée par la ligne supprimée (index unique) : rejouer sans débiter ferait croire
  // à un plein enregistré qui ne compte plus, et un nouvel insert violerait l'index.
  if (record.deletedAt) {
    throw new AppError(409, "Ce plein a déjà été enregistré, puis supprimé. Rechargez la page.");
  }
  if (!isSameFuelSubmission(record, submission)) throw new AppError(409, DIFFERENT_FUEL_SUBMISSION_MESSAGE);
  return record;
}

/** Identifiant de mission d'URL : entier strict (`parseRouteId`), sinon 400. Seule lecture de `:id`. */
export function parseMissionId(value: unknown): number {
  return parseRouteId(value, MISSION_ID_INVALID_MESSAGE);
}

// Cloison chauffeur (DRV2-3) : toute route `/:id/...` du routeur refuse un chauffeur
// non affecté à la mission. Le personnel n'est pas filtré. Mission inconnue : 403 aussi,
// pour ne pas révéler l'existence d'un identifiant.
router.param("id", async (req, _res, next, value) => {
  try {
    // Une garde refuse ce qu'elle ne sait pas lire : un identifiant qui n'est pas un entier strict
    // n'atteint jamais un handler (qui le relirait autrement).
    // Parseur commun appelé directement : la garde ne dépend pas d'un relais local.
    const missionId = parseRouteId(value, MISSION_ID_INVALID_MESSAGE);
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

/**
 * Comptes utilisateur des chauffeurs affectés à la mission (destinataires de la trame réduite).
 * Affectation annulée ou refusée exclue : le chauffeur retiré ne reçoit plus les trames de la mission
 * (son écran se resynchronise par polling sur des routes qui l'excluent déjà).
 */
async function assignedDriverUserIds(missionId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: drivers.userId })
    .from(assignments)
    .innerJoin(drivers, eq(assignments.driverId, drivers.id))
    .where(and(eq(assignments.missionId, missionId), notInArray(assignments.status, [...VOID_ASSIGNMENT_STATUSES])));
  return Array.from(new Set(rows.map((row) => row.userId).filter((id): id is number => typeof id === "number" && id > 0)));
}

/**
 * Cloison (AGENTS.md §11) : trame complète au personnel hors chauffeur, trame réduite à
 * l'identifiant de mission pour le chauffeur affecté (son écran se resynchronise par la route
 * qui le filtre déjà), rien pour un client. Diffusion au mieux : l'écriture est faite, un échec
 * d'envoi est journalisé sans faire échouer la requête.
 */
async function emitMissionEvent(
  eventType: string,
  missionId: number | null,
  staffData: Record<string, unknown>,
  requestId?: string,
): Promise<void> {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }
  try {
    broadcastUpdate(eventType, { ...staffData, scope: { type: "roles", roles: [...MISSION_EVENT_ROLES] } });
    if (!missionId) return;
    const driverUserIds = await assignedDriverUserIds(missionId);
    if (driverUserIds.length === 0) return;
    broadcastUpdate(eventType, {
      entity: "mission",
      entityId: missionId,
      payload: { missionId },
      scope: { type: "user", userIds: driverUserIds },
    });
  } catch (error) {
    log.error({ err: error, requestId, eventType }, "diffusion temps réel d'un événement de mission");
  }
}

/**
 * Diffusion temps réel d'une mission. Le prix convenu et son tarif d'origine ne voyagent jamais dans
 * l'événement : il part vers tout le personnel hors chauffeur (techniciens compris), qui n'a pas droit au prix.
 * L'écran qui le lit rafraîchit sa requête sur l'événement.
 */
export async function broadcastMissionUpdate(
  eventType: MissionRealtimeEvent,
  missionWithPrice: Record<string, unknown>,
  extraPayload: Record<string, unknown> = {},
  requestId?: string,
): Promise<void> {
  const { agreedPrice: _price, tariffGridId: _tariff, ...mission } = missionWithPrice;
  const missionId =
    typeof mission.id === "number"
      ? mission.id
      : Number.parseInt(String(mission.id ?? ""), 10) || null;

  await emitMissionEvent(
    eventType,
    missionId,
    {
      entity: "mission",
      entityId: missionId,
      payload: {
        // Trame diffusée à tout le personnel (technicien compris) : ni prix convenu, ni montant du budget (Q19).
        mission: omitMissionBudget(redactMissionPrice(null, mission)),
        missionId,
        ...extraPayload,
      },
    },
    requestId,
  );
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

/** Exporté pour le contrat de portée (tests/contract/mission-realtime-scope.contract.test.ts). */
export async function broadcastMissionFuelRecorded(params: {
  missionId: number;
  fuelRecord: Record<string, unknown>;
  actorUserId: number | null;
  actorRole: string | null;
  requestId?: string;
}): Promise<void> {
  await emitMissionEvent(
    "mission_fuel_recorded",
    params.missionId,
    {
      version: 1,
      entity: "mission",
      entityId: params.missionId,
      payload: {
        missionId: params.missionId,
        record: params.fuelRecord,
        vehicleId: params.fuelRecord.vehicleId ?? null,
      },
      actor: {
        userId: params.actorUserId,
        role: params.actorRole,
      },
      emittedAt: new Date().toISOString(),
    },
    params.requestId,
  );
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

/**
 * Statut de la mission relu sous verrou de ligne, dans la transaction du débit (après le verrou de
 * la carte, avant le contrôle du solde). Une clôture concurrente attend ce verrou, ou le débit attend
 * la clôture et la voit : aucun plein normal ne passe sur une mission clôturée. Appelé après le rejeu,
 * pour qu'un nouvel envoi après une coupure renvoie le plein déjà enregistré même si la mission a été
 * clôturée entre-temps.
 */
async function assertMissionAcceptsFuel(tx: DbExecutor, missionId: number): Promise<void> {
  const [row] = await tx.select({ status: missions.status }).from(missions).where(eq(missions.id, missionId)).for("update");
  if (!row) throw new AppError(404, "Mission non trouvée.");
  if (!MISSION_FUEL_ALLOWED_STATUSES.includes(row.status as (typeof MISSION_FUEL_ALLOWED_STATUSES)[number])) {
    throw new AppError(400, `Enregistrement carburant impossible pour une mission ${row.status}.`);
  }
}
const MISSION_FUEL_REGULARIZATION_ALLOWED_STATUSES = ["delivered", "completed"] as const;
const MISSION_FUEL_DECLARATION_ALLOWED_STATUSES = ["delivered", "completed"] as const;
const MISSION_FUEL_MANAGERS = MISSION_MANAGER_ROLES;

const ALERT_TITLE_TO_DOCUMENT_TYPE = Object.fromEntries(
  Object.entries(DOCUMENT_ALERT_TITLES).map(([documentType, alertTitle]) => [alertTitle, documentType]),
) as Record<string, VehicleDocumentRequirementType>;

/**
 * Permis chauffeur : même règle que les papiers véhicule (jour UTC, valable le jour J,
 * expiré à J+1, #224), source `isDriverLicenseExpiredOn`. Absent ou illisible : expiré.
 */
function isDriverLicenseExpired(dateValue: Date | string | null | undefined): boolean {
  return isDriverLicenseExpiredOn(dateValue, todayUtcDateOnly());
}

/**
 * Même règle que `getMissionEligibility` (source unique `shared/constants/expiry-day.ts`) :
 * le jour de l'échéance est valable, expiré à J+1, la date du jour est la date UTC.
 * Date illisible : bloque.
 */
function isPaperExpired(dateValue: Date | string): boolean {
  if (toExpiryDateOnly(dateValue) === null) return true;
  return isExpiredOn(dateValue, todayUtcDateOnly());
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
  receiptCovers = false,
): boolean {
  if (!docs.length) return false;

  if (documentType === "carte_grise") {
    // Même règle que le lancement (transition in_progress) : une carte grise sans date ne bloque
    // pas ; datée, la plus récente échéance compte, valable le jour J, expirée à J+1 (UTC). Le
    // récépissé « plaque » lève l'échéance dépassée.
    if (receiptCovers) return true;
    const expiries = docs.flatMap((doc) => (doc.expiryDate ? [doc.expiryDate] : []));
    if (expiries.length === 0) return true;
    return expiries.some((expiry) => !isPaperExpired(expiry));
  }

  // Un récépissé valable lève l'échéance dépassée, pas l'absence du papier. Même jour
  // d'échéance que le lancement : jour UTC, valable le jour J, papier sans date
  // invalide (isPaperExpired, jamais la règle du permis).
  if (receiptCovers) return true;
  return docs.some((doc) => doc.expiryDate !== null && !isPaperExpired(doc.expiryDate));
}

/** Exporté pour le contrat de portée. */
export function broadcastDocumentRenewalCreatedFromMission(
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
    // Même portée que la création par /api/document-renewals : rôles qui lisent les demandes (§11).
    scope: { type: "roles", roles: [...DOCUMENT_RENEWAL_VIEWER_ROLES] },
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
          : missionsOfDriversFilter(driverScope),
      )
      .orderBy(desc(missions.createdAt));

    // Get assignments for each mission
    const missionsWithAssignments = await Promise.all(
      allMissions.map(async (mission) => {
        const rawAssignmentRows = await db
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
              cpcTrainingDate: drivers.cpcTrainingDate,
            },
          })
          .from(assignments)
          .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
          .leftJoin(drivers, eq(assignments.driverId, drivers.id))
          .where(eq(assignments.missionId, mission.id))
          .orderBy(asc(assignments.id));
        // Verdict CPC calculé ici, date de formation retirée (cloison de #127).
        const assignmentRows = withAssignmentsCpcVerdict(rawAssignmentRows, req.user, driverScope);
        // Plusieurs chauffeurs possibles : `assignment` reste la valeur unique historique (celle du chauffeur
        // lecteur, sinon la plus ancienne active), `assignments` liste toutes celles qu'il a le droit de voir.
        const visibleAssignments = driverScope === undefined ? assignmentRows : assignmentRows.filter((a) => a.driverId !== null && driverScope.includes(a.driverId));
        const assignment = pickMissionAssignment(assignmentRows, driverScope);

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
          assignments: visibleAssignments,
        };
      })
    );

    return res.json(redactMissionBudget(req.user, missionsWithAssignments));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get missions error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/missions/:id - Détails d'une mission
router.get("/:id", async (req, res) => {
  try {
    const missionId = parseMissionId(req.params.id);

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
    const rawAssignmentRows = await db
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
          cpcTrainingDate: drivers.cpcTrainingDate,
        },
      })
      .from(assignments)
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(eq(assignments.missionId, missionId))
      .orderBy(asc(assignments.id));
    // Plusieurs chauffeurs possibles (voir la liste) : un chauffeur ne lit que ses propres affectations.
    const detailScope = await driverScopeOf(req.user);
    // Verdict CPC calculé ici, date de formation retirée (cloison de #127).
    const assignmentRows = withAssignmentsCpcVerdict(rawAssignmentRows, req.user, detailScope);
    const visibleAssignments = detailScope === undefined ? assignmentRows : assignmentRows.filter((a) => a.driverId !== null && detailScope.includes(a.driverId));
    const assignment = pickMissionAssignment(assignmentRows, detailScope);

    const executionDates = extractMissionExecutionDates({
      workflowData: mission.workflowData,
      status: mission.status,
      updatedAt: mission.updatedAt,
      completedAt: mission.completedAt,
      assignmentStartedAt: assignment?.startedAt,
      assignmentCompletedAt: assignment?.completedAt,
    });

    return res.json(redactMissionBudget(req.user, {
      ...mission,
      ...executionDates,
      assignment: assignment || null,
      assignments: visibleAssignments,
    }));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get mission error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/missions/:id/fuel-records - Historique carburant lié à la mission
router.get("/:id/fuel-records", async (req, res) => {
  try {
    const missionId = parseMissionId(req.params.id);

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

    return res.status(200).json(redactMissionBudget(req.user, {
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
    }));
  } catch (error) {
    log.error({ err: error, requestId: req.requestId }, "Get mission fuel records error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/missions/:id/fuel-records - Enregistrer un plein lié à une mission
// Débite la carte de l'entreprise : gestionnaires de mission et chauffeur affecté seulement (contrôle du chauffeur plus bas).
router.post("/:id/fuel-records", authorize([...MISSION_FUEL_MANAGERS, "driver"]), async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);

    const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const actorRole = String(req.user?.role || "").trim().toLowerCase();

    if (!actorUserId) {
      return res.status(401).json({ message: "Session invalide. Veuillez vous reconnecter." });
    }

    const payloadSchema = z.object({
      vehicleId: idSchema,
      quantity: z.coerce.number().positive(),
      // Obligatoire (contrat), mais retenu pour admin et logistique seulement ; sinon prix du jour.
      unitPrice: z.coerce.number().positive(),
      date: z.string().trim().min(1).optional(),
      stationName: z.string().trim().min(1).optional(),
      notes: z.string().trim().optional(),
      isPreDeparture: z.coerce.boolean().optional().default(false),
    });

    const requestKey = readFuelRequestKey(req.body);
    const parsedPayload = payloadSchema.safeParse(req.body ?? {});
    if (!parsedPayload.success) {
      throw new AppError(400, "Payload invalide.", {
        fieldErrors: toFieldErrors(parsedPayload.error.issues),
        cause: parsedPayload.error,
      });
    }

    const payload = parsedPayload.data;
    const parsedDate = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(parsedDate.getTime())) throw new AppError(400, "Date de plein invalide.");
    const unitPrice = await resolveFuelUnitPrice(actorRole, payload.unitPrice, parsedDate);

    const [mission] = await db
      .select({
        id: missions.id,
        status: missions.status,
        deliveryAddress: missions.deliveryAddress,
        clientName: clients.name,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
      .where(eq(missions.id, missionId))
      .limit(1);

    if (!mission) {
      return res.status(404).json({ message: "Mission non trouvée." });
    }

    // Plusieurs chauffeurs possibles par mission : le droit et le véhicule contrôlé se lisent sur
    // l'ensemble des affectations, pas sur « la » première (#227).
    // Périmètre d'abord : un chauffeur sans affectation active sur la mission reçoit 403 quel que soit le
    // véhicule envoyé, sans pouvoir distinguer 400 et 403 pour deviner le véhicule d'une mission hors de
    // son périmètre. Son véhicule est celui de SA affectation, jamais celui d'un autre chauffeur.
    let allowedVehicleIds: number[];
    if (actorRole === "driver") {
      const own = await activeDriverAssignmentsOnMission({ id: actorUserId, role: actorRole }, missionId);
      if (own.length === 0) {
        throw new AppError(403, "Accès refusé: seul un chauffeur affecté à cette mission peut enregistrer ce plein.");
      }
      allowedVehicleIds = own.map((a) => a.vehicleId).filter((v): v is number => v !== null);
    } else {
      allowedVehicleIds = await missionVehicleIdsForStaff(missionId);
    }

    // Statut : contrôlé sous le verrou de ligne, après le rejeu (assertMissionAcceptsFuel), pas ici.
    if (allowedVehicleIds.length === 0) {
      return res.status(400).json({ message: "Aucun véhicule affecté à cette mission." });
    }

    if (!allowedVehicleIds.includes(payload.vehicleId)) {
      return res.status(400).json({
        message: "Le véhicule renseigné ne correspond pas au véhicule affecté à la mission.",
      });
    }

    const consumption = {
      vehicleId: payload.vehicleId,
      quantity: payload.quantity,
      unitPrice,
      date: parsedDate.toISOString(),
      stationName: payload.stationName || "MISSION",
      destination: mission.deliveryAddress || "Mission",
      clientName: mission.clientName || undefined,
      notes: payload.notes,
      missionId,
      isPreDeparture: payload.isPreDeparture,
      userId: actorUserId,
      requestKey,
    };
    // Même clé, même plein : rejoué sous le verrou de la carte, sans second débit ni diffusion, quel
    // que soit le statut actuel. Sinon le statut est relu sous le verrou de ligne avant tout débit.
    const submission: FuelSubmission = {
      missionId,
      vehicleId: consumption.vehicleId,
      quantity: consumption.quantity,
      unitPrice: consumption.unitPrice,
      date: payload.date ? consumption.date.slice(0, 10) : null,
      stationName: consumption.stationName,
      notes: buildEnteredFuelNotes(consumption),
    };
    const result = await fuelCardService.recordConsumption(consumption, undefined, {
      replay: async (tx) => {
        const replayed = await findReplayedFuelSubmission(tx, requestKey, submission);
        if (!replayed) await assertMissionAcceptsFuel(tx, missionId);
        return replayed;
      },
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

    const totals = {
      totalQuantity: fuelData.totalQuantity,
      totalCost: fuelData.totalCost,
      recordsCount: fuelData.records.length,
    };

    if (result.replayed) {
      // Rejeu : rien n'a été écrit, donc rien à diffuser. Même forme de réponse que le premier envoi.
      return res.status(200).json({ record: result.consumption, totals, mission: updatedMission || null, replayed: true });
    }

    if (updatedMission) {
      await broadcastMissionUpdate("mission_updated", updatedMission as unknown as Record<string, unknown>, {
        source: "mission_fuel_recorded",
      }, req.requestId);
    }

    await broadcastMissionFuelRecorded({
      requestId: req.requestId,
      missionId,
      fuelRecord: result.consumption as unknown as Record<string, unknown>,
      actorUserId,
      actorRole,
    });

    return res.status(201).json({
      record: result.consumption,
      totals,
      mission: updatedMission || null,
    });
  } catch (error) {
    // Un refus (AppError) est journalisé par le gestionnaire central ; seule l'erreur imprévue est loggée ici.
    next(withLogContext(toFuelCardAppError(error), { event: "Create mission fuel record error" }));
  }
});

// POST /api/missions/:id/fuel-records/regularize - Régulariser un plein oublié après clôture/livraison
router.post("/:id/fuel-records/regularize", async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);

    const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const actorRole = String(req.user?.role || "").trim().toLowerCase();

    if (!actorUserId) {
      return res.status(401).json({ message: "Session invalide. Veuillez vous reconnecter." });
    }

    if (!isMissionFuelManagerRole(actorRole)) {
      throw new AppError(403, "Seuls admin, logistique ou secrétariat peuvent régulariser un plein mission.");
    }

    const payloadSchema = z.object({
      vehicleId: idSchema,
      quantity: z.coerce.number().positive(),
      // Obligatoire (contrat), mais retenu pour admin et logistique seulement ; sinon prix du jour.
      unitPrice: z.coerce.number().positive(),
      date: z.string().trim().min(1).optional(),
      stationName: z.string().trim().min(1).optional(),
      notes: z.string().trim().optional(),
      regularizationReason: z.string().trim().min(8, "Le motif de régularisation est obligatoire."),
      isPreDeparture: z.coerce.boolean().optional().default(false),
    });

    // Clé d'une soumission : un second envoi avec la même clé rejoue la première sans second débit.
    const requestKey = readFuelRequestKey(req.body);
    const parsedPayload = payloadSchema.safeParse(req.body ?? {});
    if (!parsedPayload.success) {
      return res.status(400).json({
        message: "Payload invalide.",
        errors: parsedPayload.error.errors,
      });
    }

    const payload = parsedPayload.data;
    const parsedDate = payload.date ? new Date(payload.date) : new Date();
    if (Number.isNaN(parsedDate.getTime())) throw new AppError(400, "Date de plein invalide.");
    const unitPrice = await resolveFuelUnitPrice(actorRole, payload.unitPrice, parsedDate);

    const [mission] = await db
      .select({
        id: missions.id,
        status: missions.status,
        workflowData: missions.workflowData,
        deliveryAddress: missions.deliveryAddress,
        clientName: clients.name,
      })
      .from(missions)
      .leftJoin(clients, eq(missions.clientId, clients.id))
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

    // Plusieurs chauffeurs, donc plusieurs véhicules possibles : on accepte celui de n'importe quelle affectation (#227).
    const regularizableVehicleIds = await missionVehicleIdsForStaff(missionId);
    if (regularizableVehicleIds.length === 0) {
      return res.status(400).json({ message: "Aucun véhicule affecté à cette mission." });
    }

    if (!regularizableVehicleIds.includes(payload.vehicleId)) {
      return res.status(400).json({
        message: "Le véhicule renseigné ne correspond pas au véhicule affecté à la mission.",
      });
    }

    const regularizationNotePrefix = `[REGULARISATION] ${payload.regularizationReason}`;
    const mergedNotes = payload.notes?.trim()
      ? `${regularizationNotePrefix} | ${payload.notes.trim()}`
      : regularizationNotePrefix;

    // Débit et journal de régularisation dans une seule transaction, sous le verrou de la
    // carte puis le verrou de ligne de la mission : un échec du journal annule le débit, et
    // aucune autre écriture de workflowData (statut, budget) ne peut effacer l'entrée. Une clé
    // déjà utilisée est lue sous le verrou de la carte : le second envoi rejoue, sans second débit.
    const missionReturning = {
      id: missions.id,
      status: missions.status,
      actualFuelCost: missions.actualFuelCost,
      actualFuelQuantity: missions.actualFuelQuantity,
      workflowData: missions.workflowData,
      updatedAt: missions.updatedAt,
    };
    let updatedMission:
      | {
          id: number;
          status: string | null;
          actualFuelCost: string | null;
          actualFuelQuantity: number | null;
          workflowData: unknown;
          updatedAt: Date | null;
        }
      | undefined;
    let regularizationEntry: MissionRegularizationEntry | undefined;
    const consumptionData = {
      vehicleId: payload.vehicleId,
      quantity: payload.quantity,
      unitPrice,
      date: parsedDate.toISOString(),
      stationName: payload.stationName || "MISSION",
      destination: mission.deliveryAddress || "Mission",
      clientName: mission.clientName || undefined,
      notes: mergedNotes,
      missionId,
      isPreDeparture: payload.isPreDeparture,
      userId: actorUserId,
      requestKey,
    };
    // Comparée au plein déjà enregistré : date, station et motif (dans les notes) compris.
    const submission: FuelSubmission = {
      missionId,
      vehicleId: consumptionData.vehicleId,
      quantity: consumptionData.quantity,
      unitPrice: consumptionData.unitPrice,
      date: payload.date ? consumptionData.date.slice(0, 10) : null,
      stationName: consumptionData.stationName,
      notes: buildEnteredFuelNotes(consumptionData),
    };
    const replay = async (tx: DbExecutor) => {
      const record = await findReplayedFuelSubmission(tx, requestKey, submission, { legacyRegularizations: true });
      if (!record) return null;
      const [current] = await tx.select(missionReturning).from(missions).where(eq(missions.id, missionId));
      regularizationEntry = findMissionRegularization(current?.workflowData, requestKey) ?? undefined;
      updatedMission = current;
      return record;
    };
    const result = await fuelCardService.recordConsumption(
      consumptionData,
      async (tx, consumption, cost) => {
        // Verrou de ligne : la transition de statut et le PATCH budget relisent workflowData sous ce
        // même verrou, après ce commit ; ils ne peuvent plus réécrire une version sans cette entrée.
        const current = await lockMissionWorkflowData(tx, missionId);

        regularizationEntry = {
          id: consumption?.id ?? null,
          requestKey,
          vehicleId: payload.vehicleId,
          reason: payload.regularizationReason,
          createdAt: new Date().toISOString(),
          createdBy: actorUserId,
          createdRole: actorRole || null,
          quantity: payload.quantity,
          unitPrice,
          debitAmount: cost,
        };

        const nextWorkflowData = mergeMissionFuelTracking(current?.workflowData ?? mission.workflowData, {
          noRefuelDeclaration: null,
          regularizationEntry,
        });

        [updatedMission] = await tx
          .update(missions)
          .set({
            workflowData: nextWorkflowData,
            updatedAt: new Date(),
          })
          .where(eq(missions.id, missionId))
          .returning(missionReturning);
      },
      { replay },
    );

    const fuelData = await fuelCardService.getFuelRecordsByMission(missionId);
    const totals = {
      totalQuantity: fuelData.totalQuantity,
      totalCost: fuelData.totalCost,
      recordsCount: fuelData.records.length,
    };

    if (result.replayed) {
      // Rejeu : rien n'a été écrit, donc rien à diffuser. Même forme de réponse que le premier envoi.
      return res.status(200).json({
        record: result.consumption,
        totals,
        mission: updatedMission || null,
        regularization: regularizationEntry,
        replayed: true,
      });
    }

    if (updatedMission) {
      await broadcastMissionUpdate("mission_updated", updatedMission as unknown as Record<string, unknown>, {
        source: "mission_fuel_regularized",
      }, req.requestId);
    }

    await broadcastMissionFuelRecorded({
      requestId: req.requestId,
      missionId,
      fuelRecord: result.consumption as unknown as Record<string, unknown>,
      actorUserId,
      actorRole,
    });

    return res.status(201).json({
      record: result.consumption,
      totals,
      mission: updatedMission || null,
      regularization: regularizationEntry,
    });
  } catch (error) {
    // Un refus (AppError) est journalisé par le gestionnaire central ; seule l'erreur imprévue est loggée ici.
    next(withLogContext(toFuelCardAppError(error), { event: "Regularize mission fuel record error" }));
  }
});

// POST /api/missions/:id/fuel-records/declare-no-refuel - Déclarer une mission terminée sans ravitaillement
router.post("/:id/fuel-records/declare-no-refuel", async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);

    const actorUserId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const actorRole = String(req.user?.role || "").trim().toLowerCase();

    if (!actorUserId) {
      return res.status(401).json({ message: "Session invalide. Veuillez vous reconnecter." });
    }

    if (!isMissionFuelManagerRole(actorRole)) {
      throw new AppError(403, "Seuls admin, logistique ou secrétariat peuvent déclarer une mission sans ravitaillement.");
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

    const declaration: MissionNoRefuelDeclaration = {
      reason: parsedPayload.data.reason,
      declaredAt: new Date().toISOString(),
      declaredBy: actorUserId,
      declaredRole: actorRole || null,
    };

    // Sous le verrou de la carte, comme la régularisation : l'absence de plein est contrôlée
    // et workflowData relu dans la transaction, sinon une régularisation concurrente serait
    // écrasée par une copie périmée (entrée de journal perdue, débit sans trace).
    const updatedMission = await db.transaction(async (tx) => {
      await lockFuelCard(tx);
      const [mission] = await tx
        .select({
          id: missions.id,
          status: missions.status,
          workflowData: missions.workflowData,
        })
        .from(missions)
        .where(eq(missions.id, missionId))
        .limit(1)
        // Verrou de ligne, pris après celui de la carte (même ordre que la régularisation) :
        // le statut et le budget ne peuvent pas réécrire workflowData entre cette lecture et l'écriture.
        .for("update");

      if (!mission) {
        throw new AppError(404, "Mission non trouvée.");
      }

      if (
        !MISSION_FUEL_DECLARATION_ALLOWED_STATUSES.includes(
          mission.status as (typeof MISSION_FUEL_DECLARATION_ALLOWED_STATUSES)[number],
        )
      ) {
        throw new AppError(400, `Déclaration impossible pour une mission ${mission.status}.`);
      }

      if (await fuelCardService.hasFuelRecordsForMission(missionId, tx)) {
        throw new AppError(
          409,
          "Cette mission contient déjà un ou plusieurs pleins. La déclaration sans ravitaillement est impossible.",
        );
      }

      const nextWorkflowData = mergeMissionFuelTracking(mission.workflowData, {
        noRefuelDeclaration: declaration,
      });

      const [row] = await tx
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
      return row;
    });

    if (updatedMission) {
      await broadcastMissionUpdate("mission_updated", updatedMission as unknown as Record<string, unknown>, {
        source: "mission_no_refuel_declared",
      }, req.requestId);
    }

    return res.status(200).json({
      mission: updatedMission || null,
      declaration,
    });
  } catch (error) {
    next(withLogContext(error, { event: "Declare mission no-refuel error" }));
  }
});

// GET /api/missions/:id/launch-readiness - Checklist métier de lancement mission
router.get("/:id/launch-readiness", async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);

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

    // Même portée que la liste et le détail : un chauffeur ne lit que ses missions, et la
    // checklist (verdict CPC compris) se calcule sur SA fiche, jamais sur celle d'un collègue.
    const readinessScope = await driverScopeOf(req.user);
    if (readinessScope !== undefined && !(await canAccessMissionAsDriver(req.user, missionId))) {
      // Défense en profondeur : router.param("id") a déjà refusé ce chauffeur.
      throw new AppError(403, OUT_OF_DRIVER_SCOPE_MESSAGE);
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
        vehicleInsuranceExpiry: vehicles.insuranceExpiry,
        vehicleTechnicalInspectionDate: vehicles.technicalInspectionDate,
        vehicleLicensePlateExpiry: vehicles.licensePlateExpiry,
        driverFirstName: drivers.firstName,
        driverLastName: drivers.lastName,
        driverIsActive: drivers.isActive,
        driverCpcStatus: drivers.cpcStatus,
        driverCpcTrainingDate: drivers.cpcTrainingDate,
        driverLicenseExpiry: drivers.licenseExpiry,
      })
      .from(assignments)
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(
        readinessScope === undefined
          ? and(eq(assignments.missionId, missionId), notInArray(assignments.status, [...VOID_ASSIGNMENT_STATUSES]))
          : and(eq(assignments.missionId, missionId), driverLiveAssignmentFilter(readinessScope)),
      )
      .orderBy(asc(assignments.id))
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

    const readinessReceipts = missionAssignment?.vehicleId
      ? await loadOpenRenewalReceipts(missionAssignment.vehicleId)
      : {};
    const carteGriseDocs = docsByType.get("carte_grise") || [];
    // Colonnes miroir de `vehicles` : même règle qu'au lancement (getMissionEligibility),
    // récépissés compris. Un motif de conformité fait tomber l'item du papier concerné.
    const mirrorBlockers = hasVehicle
      ? getMissionEligibility({
          status: missionAssignment?.vehicleStatus,
          insuranceExpiry: missionAssignment?.vehicleInsuranceExpiry,
          technicalInspectionDate: missionAssignment?.vehicleTechnicalInspectionDate,
          licensePlateExpiry: missionAssignment?.vehicleLicensePlateExpiry,
          receipts: readinessReceipts,
        }).blockers.filter((blocker) => blocker.kind === "compliance")
      : [];
    const mirrorReason = (code: string): string | null => {
      const reason = mirrorBlockers.find((blocker) => blocker.code === code)?.reason;
      return reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.` : null;
    };
    const carteGriseMirror = mirrorReason("license_plate");
    const assuranceMirror = mirrorReason("insurance");
    const visiteMirror = mirrorReason("technical_inspection");
    const carteGriseValid = !carteGriseMirror && hasVehicle && isDocumentTypeValid(
      "carte_grise",
      carteGriseDocs,
      isRenewalReceiptValid(readinessReceipts, "license_plate"),
    );
    const assuranceDocs = docsByType.get("assurance") || [];
    const visiteDocs = docsByType.get("visite_technique") || [];
    const assuranceValid = !assuranceMirror && hasVehicle && isDocumentTypeValid(
      "assurance",
      assuranceDocs,
      isRenewalReceiptValid(readinessReceipts, "insurance"),
    );
    const visiteTechniqueValid = !visiteMirror && hasVehicle && isDocumentTypeValid(
      "visite_technique",
      visiteDocs,
      isRenewalReceiptValid(readinessReceipts, "technical_inspection"),
    );
    // Valide grâce au seul récépissé : le dire, plutôt que « valide ».
    const assuranceParRecepisse = assuranceValid && !isDocumentTypeValid("assurance", assuranceDocs);
    const carteGriseParRecepisse = carteGriseValid && !isDocumentTypeValid("carte_grise", carteGriseDocs);
    const visiteParRecepisse = visiteTechniqueValid && !isDocumentTypeValid("visite_technique", visiteDocs);
    const permisValid = hasDriver && Boolean(missionAssignment?.driverLicenseExpiry) && !isDriverLicenseExpired(missionAssignment?.driverLicenseExpiry);
    const cpcCheck = getDriverCpcEligibility({
      cpcStatus: missionAssignment?.driverCpcStatus,
      cpcTrainingDate: missionAssignment?.driverCpcTrainingDate,
    });
    const cpcValid = hasDriver && cpcCheck.eligible;
    const driverActive = hasDriver && Boolean(missionAssignment?.driverIsActive);
    const vehicleOperational = hasVehicle && missionAssignment?.vehicleStatus === "operational";

    const { plan: missionBudgetPlan, missingDetail: launchBudgetMissing, present: presentLaunchReadiness } = await resolveLaunchBudget(missionId, extractMissionBudgetPlan(mission.workflowData, mission.estimatedFuelCost), req.user?.role);
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
      log.error({ err: fuelBalanceError, requestId: req.requestId }, "Mission launch-readiness fuel balance error");
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
      noPlanningConflict =
        (await findPlanningClash(db, {
          missionId: mission.id,
          pickupDate: mission.pickupDate,
          deliveryDate: mission.deliveryDate,
          vehicleId: missionAssignment.vehicleId,
          driverId: missionAssignment.driverId,
        })) === null;
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
            : (cpcCheck.label ?? "CPC non valide.")
          : "Assignez d'abord un chauffeur.",
        // Code stable lu par les écrans ; jamais la raison datée (diffusée à tout le personnel).
        ...(hasDriver && !cpcValid && cpcCheck.code ? { cpcIneligibleCode: cpcCheck.code } : {}),
      },
      {
        key: "doc_carte_grise",
        label: "Carte grise conforme",
        passed: carteGriseValid,
        blocking: true,
        detail: carteGriseParRecepisse
          ? "Carte grise couverte par un récépissé provisoire."
          : carteGriseValid
            ? "Carte grise valide."
            : carteGriseMirror && isDocumentTypeValid("carte_grise", carteGriseDocs, isRenewalReceiptValid(readinessReceipts, "license_plate"))
              ? carteGriseMirror
              : carteGriseDocs.length > 0
              ? "Carte grise expirée."
              : "Carte grise manquante.",
      },
      {
        key: "doc_assurance",
        label: "Assurance conforme",
        passed: assuranceValid,
        blocking: true,
        detail: assuranceParRecepisse
          ? "Assurance couverte par un récépissé provisoire."
          : assuranceValid ? "Assurance valide." : assuranceMirror && assuranceDocs.length > 0 ? assuranceMirror : "Assurance manquante ou expirée.",
      },
      {
        key: "doc_visite_technique",
        label: "Visite technique conforme",
        passed: visiteTechniqueValid,
        blocking: true,
        detail: visiteParRecepisse
          ? "Visite technique couverte par un récépissé provisoire."
          : visiteTechniqueValid ? "Visite technique valide." : visiteMirror && visiteDocs.length > 0 ? visiteMirror : "Visite technique manquante ou expirée.",
      },
      {
        key: "budget_fuel",
        label: "Budget carburant",
        passed: hasFuelBudget,
        blocking: true,
        detail: hasFuelBudget
          ? `${Math.round(Number(fuelBudgetValue || 0))} FCFA renseigné.`
          : launchBudgetMissing ?? "Budget carburant non renseigné.",
      },
      {
        key: "budget_road_expenses",
        label: "Budget frais de route (FDR)",
        passed: hasRoadExpensesBudget,
        blocking: true,
        detail: hasRoadExpensesBudget
          ? `${Math.round(Number(roadExpensesBudgetValue || 0))} FCFA renseigné.`
          : launchBudgetMissing ?? "Budget frais de route non renseigné.",
      },
      {
        key: "budget_contingency",
        label: "Budget imprévus",
        passed: hasContingencyBudget,
        blocking: true,
        detail: hasContingencyBudget
          ? `${Math.round(Number(contingencyBudgetValue || 0))} FCFA renseigné.`
          : launchBudgetMissing ?? "Budget imprévus non renseigné.",
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
      cpcIneligibleCode?: string;
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

    return res.status(200).json(presentLaunchReadiness({
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
    }));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Get mission launch readiness error");
    return next(new AppError(500, "Impossible de calculer la check-list de lancement. Réessayez.", { cause: error }));
  }
});

/**
 * Création : une mission naît en brouillon ou planifiée (l'écran de création envoie `planned`),
 * puis avance par PUT /:id/status. Le coût réel et les budgets (`workflowData.budgetPlan`) se
 * saisissent ensuite par PATCH /:id : Zod les retire du corps (relecture de #129, lot 2).
 */
const createMissionSchema = insertMissionSchema
  .omit({
    status: true,
    actualFuelCost: true,
    workflowData: true,
    // Posés par le cycle de vie (validation, POD, clôture, étape), jamais à la création.
    validatedBy: true,
    validatedAt: true,
    podUploadedAt: true,
    actualDistance: true,
    actualFuelQuantity: true,
    currentStep: true,
  })
  .extend({
    status: z.enum(["draft", "planned"]).optional(),
    // O3 lot 3 : prix convenu en XAF entier ; le tarif d'origine n'a de sens qu'avec un prix.
    agreedPrice: z.number().int().min(0).max(999_999_999_999_999).nullable().optional().transform((v) => (v == null ? null : String(v))),
    tariffGridId: idSchema.nullable().optional(),
  })
  .refine((m) => m.tariffGridId == null || m.agreedPrice != null, {
    message: "Un tarif d'origine suppose un prix convenu.",
    path: ["tariffGridId"],
  });

// POST /api/missions - Créer une nouvelle mission
router.post("/", authorize([...MISSION_MANAGER_ROLES]), async (req, res, next) => {
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
    const parsed = createMissionSchema.safeParse({
      ...missionData,
      createdBy: userId,
    });
    if (!parsed.success) {
      return res.status(400).json({
        message: "Mission invalide : une mission se crée en brouillon ou planifiée.",
        errors: parsed.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
      });
    }
    const validatedData = parsed.data;

    if (validatedData.tariffGridId != null) {
      const [tariff] = await db
        .select({ id: tariffGrid.id, clientId: tariffGrid.clientId, active: tariffGrid.active, validFrom: tariffGrid.validFrom, validTo: tariffGrid.validTo, origin: tariffGrid.origin, destination: tariffGrid.destination, cargoType: tariffGrid.cargoType })
        .from(tariffGrid)
        .where(eq(tariffGrid.id, validatedData.tariffGridId))
        .limit(1);
      if (!tariff) throw new AppError(400, "Tarif d'origine introuvable.");
      // Le tarif cité doit être celui que la suggestion aurait pu proposer : actif, du client (ou générique), valide ce jour-là.
      const douala = new Date((validatedData.pickupDate ?? new Date()).getTime() + 3_600_000).toISOString().slice(0, 10);
      if (!tariff.active) throw new AppError(400, "Ce tarif n'est plus actif.");
      if (tariff.clientId !== null && tariff.clientId !== (validatedData.clientId ?? null)) {
        throw new AppError(400, "Ce tarif appartient à un autre client.");
      }
      if (tariff.validFrom > douala || (tariff.validTo !== null && tariff.validTo < douala)) {
        throw new AppError(400, "Ce tarif ne couvre pas la date de la mission.");
      }
      // Même rapprochement que la suggestion : lieu entier ou ville (texte avant la première virgule), marchandise exacte ou tarif générique.
      const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      const matchesPlace = (tariffPlace: string, address: string) => same(tariffPlace, address) || same(tariffPlace, address.split(",")[0]);
      if (!matchesPlace(tariff.origin, validatedData.pickupAddress) || !matchesPlace(tariff.destination, validatedData.deliveryAddress)) {
        throw new AppError(400, "Ce tarif ne correspond pas au trajet de la mission.");
      }
      if (tariff.cargoType !== "" && !same(tariff.cargoType, String((validatedData.cargo as { description?: string } | null | undefined)?.description ?? ""))) {
        throw new AppError(400, "Ce tarif ne correspond pas à la marchandise de la mission.");
      }
    }

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
      const eligibilite = getMissionEligibility({
        ...selectedVehicle,
        receipts: await loadOpenRenewalReceipts(selectedVehicle.id),
      });
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
          cpcTrainingDate: drivers.cpcTrainingDate,
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

      const cpcCheck = getDriverCpcEligibility(selectedDriver);
      if (!cpcCheck.eligible) {
        return res.status(400).json({
          message: `CPC invalide pour ${selectedDriver.firstName} ${selectedDriver.lastName} : ${cpcCheck.reason}`,
        });
      }
    }

    // Mission et affectation dans une même transaction : l'une sans l'autre laisserait une mission
    // orpheline. Une mission planifiée et affectée naît `assigned` (affectation `pending`), comme
    // celle qui reçoit son affectation après coup (PATCH, POST /:id/assignments). Un brouillon reste brouillon.
    const withAssignment = assignmentVehicleId !== null && assignmentDriverId !== null;
    const newMission = await db.transaction(async (tx) => {
      if (withAssignment) {
        await lockPlanningResources(tx, assignmentVehicleId!, assignmentDriverId!);
        const clash = await findPlanningClash(tx, {
          missionId: null,
          pickupDate: validatedData.pickupDate,
          deliveryDate: validatedData.deliveryDate,
          vehicleId: assignmentVehicleId!,
          driverId: assignmentDriverId!,
        });
        if (clash) throw new AppError(409, planningClashMessage(clash));
      }
      const [created] = await tx
        .insert(missions)
        .values(withAssignment && validatedData.status === "planned" ? { ...validatedData, status: "assigned" } : validatedData)
        .returning();
      if (withAssignment) {
        await tx.insert(assignments).values(
          insertAssignmentSchema.parse({
            missionId: created.id,
            vehicleId: assignmentVehicleId,
            driverId: assignmentDriverId,
            status: "pending" as const,
          }),
        );
      }
      return created;
    });

    await broadcastMissionUpdate("mission_created", newMission as unknown as Record<string, unknown>, {
      hasAssignment: withAssignment,
    }, req.requestId);

    return res.status(201).json(newMission);
  } catch (error) {
    // Conflit de planning : AppError traité par le gestionnaire central (code et requestId).
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Create mission error");
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
    vehicleId: idSchema,
    driverId: idSchema,
  }).optional().nullable(),
});

// PATCH /api/missions/:id - Mettre à jour les infos de mission
// Réservé aux gestionnaires de missions (R3) : le montage n'exige que isStaff, ce qui laissait
// chauffeur, technicien et magasinier modifier coût carburant, dates, chauffeur et véhicule.
router.patch("/:id", authorize([...MISSION_MANAGER_ROLES]), async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);

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
        pickupAddress: missions.pickupAddress,
        deliveryAddress: missions.deliveryAddress,
        cargo: missions.cargo,
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
    // Le tarif repris ne vaut que pour le trajet, la marchandise et la date qui l'ont fait choisir : le prix reste, le lien tombe.
    const nextPickup = payload.pickupDate ? new Date(payload.pickupDate).getTime() : null;
    const tariffKeyChanged =
      (payload.pickupDate !== undefined && nextPickup !== (existingMission.pickupDate ? new Date(existingMission.pickupDate).getTime() : null)) ||
      (payload.pickupAddress !== undefined && payload.pickupAddress !== existingMission.pickupAddress) ||
      (payload.deliveryAddress !== undefined && payload.deliveryAddress !== existingMission.deliveryAddress) ||
      (payload.cargoDescription !== undefined && (payload.cargoDescription ?? null) !== ((existingMission.cargo as { description?: string } | null)?.description ?? null));
    if (tariffKeyChanged) {
      missionUpdates.tariffGridId = null;
    }

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

    // Le budget se fusionne dans workflowData relu sous verrou de ligne, au moment d'écrire (plus bas) :
    // la copie lue en tête de requête peut précéder une régularisation de plein qu'elle effacerait.
    const hasBudgetPatch = Object.keys(budgetPatch).length > 0;

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

    // `assignment` du PATCH reste le format « un chauffeur par mission ». Avec plusieurs affectations
    // vivantes, il ne sait pas laquelle viser : refus explicite plutôt qu'écrire sur « la première ».
    // Une affectation annulée ou refusée n'est jamais réécrite (elle reprendrait sa part du CA).
    const liveAssignments = (
      await db
        .select({
          id: assignments.id,
          status: assignments.status,
          vehicleId: assignments.vehicleId,
          driverId: assignments.driverId,
        })
        .from(assignments)
        .where(eq(assignments.missionId, missionId))
        .orderBy(asc(assignments.id))
    ).filter((row) => !isVoidAssignmentStatus(row.status));
    const existingAssignment = liveAssignments[0];

    const assignmentProvided = Object.prototype.hasOwnProperty.call(payload, "assignment");
    if (assignmentProvided && liveAssignments.length > 1) {
      throw new AppError(
        409,
        "Cette mission a plusieurs chauffeurs : modifiez ses affectations une par une (ajout ou annulation d'une affectation).",
      );
    }
    // Écritures d'affectation différées dans la transaction finale : le contrôle de planning
    // (verrou + conflit) doit précéder l'écriture et partager son sort.
    let writeAssignment: ((tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>) | null = null;
    // Paires (véhicule, chauffeur) à contrôler sur le créneau retenu.
    let planningTargets: Array<{ vehicleId: number; driverId: number }> = [];
    const effectivePickup = missionUpdates.pickupDate !== undefined ? missionUpdates.pickupDate : existingMission.pickupDate;
    const effectiveDelivery = missionUpdates.deliveryDate !== undefined ? missionUpdates.deliveryDate : existingMission.deliveryDate;
    const sameInstant = (a: unknown, b: unknown) => (a ? new Date(a as any).getTime() : null) === (b ? new Date(b as any).getTime() : null);
    const datesChanged = !sameInstant(effectivePickup, existingMission.pickupDate) || !sameInstant(effectiveDelivery, existingMission.deliveryDate);
    if (!assignmentProvided && datesChanged) {
      planningTargets = liveAssignments
        .filter((row) => row.vehicleId !== null && row.driverId !== null)
        .map((row) => ({ vehicleId: row.vehicleId as number, driverId: row.driverId as number }));
    }

    if (assignmentProvided) {
      if (payload.assignment == null) {
        if (existingAssignment?.id) {
          const removed = existingAssignment;
          writeAssignment = async (tx) => {
            await tx.delete(assignments).where(and(eq(assignments.id, removed.id), eq(assignments.status, removed.status)));
          };
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
        const eligibilite = getMissionEligibility({
          ...selectedVehicle,
          receipts: await loadOpenRenewalReceipts(selectedVehicle.id),
        });
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
            cpcTrainingDate: drivers.cpcTrainingDate,
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

        const cpcCheck = getDriverCpcEligibility(selectedDriver);
        if (!cpcCheck.eligible) {
          return res.status(400).json({
            message: `CPC invalide pour ${selectedDriver.firstName} ${selectedDriver.lastName} : ${cpcCheck.reason}`,
          });
        }

        // Contrôlé si l'affectation change de véhicule ou de chauffeur, ou si le créneau bouge ;
        // un renvoi à l'identique ne vérifie rien.
        const pairChanged = !existingAssignment || existingAssignment.vehicleId !== vehicleId || existingAssignment.driverId !== driverId;
        if (pairChanged || datesChanged) planningTargets = [{ vehicleId, driverId }];

        if (existingAssignment?.id) {
          const current = existingAssignment;
          writeAssignment = async (tx) => {
            await tx
              .update(assignments)
              .set({
                vehicleId,
                driverId,
                status: current.status === "in_progress" ? "in_progress" : "pending",
                updatedAt: new Date(),
              })
              .where(and(eq(assignments.id, current.id), eq(assignments.status, current.status)));
          };
        } else {
          writeAssignment = async (tx) => {
            await tx.insert(assignments).values({ missionId, vehicleId, driverId, status: "pending" });
          };
        }

        if (existingMission.status === "planned") {
          missionUpdates.status = "assigned";
        }
      }
    }

    // Empreinte de ce qui a été lu avant la transaction (créneau et affectations vivantes).
    const readKey = planningStateKey({ pickupDate: existingMission.pickupDate, deliveryDate: existingMission.deliveryDate, rows: liveAssignments });
    const updatedMission = await db.transaction(async (tx) => {
      if (planningTargets.length > 0 || assignmentProvided || datesChanged) {
        // Même ordre que POST /:id/assignments : ligne mission d'abord, verrous consultatifs ensuite
        // (l'ordre inverse interbloquerait un PATCH et un ajout d'affectation sur la même mission).
        await tx.select({ id: missions.id }).from(missions).where(eq(missions.id, missionId)).for("update");
        // Les décisions ci-dessus reposent sur une lecture antérieure : périmée, on refuse plutôt que de
        // contrôler l'ancienne paire.
        await assertPlanningStateUnchanged(tx, missionId, (s) => !isVoidAssignmentStatus(s), readKey);
        await lockPlanningPairs(tx, planningTargets);
      }
      for (const target of planningTargets) {
        const clash = await findPlanningClash(tx, {
          missionId,
          pickupDate: effectivePickup,
          deliveryDate: effectiveDelivery,
          vehicleId: target.vehicleId,
          driverId: target.driverId,
        });
        if (clash) throw new AppError(409, planningClashMessage(clash));
      }
      if (writeAssignment) await writeAssignment(tx);
      if (hasBudgetPatch) {
        const current = await lockMissionWorkflowData(tx, missionId);
        missionUpdates.workflowData = mergeMissionBudgetPlan(current?.workflowData ?? existingMission.workflowData, budgetPatch);
      }
      const [row] = await tx
        .update(missions)
        .set(missionUpdates)
        .where(eq(missions.id, missionId))
        .returning();
      return row;
    });

    await broadcastMissionUpdate("mission_updated", updatedMission as unknown as Record<string, unknown>, {
      source: "mission_edit",
    }, req.requestId);

    return res.json(updatedMission);
  } catch (error) {
    // Une AppError (409 plusieurs chauffeurs, 403…) garde son statut ; le reste devient une 5xx normalisée.
    if (!(error instanceof AppError)) log.error({ err: error, requestId: req.requestId }, "Update mission error");
    next(error);
  }
});

const addAssignmentSchema = z.object({
  vehicleId: idSchema,
  driverId: idSchema,
});

const editionBlockedMessage = (status: string) => `Mission ${status === "completed" ? "terminée" : "annulée"} : édition bloquée.`;

// POST /api/missions/:id/assignments - Ajouter un chauffeur (et son véhicule) à la mission.
// Une mission peut avoir plusieurs chauffeurs (#227) ; le PATCH ne sait remplacer qu'une affectation.
// Mêmes rôles que l'affectation par PATCH (MISSION_MANAGER_ROLES). La ligne mission est verrouillée
// (FOR UPDATE) : deux ajouts concurrents du même chauffeur se serrent, le second voit le premier et reçoit 409.
router.post("/:id/assignments", authorize([...MISSION_MANAGER_ROLES]), validateBody(addAssignmentSchema), async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);
    assertValidDbId(missionId, "ID mission invalide.");
    const { vehicleId, driverId } = req.body as z.infer<typeof addAssignmentSchema>;
    assertValidDbId(vehicleId, "Affectation invalide (véhicule/chauffeur).");
    assertValidDbId(driverId, "Affectation invalide (véhicule/chauffeur).");

    const result = await db.transaction(async (tx) => {
      const [mission] = await tx
        .select({
          id: missions.id,
          status: missions.status,
          weight: missions.weight,
          pickupDate: missions.pickupDate,
          deliveryDate: missions.deliveryDate,
        })
        .from(missions)
        .where(eq(missions.id, missionId))
        .for("update");
      if (!mission) throw new AppError(404, "Mission non trouvée.");
      if (mission.status === "completed" || mission.status === "cancelled") {
        throw new AppError(400, editionBlockedMessage(mission.status));
      }

      const [vehicle] = await tx
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
      if (!vehicle) throw new AppError(400, "Véhicule introuvable pour l'affectation.");

      const eligibilite = getMissionEligibility({ ...vehicle, receipts: await loadOpenRenewalReceipts(vehicle.id, tx) });
      if (!eligibilite.eligible) {
        throw new AppError(400, formatEligibilityRefusal(vehicle.registrationNumber, eligibilite.blockers));
      }

      const [driver] = await tx
        .select({ id: drivers.id, firstName: drivers.firstName, lastName: drivers.lastName, cpcStatus: drivers.cpcStatus, cpcTrainingDate: drivers.cpcTrainingDate, isActive: drivers.isActive })
        .from(drivers)
        .where(eq(drivers.id, driverId))
        .limit(1);
      if (!driver) throw new AppError(400, "Chauffeur introuvable pour l'affectation.");
      if (driver.isActive === false) throw new AppError(400, "Ce chauffeur est désactivé, il ne peut pas être affecté.");
      const cpcCheck = getDriverCpcEligibility(driver);
      if (!cpcCheck.eligible) {
        throw new AppError(400, `CPC invalide pour ${driver.firstName} ${driver.lastName} : ${cpcCheck.reason}`);
      }

      const missionWeight = mission.weight !== null && mission.weight !== undefined ? Number(mission.weight) : null;
      const vehicleTonnage = vehicle.tonnage !== null && vehicle.tonnage !== undefined ? Number(vehicle.tonnage) : null;
      if (missionWeight !== null && vehicleTonnage !== null && !Number.isNaN(missionWeight) && !Number.isNaN(vehicleTonnage) && missionWeight > vehicleTonnage) {
        throw new AppError(400, `Charge incompatible : ${missionWeight}T > tonnage véhicule ${vehicle.registrationNumber} (${vehicleTonnage}T).`);
      }

      const [already] = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(and(eq(assignments.missionId, missionId), eq(assignments.driverId, driverId), inArray(assignments.status, [...ACTIVE_ASSIGNMENT_STATUSES])))
        .limit(1);
      if (already) throw new AppError(409, "Ce chauffeur est déjà affecté à cette mission.");

      // Conflit de planning (même règle que le lancement) : chaque chauffeur et chaque véhicule ajouté.
      await lockPlanningResources(tx, vehicleId, driverId);
      const clash = await findPlanningClash(tx, {
        missionId,
        pickupDate: mission.pickupDate,
        deliveryDate: mission.deliveryDate,
        vehicleId,
        driverId,
      });
      if (clash) throw new AppError(409, planningClashMessage(clash));

      const [assignment] = await tx.insert(assignments).values({ missionId, vehicleId, driverId, status: "pending" }).returning();
      const [updatedMission] =
        mission.status === "planned"
          ? await tx.update(missions).set({ status: "assigned", updatedAt: new Date() }).where(eq(missions.id, missionId)).returning()
          : await tx.select().from(missions).where(eq(missions.id, missionId));
      return { assignment, mission: updatedMission };
    });

    // Après le commit : trame complète au personnel, trame réduite aux chauffeurs affectés (portée nominative).
    await broadcastMissionUpdate("mission_updated", result.mission as unknown as Record<string, unknown>, { source: "mission_assignment_added", assignmentId: result.assignment.id }, req.requestId);
    return res.status(201).json(result.assignment);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/missions/:id/assignments/:assignmentId - Annuler l'affectation d'un chauffeur.
// Pas de suppression physique : la ligne passe à `cancelled` (l'historique carburant et les trames en dépendent).
// Le chauffeur perd aussitôt le droit de saisie (activeDriverAssignmentsOnMission ne compte que les actives).
router.delete("/:id/assignments/:assignmentId", authorize([...MISSION_MANAGER_ROLES]), async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);
    const assignmentId = parseRouteId(req.params.assignmentId, "ID affectation invalide.");

    const result = await db.transaction(async (tx) => {
      const [mission] = await tx
        .select({ id: missions.id, status: missions.status })
        .from(missions)
        .where(eq(missions.id, missionId))
        .for("update");
      if (!mission) throw new AppError(404, "Mission non trouvée.");
      if (mission.status === "completed" || mission.status === "cancelled") {
        throw new AppError(400, editionBlockedMessage(mission.status));
      }
      const [assignment] = await tx
        .select()
        .from(assignments)
        .where(and(eq(assignments.id, assignmentId), eq(assignments.missionId, missionId)))
        // Verrou de ligne : un démarrage concurrent (pending -> in_progress) attend la fin de l'annulation.
        .for("update");
      if (!assignment) throw new AppError(404, "Affectation non trouvée sur cette mission.");
      // Déjà annulée ou refusée : rien à faire. Un refus reste un refus, il n'est pas réécrit en annulation.
      if (isVoidAssignmentStatus(assignment.status)) return { assignment, mission: undefined, changed: false };
      if (assignment.status === "in_progress" || assignment.status === "completed") {
        throw new AppError(409, "Cette affectation est déjà démarrée ou terminée : elle ne peut plus être annulée.");
      }

      const [cancelled] = await tx
        .update(assignments)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(and(eq(assignments.id, assignmentId), eq(assignments.status, assignment.status)))
        .returning();
      const stillActive = await tx
        .select({ id: assignments.id })
        .from(assignments)
        .where(and(eq(assignments.missionId, missionId), inArray(assignments.status, [...ACTIVE_ASSIGNMENT_STATUSES])))
        .limit(1);
      const [updatedMission] =
        stillActive.length === 0 && mission.status === "assigned"
          ? await tx.update(missions).set({ status: "planned", updatedAt: new Date() }).where(eq(missions.id, missionId)).returning()
          : await tx.select().from(missions).where(eq(missions.id, missionId));
      return { assignment: cancelled, mission: updatedMission, changed: true };
    });

    // L'annulation est rejouable : une seconde demande ne rediffuse rien. Le chauffeur annulé reçoit la trame
    // (son affectation reste une ligne de la mission) et resynchronise son écran, qui ne l'affiche plus actif.
    if (result.changed && result.mission) {
      await broadcastMissionUpdate("mission_updated", result.mission as unknown as Record<string, unknown>, { source: "mission_assignment_cancelled", assignmentId }, req.requestId);
    }
    return res.json(result.assignment);
  } catch (error) {
    next(error);
  }
});

// PUT /api/missions/:id/status - Mettre à jour le statut d'une mission
router.put("/:id/status", authorize([...MISSION_STATUS_ROLES]), async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);
    const { status, actualFdrCost: actualFdrCostBody } = req.body || {};
    const targetStatus = String(status || "").trim();

    if (!targetStatus) {
      return res.status(400).json({ message: "Le statut est requis" });
    }

    if (!Object.prototype.hasOwnProperty.call(MISSION_STATUS_TRANSITIONS, targetStatus)) {
      return res.status(400).json({ message: "Statut mission invalide." });
    }

    // Le chauffeur affecté démarre et livre ; clôture et annulation restent aux gestionnaires.
    if (!canRoleSetMissionStatus(req.user?.role, targetStatus)) {
      throw new AppError(403, "Seul un gestionnaire peut clôturer ou annuler une mission.");
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

    // Une mission peut porter plusieurs affectations (un chauffeur chacune). Le statut ne s'écrit que sur
    // les lignes actives : celles du chauffeur qui agit, ou toutes pour le personnel. Une affectation annulée
    // ou refusée n'est jamais ressuscitée (elle reprendrait sa part du CA et ses droits de saisie).
    const missionAssignmentRows = await db
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
        driverCpcTrainingDate: drivers.cpcTrainingDate,
        driverLicenseExpiry: drivers.licenseExpiry,
      })
      .from(assignments)
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .leftJoin(drivers, eq(assignments.driverId, drivers.id))
      .where(eq(assignments.missionId, missionId))
      .orderBy(asc(assignments.id));

    const statusDriverScope = await driverScopeOf(req.user);
    const ownRows = statusDriverScope === undefined
      ? missionAssignmentRows
      : missionAssignmentRows.filter((r) => r.driverId !== null && statusDriverScope.includes(r.driverId));
    if (statusDriverScope !== undefined && !ownRows.some((r) => isActiveAssignmentStatus(r.status))) {
      throw new AppError(403, OUT_OF_DRIVER_SCOPE_MESSAGE);
    }
    // Livraison et clôture confirment aussi une affectation déjà terminée ; les autres statuts ne touchent
    // que les affectations actives.
    const closesAssignments = targetStatus === "delivered" || targetStatus === "completed";
    const targetAssignments = ownRows.filter(
      (r) => isActiveAssignmentStatus(r.status) || (closesAssignments && r.status === "completed"),
    );
    const missionAssignment = targetAssignments[0] ?? null;

    if (targetStatus === "assigned") {
      if (!targetAssignments.some((r) => r.vehicleId && r.driverId)) {
        return res.status(400).json({
          message: "Affectation requise: assignez d'abord un véhicule et un chauffeur.",
        });
      }
    }

    if (targetStatus === "in_progress") {
      const launchErrors: string[] = [];

      // Contrôles de lancement sur chaque affectation lancée : un second camion non conforme ou un second
      // chauffeur sans CPC ne part pas sous couvert du premier. Avec plusieurs affectations, chaque motif
      // porte l'immatriculation concernée.
      if (targetAssignments.length === 0) {
        launchErrors.push("Affectation incomplète (véhicule + chauffeur requis).");
      }
      for (const row of targetAssignments) {
        if (!row.vehicleId || !row.driverId) {
          launchErrors.push("Affectation incomplète (véhicule + chauffeur requis).");
          continue;
        }
        const rowErrors: string[] = [];
          if (row.vehicleStatus !== "operational") {
            rowErrors.push(
              `Véhicule ${row.vehicleRegistration || ""} non opérationnel (${row.vehicleStatus}).`,
            );
          }

          if (!row.driverIsActive) {
            rowErrors.push("Chauffeur inactif.");
          }

          const rowCpc = getDriverCpcEligibility({
            cpcStatus: row.driverCpcStatus,
            cpcTrainingDate: row.driverCpcTrainingDate,
          });
          if (!rowCpc.eligible) {
            rowErrors.push(rowCpc.reason ?? "CPC chauffeur non valide.");
          }

          if (row.driverLicenseExpiry && isDriverLicenseExpired(row.driverLicenseExpiry)) {
            rowErrors.push("Permis chauffeur expiré.");
          }

          const docs = await db
            .select({
              type: vehicleDocuments.type,
              expiryDate: vehicleDocuments.expiryDate,
            })
            .from(vehicleDocuments)
            .where(eq(vehicleDocuments.vehicleId, row.vehicleId));

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
          // comme dans getMissionEligibility). Valable le jour J, expirée à J+1 ; le jour
          // courant est la date UTC (expiry-day.ts).
          // Récépissé provisoire valable : il lève l'échéance dépassée d'un papier présent,
          // jamais un papier manquant (même règle que getMissionEligibility).
          const receipts = await loadOpenRenewalReceipts(row.vehicleId);
          const expiredWithoutReceipt = (
            expiryDate: Date | string,
            code: "insurance" | "technical_inspection" | "license_plate",
          ) => isPaperExpired(expiryDate) && !isRenewalReceiptValid(receipts, code);

          let carteGriseErreur = false;
          if (!carteGrise) {
            rowErrors.push("Carte grise manquante.");
          } else if (carteGrise.expiryDate && expiredWithoutReceipt(carteGrise.expiryDate, "license_plate")) {
            rowErrors.push("Carte grise expirée.");
            carteGriseErreur = true;
          }

          const assuranceErreur = !assurance || !assurance.expiryDate || expiredWithoutReceipt(assurance.expiryDate, "insurance");
          if (assuranceErreur) {
            rowErrors.push("Assurance manquante ou expirée.");
          }

          const visiteErreur = !visiteTechnique || !visiteTechnique.expiryDate || expiredWithoutReceipt(visiteTechnique.expiryDate, "technical_inspection");
          if (visiteErreur) {
            rowErrors.push("Visite technique manquante ou expirée.");
          }

          // Règle unique d'éligibilité, la même qu'à l'affectation : couvre les
          // colonnes miroir de `vehicles` (assurance, visite, plaque). L'état
          // mécanique est déjà refusé plus haut ; on n'ajoute que les motifs de
          // conformité qui ne sont pas déjà énoncés.
          const eligibilite = getMissionEligibility({
            status: row.vehicleStatus,
            insuranceExpiry: row.vehicleInsuranceExpiry,
            technicalInspectionDate: row.vehicleTechnicalInspectionDate,
            licensePlateExpiry: row.vehicleLicensePlateExpiry,
            receipts,
          });
          for (const blocker of eligibilite.blockers) {
            if (blocker.kind !== "compliance") continue;
            if (blocker.code === "insurance" && assuranceErreur) continue;
            if (blocker.code === "technical_inspection" && visiteErreur) continue;
            if (blocker.code === "license_plate" && carteGriseErreur) continue;
            rowErrors.push(`${blocker.reason.charAt(0).toUpperCase()}${blocker.reason.slice(1)}.`);
          }

          if (mission.pickupDate && mission.deliveryDate) {
            const hasOverlap =
              (await findPlanningClash(db, {
                missionId: mission.id,
                pickupDate: mission.pickupDate,
                deliveryDate: mission.deliveryDate,
                vehicleId: row.vehicleId,
                driverId: row.driverId,
              })) !== null;

            if (hasOverlap) {
              rowErrors.push("Conflit planning détecté sur ce véhicule ou ce chauffeur.");
            }
          }
        const prefix = targetAssignments.length > 1 ? `Véhicule ${row.vehicleRegistration || row.vehicleId} : ` : "";
        launchErrors.push(...rowErrors.map((motif) => `${prefix}${motif}`));
      }

      if (targetAssignments.length > 0) {
        const { plan: missionBudgetPlan, missingDetail: launchBudgetMissing, fuelShortfallMotif } = await resolveLaunchBudget(missionId, extractMissionBudgetPlan(mission.workflowData, mission.estimatedFuelCost), req.user?.role);
        const fuelBudget = missionBudgetPlan.fuelBudget;
        const roadExpensesBudget = missionBudgetPlan.roadExpensesBudget;
        const contingencyBudget = missionBudgetPlan.contingencyBudget;

        if (fuelBudget === null || !Number.isFinite(fuelBudget) || fuelBudget <= 0) {
          launchErrors.push(launchBudgetMissing ?? "Budget carburant non renseigné.");
        } else {
          const fuelBalance = await fuelCardService.getCurrentBalance();
          if (fuelBalance.balance < fuelBudget) {
            launchErrors.push(
              fuelShortfallMotif(fuelBalance.balance, fuelBudget),
            );
          }
        }

        if (!launchBudgetMissing && (roadExpensesBudget === null || !Number.isFinite(roadExpensesBudget) || roadExpensesBudget < 0)) {
          launchErrors.push("Budget frais de route (FDR) non renseigné.");
        }

        if (!launchBudgetMissing && (contingencyBudget === null || !Number.isFinite(contingencyBudget) || contingencyBudget < 0)) {
          launchErrors.push("Budget imprévus non renseigné.");
        }
      }

      if (launchErrors.length > 0) {
        // Les motifs vont dans le message, sans `fieldErrors` (le gestionnaire central remplacerait alors le message).
        // `details.motifs` garde la liste complète : le message est borné et peut taire un motif, or l'écran
        // en tire l'action « Créer demande de renouvellement » (document manquant ou expiré).
        throw new AppError(400, launchRefusalMessage(launchErrors, { forDriver: statusDriverScope !== undefined }), {
          details: { motifs: launchErrors },
        });
      }
    }

    const now = new Date();
    // FDR réels à écrire à la clôture : validés ici, fusionnés plus bas dans workflowData relu sous verrou.
    let actualFdrCost: number | null = null;

    if (targetStatus === "completed") {
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
    }

    const needsExecutionDate = targetStatus === "in_progress" || targetStatus === "delivered" || targetStatus === "completed";
    // Devenir « planned » ou « assigned » rend la mission active : ses affectations ne doivent pas
    // chevaucher une autre mission active (même règle et même verrou que la création, le PATCH et l'ajout).
    const claimsSlot = targetStatus === "planned" || targetStatus === "assigned";
    const readKey = planningStateKey({
      pickupDate: mission.pickupDate,
      deliveryDate: mission.deliveryDate,
      rows: missionAssignmentRows.filter((r) => isActiveAssignmentStatus(r.status)),
    });
    const updatedMission = await db.transaction(async (tx) => {
      if (claimsSlot) {
        // Ligne mission d'abord, verrous consultatifs ensuite : même ordre que POST /:id/assignments et PATCH.
        await tx.select({ id: missions.id }).from(missions).where(eq(missions.id, missionId)).for("update");
        // Affectations et créneau lus avant la transaction : refus si un PATCH concurrent est passé entre-temps.
        await assertPlanningStateUnchanged(tx, missionId, isActiveAssignmentStatus, readKey);
        const pairs = targetAssignments.flatMap((row) => (row.vehicleId && row.driverId ? [{ vehicleId: row.vehicleId, driverId: row.driverId }] : []));
        await lockPlanningPairs(tx, pairs);
        for (const row of targetAssignments) {
          if (!row.vehicleId || !row.driverId) continue;
          const clash = await findPlanningClash(tx, {
            missionId,
            pickupDate: mission.pickupDate,
            deliveryDate: mission.deliveryDate,
            vehicleId: row.vehicleId,
            driverId: row.driverId,
          });
          if (clash) throw new AppError(409, planningClashMessage(clash));
        }
      }
      // Patch de workflowData appliqué à la version relue sous verrou de ligne, jamais à la copie lue en
      // tête de requête : une régularisation de plein validée entre-temps n'est plus effacée. Sans patch,
      // workflowData n'est pas réécrit du tout.
      let nextWorkflowData: Record<string, unknown> | undefined;
      if (needsExecutionDate || actualFdrCost !== null) {
        const current = await lockMissionWorkflowData(tx, missionId);
        const workflowDataForStatus = asPlainObject(current?.workflowData) ?? {};
        const executionData = asPlainObject(workflowDataForStatus.execution) ?? {};
        let hasWorkflowDataPatch = false;

        if (targetStatus === "in_progress" && !toIsoIfValid(executionData.actualStartDate)) {
          executionData.actualStartDate = now.toISOString();
          hasWorkflowDataPatch = true;
        }

        if ((targetStatus === "delivered" || targetStatus === "completed") && !toIsoIfValid(executionData.actualDeliveryDate)) {
          executionData.actualDeliveryDate = now.toISOString();
          hasWorkflowDataPatch = true;
        }

        let merged: Record<string, unknown> = hasWorkflowDataPatch
          ? { ...workflowDataForStatus, execution: executionData }
          : workflowDataForStatus;
        if (actualFdrCost !== null) {
          merged = mergeMissionActualFdrCost(merged, actualFdrCost);
          hasWorkflowDataPatch = true;
        }
        if (hasWorkflowDataPatch) nextWorkflowData = merged;
      }

      const [row] = await tx
        .update(missions)
        .set({
          status: targetStatus as any,
          updatedAt: now,
          currentStep: targetStatus === "in_progress"
            ? Math.max(Number(mission.currentStep || 1), 3)
            : mission.currentStep,
          completedAt: targetStatus === "completed" && currentStatus !== "completed" ? now : undefined,
          cancelledAt: targetStatus === "cancelled" && currentStatus !== "cancelled" ? now : undefined,
          workflowData: nextWorkflowData,
        })
        // Conditionné au statut lu : une transition concurrente passée entre-temps fait refuser celle-ci.
        .where(and(eq(missions.id, missionId), eq(missions.status, currentStatus)))
        .returning();
      if (!row) throw new AppError(409, "Le statut de cette mission a changé entre-temps : rechargez-la.");
      await onMissionStatusChange(tx, missionId, targetStatus, req.user?.id ?? null);
      // Une écriture par affectation visée, conditionnée au statut lu : une ligne annulée entre-temps
      // (DELETE concurrent) n'est pas ressuscitée.
      for (const target of targetAssignments) {
        const assignmentUpdate: Record<string, unknown> = { updatedAt: now };
        if (targetStatus === "assigned") {
          assignmentUpdate.status = "accepted";
          assignmentUpdate.acceptedAt = target.acceptedAt || now;
        }
        if (targetStatus === "in_progress") {
          assignmentUpdate.status = "in_progress";
          assignmentUpdate.acceptedAt = target.acceptedAt || now;
          assignmentUpdate.startedAt = target.startedAt || now;
        }
        if (targetStatus === "delivered") {
          assignmentUpdate.status = "completed";
          assignmentUpdate.acceptedAt = target.acceptedAt || now;
          assignmentUpdate.startedAt = target.startedAt || now;
          assignmentUpdate.completedAt = target.completedAt || now;
        }
        if (targetStatus === "completed") {
          assignmentUpdate.status = "completed";
          assignmentUpdate.completedAt = target.completedAt || now;
        }
        if (targetStatus === "cancelled") {
          assignmentUpdate.status = "cancelled";
        }
        if (Object.keys(assignmentUpdate).length > 1) {
          await tx
            .update(assignments)
            .set(assignmentUpdate)
            .where(and(eq(assignments.id, target.id), eq(assignments.status, target.status)));
        }
      }

      return row;
    });

    await broadcastMissionUpdate(
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
      req.requestId,
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

    return res.json(redactMissionBudget(req.user, redactMissionPrice(req.user, {
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
    })));
  } catch (error) {
    if (error instanceof AppError) return next(error);
    log.error({ err: error, requestId: req.requestId }, "Update mission status error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// GET /api/missions/:id/document-renewal-requests - Lister les demandes documentaires ouvertes pour cette mission
router.get("/:id/document-renewal-requests", async (req, res) => {
  try {
    const missionId = parseMissionId(req.params.id);

    const renewalScope = await driverScopeOf(req.user);
    const liveAssignmentOn =
      renewalScope === undefined
        ? notInArray(assignments.status, [...VOID_ASSIGNMENT_STATUSES])
        : driverLiveAssignmentFilter(renewalScope);

    // Fetch mission + vehicle to scope requests
    const [mission] = await db
      .select({
        id: missions.id,
        orderNumber: missions.orderNumber,
        vehicleId: assignments.vehicleId,
      })
      .from(missions)
      .leftJoin(assignments, and(eq(assignments.missionId, missions.id), liveAssignmentOn))
      .where(eq(missions.id, missionId))
      .orderBy(asc(assignments.id))
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
    log.error({ err: error, requestId: req.requestId }, "Get mission document renewal requests error");
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

// POST /api/missions/:id/document-renewal-requests - Créer des demandes documentaires depuis un blocage mission
router.post("/:id/document-renewal-requests", async (req, res, next) => {
  try {
    const missionId = parseMissionId(req.params.id);

    const actorId = typeof req.session?.userId === "number" ? req.session.userId : null;
    const actorRole = String(req.user?.role || "").trim().toLowerCase();
    const allowedRequesterRoles = new Set(["admin", "logistics", "workshop_manager", "secretary"]);

    if (!actorId) {
      return res.status(401).json({ message: "Session invalide. Veuillez vous reconnecter." });
    }

    if (!allowedRequesterRoles.has(actorRole)) {
      throw new AppError(403, "Accès refusé: seuls Admin, Secrétaire, Logisticien et Chef d'atelier peuvent créer cette demande.");
    }

    const renewalScope = await driverScopeOf(req.user);
    const liveAssignmentOn =
      renewalScope === undefined
        ? notInArray(assignments.status, [...VOID_ASSIGNMENT_STATUSES])
        : driverLiveAssignmentFilter(renewalScope);

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
      .leftJoin(assignments, and(eq(assignments.missionId, missions.id), liveAssignmentOn))
      .leftJoin(vehicles, eq(assignments.vehicleId, vehicles.id))
      .where(eq(missions.id, missionId))
      .orderBy(asc(assignments.id))
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

    await broadcastMissionUpdate("mission_updated", mission as unknown as Record<string, unknown>, {
      source: "mission_document_renewal_request",
      missionId: mission.id,
      requestedDocumentTypes: targetDocTypes,
      requestCount: created.length,
    }, req.requestId);

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
    next(withLogContext(error, { event: "Create mission document renewal request error" }));
  }
});

export default router;
