import { useEffect, useState } from "react";
import { missionPricePath } from "@shared/contracts/mission-price";
import type { QueryKey } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { invalidateDriverCpcDependents } from "@/lib/driver-cpc-invalidation";
import { appToast, invalidateAlertQueries } from "@/lib/app-toast";
import { triggerNativeNotification } from "@/lib/native-mobile";
import { KPI_QUERY_KEYS, REALTIME_EVENTS, type RealtimeEventName } from "@shared/contracts/realtime-events";
import { satelliteTargetsOf, type SatellitePayload } from "@/lib/realtime-satellites";
import { setOfflineResyncHandler, whenReplaySettled } from "@/lib/offline-replay-gate";

/** Couche 3, écrans satellites : groupes déclarés pour l'événement (`client/src/lib/realtime-satellites.ts`). */
function invalidateSatellites(event: string, payload?: SatellitePayload): void {
  const { keys, prefixes } = satelliteTargetsOf(event, payload);
  for (const key of keys) queryClient.invalidateQueries({ queryKey: [key] });
  if (prefixes.length > 0) {
    queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && prefixes.some((prefix) => first.startsWith(prefix));
      },
    });
  }
}

/** Couche 3 des événements du lot : invalide les clés déclarées au catalogue (`invalidates`). */
function invalidateCatalogEvent(name: RealtimeEventName): void {
  for (const key of REALTIME_EVENTS[name].invalidates) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export type RealtimeScope =
  | { type: "broadcast" }
  | { type: "user"; userIds: number[] }
  | { type: "roles"; roles: string[] };

export interface RealtimeActor {
  userId?: number | null;
  role?: string | null;
  username?: string | null;
}

export interface RealTimeUpdate {
  eventId?: string;
  version?: number;
  type: string;
  entity?: string;
  entityId?: number | string | null;
  payload?: unknown;
  scope?: RealtimeScope;
  actor?: RealtimeActor | null;
  correlationId?: string | null;
  causationId?: string | null;
  tenantId?: string | null;
  emittedAt?: string;
  // Compat rétro
  data?: unknown;
  timestamp?: string;
}

interface RealtimeSnapshot {
  isConnected: boolean;
  isSocketOpen: boolean;
  isReady: boolean;
  lastUpdate: Date;
  lastResyncAt: Date | null;
  reconnectAttempt: number;
}

const MAX_TRACKED_EVENT_IDS = 1000;
const EVENT_ID_TTL_MS = 10 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 65_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RESYNC_DEBOUNCE_MS = 2_500;
const PERIODIC_RESYNC_INTERVAL_MS = 60_000;
const CRITICAL_RESYNC_KEYS: string[] = [
  "/api/work-orders",
  "/api/work-orders/statistics",
  "/api/vehicles",
  "/api/dashboard/technician-stats",
  "/api/technician/my-work-orders",
  "/api/alerts",
  "/api/alerts/count",
  "/api/clients",
  "/api/clients/all",
  "/api/operations/stats/by-client",
  "/api/operations/stats/by-destination",
  "/api/operations/missions/by-client",
  "/api/operations/missions/active",
  "/api/operations/missions/upcoming",
  "/api/missions",
  "/api/drivers/me",
  "/api/part-requirements",
  "/api/work-orders/awaiting-parts",
  "/api/supplier-invoices",
  "/api/supplier-invoices/statistics",
  "/api/supplier-invoices/overdue",
  "/api/supplier-invoices/discrepancies",
  "/api/purchase-orders",
  "/api/purchase-orders/statistics",
  "/api/purchase-orders/overdue",
  "/api/suppliers",
  "/api/suppliers/top",
  "/api/suppliers/summary",
  "/api/billing/invoices",
  "/api/billing/invoices/summary",
  "/api/billing/statistics",
  "/api/fuel-records",
  "/api/fuel-card/balance",
  "/api/fuel-card/history",
  "/api/fuel-vouchers",
  "/api/fuel-card/anomalies",
  "/api/fuel-card/anomalies/summary",
  // Pneus: écran partagé magasin/atelier, sans `refetchInterval` propre.
  // Sans ces clés, une coupure du WebSocket laissait la page figée jusqu'au
  // rechargement manuel.
  "/api/tires",
  "/api/tires/low-stock",
  "/api/tires/statistics-advanced",
  "/api/vehicle-tires",
  "/api/warehouse/reorder-alerts",
  "/api/warehouse/statistics",
  "/api/warehouse/stock-value-history",
  "/api/drivers",
  "/api/drivers/cpc-statistics",
  "/api/vehicles/document-stats",
  "/api/vehicles/expiring-docs",
  "/api/vehicles/expired-docs",
  "/api/vehicles/documents/all",
  "/api/document-renewals/requests",
  "/api/document-renewals/centers",
  "/api/maintenance/date-alerts",
];

let socket: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
let heartbeatInterval: ReturnType<typeof setInterval> | undefined;
let reconnectAttempt = 0;
let manualClose = false;
let currentUserId: number | undefined;
let lastPongAt = 0;
let networkListenersBound = false;
let lastResyncAtMs = 0;
let periodicResyncInterval: ReturnType<typeof setInterval> | undefined;

const listeners = new Set<(snapshot: RealtimeSnapshot) => void>();
const seenEventTimestamps = new Map<string, number>();
const seenEventQueue: Array<{ id: string; seenAt: number }> = [];

let snapshot: RealtimeSnapshot = {
  isConnected: false,
  isSocketOpen: false,
  isReady: false,
  lastUpdate: new Date(),
  lastResyncAt: null,
  reconnectAttempt: 0,
};

function emitSnapshot(patch: Partial<RealtimeSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener(snapshot));
}

function isOnline(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return navigator.onLine !== false;
}

function shouldConnect(): boolean {
  return listeners.size > 0 && typeof currentUserId === "number" && isOnline();
}

function clearTimers(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = undefined;
  }
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = undefined;
  }
}

function ensurePeriodicResync(): void {
  if (periodicResyncInterval) {
    return;
  }

  periodicResyncInterval = setInterval(() => {
    if (listeners.size === 0 || !currentUserId || !isOnline()) {
      return;
    }

    const isSocketReady = Boolean(
      socket && socket.readyState === WebSocket.OPEN && snapshot.isReady,
    );
    if (isSocketReady) {
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      connectSocket();
    }

    resyncCriticalData("periodic_fallback");
  }, PERIODIC_RESYNC_INTERVAL_MS);
}

function clearPeriodicResync(): void {
  if (periodicResyncInterval) {
    clearInterval(periodicResyncInterval);
    periodicResyncInterval = undefined;
  }
}

function markEventSeen(eventId?: string): boolean {
  if (!eventId) {
    return true;
  }
  const now = Date.now();
  const existingTimestamp = seenEventTimestamps.get(eventId);

  if (typeof existingTimestamp === "number" && now - existingTimestamp <= EVENT_ID_TTL_MS) {
    return false;
  }

  seenEventTimestamps.set(eventId, now);
  seenEventQueue.push({ id: eventId, seenAt: now });

  while (seenEventQueue.length > 0) {
    const oldest = seenEventQueue[0];
    const shouldEvictByCount = seenEventQueue.length > MAX_TRACKED_EVENT_IDS;
    const shouldEvictByTtl = now - oldest.seenAt > EVENT_ID_TTL_MS;
    if (!shouldEvictByCount && !shouldEvictByTtl) {
      break;
    }
    seenEventQueue.shift();
    const currentTimestamp = seenEventTimestamps.get(oldest.id);
    if (currentTimestamp === oldest.seenAt) {
      seenEventTimestamps.delete(oldest.id);
    }
  }

  return true;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function toNumericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function getWorkOrderId(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return toNumber(record.id);
}

function extractWorkOrderFromPayload(payload: unknown): Record<string, unknown> | null {
  const payloadRecord = asRecord(payload);
  if (!payloadRecord) {
    return null;
  }

  const nestedWorkOrder = asRecord(payloadRecord.workOrder);
  if (nestedWorkOrder && getWorkOrderId(nestedWorkOrder)) {
    return nestedWorkOrder;
  }

  if (getWorkOrderId(payloadRecord)) {
    return payloadRecord;
  }

  return null;
}

function isWorkOrderAssignmentUpdate(payload: unknown): boolean {
  const payloadRecord = asRecord(payload);
  if (!payloadRecord) {
    return false;
  }
  const updates = asRecord(payloadRecord.updates);
  if (!updates || !("technicianId" in updates)) {
    return false;
  }
  const technicianId = toNumericId(updates.technicianId);
  return technicianId !== null && technicianId > 0;
}

function getMissionId(value: unknown): number | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return toNumber(record.id);
}

function extractMissionFromPayload(payload: unknown): Record<string, unknown> | null {
  const payloadRecord = asRecord(payload);
  if (!payloadRecord) {
    return null;
  }

  const nestedMission = asRecord(payloadRecord.mission);
  if (nestedMission && getMissionId(nestedMission)) {
    return nestedMission;
  }

  if (getMissionId(payloadRecord)) {
    return payloadRecord;
  }

  return null;
}

function patchVehicleDocumentInCacheData(
  currentData: unknown,
  patch: {
    id: number;
    vehicleId?: number | null;
    type?: string | null;
    expiryDate?: string | null;
  },
): unknown {
  if (!Array.isArray(currentData)) {
    return currentData;
  }

  return currentData.map((item) => {
    const typed = asRecord(item);
    if (!typed) {
      return item;
    }

    const itemId = toNumericId(typed.id);
    if (itemId !== patch.id) {
      return item;
    }

    const next: Record<string, unknown> = { ...typed };
    if (patch.vehicleId) next.vehicleId = patch.vehicleId;
    if (patch.type) next.type = patch.type;
    if (patch.expiryDate) next.expiryDate = patch.expiryDate;
    return next;
  });
}

function patchVehicleMasterExpiryInCacheData(
  currentData: unknown,
  documentType: string,
  expiryDate: string,
): unknown {
  const typed = asRecord(currentData);
  if (!typed) {
    return currentData;
  }

  const next: Record<string, unknown> = { ...typed };
  if (documentType === "carte_grise") next.licensePlateExpiry = expiryDate;
  if (documentType === "assurance") next.insuranceExpiry = expiryDate;
  if (documentType === "visite_technique") next.technicalInspectionDate = expiryDate;
  return next;
}

function isKeyWithFilters(queryKey: QueryKey): boolean {
  if (!Array.isArray(queryKey)) {
    return false;
  }
  const params = queryKey[1];
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return false;
  }
  const typedParams = params as Record<string, unknown>;
  return Boolean(
    typedParams.search ||
      typedParams.status ||
      typedParams.priority ||
      typedParams.vehicleId,
  );
}

function upsertWorkOrderInCacheData(
  currentData: unknown,
  workOrder: Record<string, unknown>,
  insertIfMissing: boolean,
): unknown {
  if (!currentData) {
    return currentData;
  }

  const workOrderId = getWorkOrderId(workOrder);
  if (!workOrderId) {
    return currentData;
  }

  if (Array.isArray(currentData)) {
    const index = currentData.findIndex((item) => getWorkOrderId(item) === workOrderId);
    if (index >= 0) {
      const next = [...currentData];
      const previousItem = asRecord(next[index]) ?? {};
      next[index] = { ...previousItem, ...workOrder };
      return next;
    }
    if (insertIfMissing) {
      return [workOrder, ...currentData];
    }
    return currentData;
  }

  const typedData = asRecord(currentData);
  if (typedData) {
    const currentWorkOrders = typedData.workOrders;
    if (Array.isArray(currentWorkOrders)) {
      const index = currentWorkOrders.findIndex((item) => getWorkOrderId(item) === workOrderId);
      if (index >= 0) {
        const nextOrders = [...currentWorkOrders];
        const previousItem = asRecord(nextOrders[index]) ?? {};
        nextOrders[index] = { ...previousItem, ...workOrder };
        return { ...typedData, workOrders: nextOrders };
      }
      if (insertIfMissing) {
        const total = typeof typedData.total === "number" ? typedData.total + 1 : currentWorkOrders.length + 1;
        return {
          ...typedData,
          workOrders: [workOrder, ...currentWorkOrders],
          total,
        };
      }
    }
  }

  return currentData;
}

/**
 * Fusion d'une mission reçue en temps réel dans le cache. La trame ne porte pas les montants du budget (Q19,
 * `omitMissionBudget`) : `workflowData.budgetPlan` absent de la trame garde la valeur déjà en cache, que la
 * relecture de `/api/missions` et `/api/missions/:id` met ensuite à jour pour un rôle lecteur.
 */
export function mergeMissionPatch(previous: Record<string, unknown>, mission: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...previous, ...mission };
  const previousWorkflow = asRecord(previous.workflowData);
  const nextWorkflow = asRecord(mission.workflowData);
  if (previousWorkflow && nextWorkflow && "budgetPlan" in previousWorkflow && !("budgetPlan" in nextWorkflow)) {
    merged.workflowData = { ...nextWorkflow, budgetPlan: previousWorkflow.budgetPlan };
  }
  return merged;
}

function upsertMissionInCacheData(
  currentData: unknown,
  mission: Record<string, unknown>,
  insertIfMissing: boolean,
): unknown {
  if (!currentData) {
    return currentData;
  }

  const missionId = getMissionId(mission);
  if (!missionId) {
    return currentData;
  }

  if (Array.isArray(currentData)) {
    const index = currentData.findIndex((item) => getMissionId(item) === missionId);
    if (index >= 0) {
      const next = [...currentData];
      const previousItem = asRecord(next[index]) ?? {};
      next[index] = mergeMissionPatch(previousItem, mission);
      return next;
    }
    if (insertIfMissing) {
      return [mission, ...currentData];
    }
    return currentData;
  }

  const typedData = asRecord(currentData);
  if (typedData) {
    const currentMissions = typedData.missions;
    if (Array.isArray(currentMissions)) {
      const index = currentMissions.findIndex((item) => getMissionId(item) === missionId);
      if (index >= 0) {
        const nextMissions = [...currentMissions];
        const previousItem = asRecord(nextMissions[index]) ?? {};
        nextMissions[index] = mergeMissionPatch(previousItem, mission);
        return { ...typedData, missions: nextMissions };
      }
      if (insertIfMissing) {
        const total =
          typeof typedData.total === "number" ? typedData.total + 1 : currentMissions.length + 1;
        return {
          ...typedData,
          missions: [mission, ...currentMissions],
          total,
        };
      }
    }
  }

  return currentData;
}

function patchWorkOrderCaches(workOrder: Record<string, unknown>, insertIfMissing: boolean): void {
  const workOrderQueries = queryClient.getQueriesData({ queryKey: ["/api/work-orders"] });
  const workOrderId = getWorkOrderId(workOrder);

  for (const [queryKey, existingData] of workOrderQueries) {
    const canInsert = insertIfMissing && !isKeyWithFilters(queryKey);
    const nextData = upsertWorkOrderInCacheData(existingData, workOrder, canInsert);
    if (nextData !== existingData) {
      queryClient.setQueryData(queryKey, nextData);
    }
  }

  if (workOrderId) {
    const technicianId = toNumericId(workOrder.technicianId);
    const technicianName =
      typeof workOrder.technicianName === "string" ? workOrder.technicianName.trim() : "";
    const patchMissingTechnicianName = technicianId !== null && technicianId > 0 && !technicianName;

    if (patchMissingTechnicianName) {
      queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${workOrderId}`] });
    } else {
      queryClient.setQueryData([`/api/work-orders/${workOrderId}`], (previousData: unknown) => {
        const previousRecord = asRecord(previousData);
        return previousRecord ? { ...previousRecord, ...workOrder } : workOrder;
      });
    }
  }
}

function patchMissionCaches(mission: Record<string, unknown>, insertIfMissing: boolean): void {
  const missionQueries = queryClient.getQueriesData({ queryKey: ["/api/missions"] });
  const missionId = getMissionId(mission);

  for (const [queryKey, existingData] of missionQueries) {
    const canInsert = insertIfMissing && !isKeyWithFilters(queryKey);
    const nextData = upsertMissionInCacheData(existingData, mission, canInsert);
    if (nextData !== existingData) {
      queryClient.setQueryData(queryKey, nextData);
    }
  }

  if (missionId) {
    queryClient.setQueryData([`/api/missions/${missionId}`], (previousData: unknown) => {
      const previousRecord = asRecord(previousData);
      return previousRecord ? mergeMissionPatch(previousRecord, mission) : mission;
    });
  }
}

function invalidateMissionDerivedQueries(missionId?: number | null): void {
  if (typeof missionId === "number" && Number.isFinite(missionId)) {
    queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/launch-readiness`] });
    queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/document-renewal-requests`] });
    queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/fuel-records`] });
    return;
  }

  queryClient.invalidateQueries({
    predicate: (query) => {
      const firstKey = query.queryKey?.[0];
      if (typeof firstKey !== "string") {
        return false;
      }
      return /^\/api\/missions\/\d+\/(launch-readiness|document-renewal-requests|fuel-records)$/.test(firstKey);
    },
  });
}

function resyncCriticalData(reason: string, force = false): void {
  const now = Date.now();
  if (!force && now - lastResyncAtMs < RESYNC_DEBOUNCE_MS) {
    console.log(`[WS] Resync ignoré (${reason}) - debounce actif`);
    return;
  }
  lastResyncAtMs = now;

  console.log(`[WS] Resync API (${reason})`);
  emitSnapshot({ lastResyncAt: new Date(now) });

  for (const key of CRITICAL_RESYNC_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
  if (currentUserId) {
    queryClient.invalidateQueries({
      queryKey: ["/api/technician/work-orders", currentUserId],
    });
  }
}

// Un seul resync forcé après vidange de la file hors ligne (offline-queue-core, onDrained).
setOfflineResyncHandler(() => resyncCriticalData("offline_queue_drained", true));

function parseScope(scopeValue: unknown): RealtimeScope | undefined {
  const scopeRecord = asRecord(scopeValue);
  if (!scopeRecord) {
    return undefined;
  }

  const scopeType = scopeRecord.type;
  if (scopeType === "broadcast") {
    return { type: "broadcast" };
  }

  if (scopeType === "user" && Array.isArray(scopeRecord.userIds)) {
    const userIds = scopeRecord.userIds.filter((value): value is number => toNumber(value) !== null);
    if (userIds.length > 0) {
      return { type: "user", userIds };
    }
  }

  if (scopeType === "roles" && Array.isArray(scopeRecord.roles)) {
    const roles = scopeRecord.roles.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (roles.length > 0) {
      return { type: "roles", roles };
    }
  }

  return undefined;
}

function normalizeUpdate(message: unknown): RealTimeUpdate | null {
  const messageRecord = asRecord(message);
  if (!messageRecord) {
    return null;
  }

  const messageType = typeof messageRecord.type === "string" ? messageRecord.type : null;
  if (!messageType) {
    return null;
  }

  // Messages techniques non-domain (auth/ping/pong) gérés séparément
  if (messageType === "auth_success" || messageType === "pong" || messageType === "ping") {
    return null;
  }

  return {
    eventId: typeof messageRecord.eventId === "string" ? messageRecord.eventId : undefined,
    version: typeof messageRecord.version === "number" ? messageRecord.version : undefined,
    type: messageType,
    entity: typeof messageRecord.entity === "string" ? messageRecord.entity : undefined,
    entityId:
      typeof messageRecord.entityId === "number" || typeof messageRecord.entityId === "string"
        ? messageRecord.entityId
        : null,
    payload: messageRecord.payload ?? messageRecord.data,
    scope: parseScope(messageRecord.scope),
    actor: asRecord(messageRecord.actor) as RealtimeActor | null,
    correlationId:
      typeof messageRecord.correlationId === "string" ? messageRecord.correlationId : null,
    causationId:
      typeof messageRecord.causationId === "string" ? messageRecord.causationId : null,
    tenantId: typeof messageRecord.tenantId === "string" ? messageRecord.tenantId : null,
    emittedAt:
      typeof messageRecord.emittedAt === "string"
        ? messageRecord.emittedAt
        : typeof messageRecord.timestamp === "string"
          ? messageRecord.timestamp
          : undefined,
    data: messageRecord.data,
    timestamp: typeof messageRecord.timestamp === "string" ? messageRecord.timestamp : undefined,
  };
}

export function handleDomainUpdate(update: RealTimeUpdate): void {
  const payload = update.payload ?? update.data;
  const payloadRecord = asRecord(payload) ?? {};

  invalidateSatellites(update.type, payloadRecord as SatellitePayload);

  switch (update.type) {
    case "work_order_created": {
      const createdWorkOrder = extractWorkOrderFromPayload(payload);
      if (createdWorkOrder) {
        patchWorkOrderCaches(createdWorkOrder, true);
        const assignedTo =
          toNumericId(createdWorkOrder.assignedTo) ??
          toNumericId(createdWorkOrder.technicianId) ??
          toNumericId(createdWorkOrder.assignedToId);

        if (assignedTo) {
          invalidateAlertQueries();
        }

        if (currentUserId && assignedTo === currentUserId) {
          const title = typeof createdWorkOrder.title === "string" ? createdWorkOrder.title : "Intervention assignée";
          const woId = createdWorkOrder.id ? `OT #${createdWorkOrder.id} : ` : "";
          appToast({
            title: "Nouvel Ordre de Travail assigné",
            description: `${woId}${title}`,
            variant: "success",
          });
          triggerNativeNotification({
            title: "Nouvel Ordre de Travail assigné",
            body: `${woId}${title}`,
            id: Number(createdWorkOrder.id) || undefined,
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/technician/my-work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/technician-stats"] });
      if (currentUserId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/technician/work-orders", currentUserId],
        });
      }
      break;
    }

    case "work_order_updated":
    case "work_order_status_changed": {
      const updatedWorkOrder = extractWorkOrderFromPayload(payload);
      const assignmentUpdate = isWorkOrderAssignmentUpdate(payload);

      if (assignmentUpdate) {
        invalidateAlertQueries();
      }

      if (updatedWorkOrder) {
        patchWorkOrderCaches(updatedWorkOrder, false);
        const assignedTo =
          toNumericId(updatedWorkOrder.assignedTo) ??
          toNumericId(updatedWorkOrder.technicianId) ??
          toNumericId(updatedWorkOrder.assignedToId);

        // Affectation : le toast + la cloche passent par alert_created (nominatif).
        // Ici on ne duplique pas le toast pour le technicien assigné.
        if (
          currentUserId &&
          assignedTo === currentUserId &&
          update.actor?.userId !== currentUserId &&
          !assignmentUpdate
        ) {
          const title = typeof updatedWorkOrder.title === "string" ? updatedWorkOrder.title : "Intervention mise à jour";
          const woId = updatedWorkOrder.id ? `OT #${updatedWorkOrder.id} : ` : "";
          appToast({
            title: "Ordre de Travail mis à jour",
            description: `${woId}${title}`,
            variant: "info",
          });
          triggerNativeNotification({
            title: "Ordre de Travail mis à jour",
            body: `${woId}${title}`,
            id: Number(updatedWorkOrder.id) || undefined,
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/technician/my-work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/technician-stats"] });
      // Satellites du lot : tuiles KPI, historique et contrôle qualité de l'OT.
      queryClient.invalidateQueries({ queryKey: ["/api/kpi"] });
      // `["/api/kpi"]` ne couvre que la clé exacte ; chaque tuile porte sa propre clé.
      for (const key of KPI_QUERY_KEYS) queryClient.invalidateQueries({ queryKey: [key] });
      // Avis de maintenance rattachés aux missions (CDC) : l'état de l'OT les fait évoluer.
      queryClient.invalidateQueries({ queryKey: ["/api/mission-advisories"] });
      // P3-1 : la clôture d'un OT préventif avance l'échéance de son plan (aucun événement propre au plan).
      // Toutes les clés qui commencent par la route des plans, y compris `/api/maintenance-schedules/vehicle/${id}`
      // (fiche véhicule, page immatriculation, score de santé).
      queryClient.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/maintenance-schedules"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/preventive"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/date-alerts"] });
      if (currentUserId) {
        queryClient.invalidateQueries({
          queryKey: ["/api/technician/work-orders", currentUserId],
        });
      }
      break;
    }

    case "work_order_deleted":
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] });
      break;

    case "vehicle_updated":
    case "vehicle_status_changed":
      {
        const source =
          typeof payloadRecord.source === "string" ? payloadRecord.source : null;
        const vehicleId =
          toNumericId(payloadRecord.vehicleId) ??
          toNumericId(update.entityId);

        if (vehicleId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/vehicles/${vehicleId}`],
          });
          queryClient.invalidateQueries({
            queryKey: [`/api/vehicles/${vehicleId}/documents`],
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/vehicles", vehicleId, "status-history"],
          });
        }

        // Détail véhicule avec identifiant dynamique (id OU immatriculation).
        queryClient.invalidateQueries({
          predicate: (query) => {
            const [firstKey, secondKey, thirdKey] = query.queryKey ?? [];

            if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+$/.test(firstKey)) {
              return true;
            }

            if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey)) {
              return true;
            }

            if (firstKey === "/api/vehicles" && typeof secondKey === "number" && thirdKey === "status-history") {
              return true;
            }

            return false;
          },
        });

        queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vehicles/all"] });
        queryClient.invalidateQueries({ queryKey: ["/api/dashboard/technician-stats"] });

        // Si la mise à jour véhicule vient d'un renouvellement documentaire,
        // on synchronise aussi tous les KPIs conformité / alertes.
        if (
          source === "document_renewal" ||
          source === "legacy_document_patch" ||
          toNumericId(payloadRecord.documentId) !== null ||
          typeof payloadRecord.documentType === "string"
        ) {
          queryClient.invalidateQueries({ queryKey: ["/api/vehicles/documents/all"] });
          queryClient.invalidateQueries({ queryKey: ["/api/vehicles/document-stats"] });
          queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expiring-docs"] });
          queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expired-docs"] });
          queryClient.invalidateQueries({ queryKey: ["/api/document-renewals/requests"] });
          queryClient.invalidateQueries({ queryKey: ["/api/maintenance/date-alerts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
          queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
          queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });

          // Force un refetch immédiat des vues actives liées aux documents
          // (évite l'impression "ça ne bouge pas sans F5").
          void queryClient.refetchQueries({
            predicate: (query) => {
              const [firstKey] = query.queryKey ?? [];
              if (typeof firstKey !== "string") return false;
              return (
                /^\/api\/vehicles\/[^/]+$/.test(firstKey) ||
                /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey) ||
                firstKey === "/api/vehicles/documents/all" ||
                firstKey === "/api/vehicles/document-stats" ||
                firstKey === "/api/vehicles/expiring-docs" ||
                firstKey === "/api/vehicles/expired-docs" ||
                firstKey === "/api/document-renewals/requests" ||
                firstKey === "/api/maintenance/date-alerts"
              );
            },
            type: "active",
          });
        }
      }
      break;

    case "part_used_added":
    case "part_used_removed":
      {
        const workOrderId = toNumber(payloadRecord.workOrderId);
        if (workOrderId) {
        queryClient.invalidateQueries({
            queryKey: [`/api/work-orders/${workOrderId}/parts`],
        });
          queryClient.invalidateQueries({
            queryKey: [`/api/work-orders/${workOrderId}/pending-part-requirements`],
          });
          // Coût de l'OT affiché sur sa fiche.
          queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${workOrderId}`] });
        }

        const partId =
          toNumber(payloadRecord.partId) ??
          toNumber(asRecord(payloadRecord.partUsed)?.partId);
        if (partId) {
          queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}/stock-history`] });
          queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}/usage-history`] });
          queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}/work-orders`] });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/low-on-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/stock-movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/reorder-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/stock-value-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/top-consumed-parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      break;

    case "part_requirement_created":
    case "part_requirement_updated":
    case "part_requirement_deleted":
      {
        const workOrderId = toNumber(payloadRecord.workOrderId);
        if (workOrderId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/work-orders/${workOrderId}/pending-part-requirements`],
          });
          queryClient.invalidateQueries({
            queryKey: [`/api/work-orders/${workOrderId}`],
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/part-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/awaiting-parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/low-on-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/reorder-alerts"] });
      // Réception : stock et demandes du magasin.
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory-requests"] });
      break;

    // Événements du lot recette (shared/contracts/realtime-events.ts).
    case "incident_reported":
      invalidateCatalogEvent("incident_reported");
      break;
    case "fuel_record_validated":
      invalidateCatalogEvent("fuel_record_validated");
      break;
    case "fuel_record_changed":
      invalidateCatalogEvent("fuel_record_changed");
      break;
    case "client_invoice_deposited":
      invalidateCatalogEvent("client_invoice_deposited");
      break;
    case "client_withholding_updated":
      invalidateCatalogEvent("client_withholding_updated");
      break;
    case "vehicle_tank_capacity_changed":
      invalidateCatalogEvent("vehicle_tank_capacity_changed");
      break;
    case "vehicle_deleted":
      invalidateCatalogEvent("vehicle_deleted");
      break;
    case "vehicle_restored":
      invalidateCatalogEvent("vehicle_restored");
      break;
    case "fuel_anomaly_resolved":
      invalidateCatalogEvent("fuel_anomaly_resolved");
      break;
    case "fuel_price_changed":
      invalidateCatalogEvent("fuel_price_changed");
      break;
    case "time_tracking_updated":
      invalidateCatalogEvent("time_tracking_updated");
      break;
    case "workshop_labor_rate_created":
      invalidateCatalogEvent("workshop_labor_rate_created");
      // Taux d'un OT ouvert : la clé porte l'identifiant (`/api/work-orders/:id/labor-rate`).
      queryClient.invalidateQueries({
        predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].endsWith("/labor-rate"),
      });
      break;
    case "vehicle_document_type_changed":
      invalidateCatalogEvent("vehicle_document_type_changed");
      // Satellites : documents d'un véhicule et panneau d'échéances.
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-documents"] });
      break;
    case "backup_failed":
      invalidateCatalogEvent("backup_failed");
      invalidateAlertQueries();
      break;

    // Fiche pièce créée, modifiée, supprimée ou stock ajusté (server/api/parts-catalog.routes.ts).
    case "part_catalog_changed": {
      invalidateCatalogEvent("part_catalog_changed");
      const partId = toNumber(payloadRecord.id) ?? toNumericId(update.entityId);
      if (partId) {
        queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}/stock-history`] });
        queryClient.invalidateQueries({ queryKey: ["/api/warehouse/parts", partId, "real-stock"] });
      }
      break;
    }

    // Écarts du cahier des charges (CDC-0b) : couche 3 seulement, l'émetteur vient du lot fonctionnel.
    case "part_sale_validated":
      invalidateCatalogEvent("part_sale_validated");
      break;
    case "part_sale_cancelled":
      invalidateCatalogEvent("part_sale_cancelled");
      break;
    case "part_sale_invoiced":
      invalidateCatalogEvent("part_sale_invoiced");
      break;
    case "vehicle_position_updated":
      invalidateCatalogEvent("vehicle_position_updated");
      break;
    case "import_batch_applied":
      // Aucun toast : un import touche des centaines de lignes.
      invalidateCatalogEvent("import_batch_applied");
      break;
    case "alerts_read":
      invalidateCatalogEvent("alerts_read");
      break;

    case "document_renewal_center_changed":
      invalidateCatalogEvent("document_renewal_center_changed");
      break;

    // Récépissé déposé : demande, papier du véhicule, éligibilité des missions et alertes.
    case "document_renewal_receipt_uploaded": {
      invalidateCatalogEvent("document_renewal_receipt_uploaded");
      const receiptVehicleId = toNumericId(asRecord(payloadRecord)?.vehicleId);
      if (receiptVehicleId) {
        queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${receiptVehicleId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${receiptVehicleId}/documents`] });
      }
      invalidateMissionDerivedQueries(null);
      invalidateAlertQueries();
      break;
    }

    // Lignes de travail: des heures, aucun montant. Pas d'invalidation des
    // écrans Direction (docs/plans/lignes-de-travail-ot.md, étape 6).
    case "work_order_item_changed":
      {
        const workOrderId = toNumber(payloadRecord.workOrderId);
        if (workOrderId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/work-orders/${workOrderId}/items`],
          });
          queryClient.invalidateQueries({
            queryKey: [`/api/work-orders/${workOrderId}`],
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/technician/my-work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/technician-stats"] });
      break;

    case "alert_created": {
      // L'alerte est nominative et diffusée en scope `user`: si on reçoit
      // l'événement, elle nous concerne. On la signale au lieu de la laisser
      // apparaître en silence dans la cloche.
      const titre = typeof payloadRecord.title === "string" ? payloadRecord.title : "Nouvelle alerte";
      const message = typeof payloadRecord.message === "string" ? payloadRecord.message : undefined;
      const priorite = typeof payloadRecord.priority === "string" ? payloadRecord.priority : "medium";

      appToast({
        title: titre,
        description: message,
        variant:
          priorite === "critical"
            ? "destructive"
            : priorite === "high"
              ? "warning"
              : titre.toLowerCase().includes("assignée") || titre.toLowerCase().includes("assigne")
                ? "success"
                : "info",
      });

      // Volet système Android: sans ça, l'alerte n'existait que dans un toast,
      // donc uniquement si l'application était au premier plan. Un technicien
      // qui range son téléphone ne voyait rien.
      // Le lien voyage dans `extra.route`: l'écouteur de clic ouvre la fiche
      // concernée au lieu de rouvrir l'app sur son écran par défaut.
      {
        const lien = typeof payloadRecord.link === "string" ? payloadRecord.link : undefined;
        const alerteId = toNumber(payloadRecord.alertId);
        triggerNativeNotification({
          title: titre,
          body: message ?? "",
          id: alerteId ?? undefined,
          extra: lien ? { route: lien } : undefined,
        });
      }

      invalidateAlertQueries();
      break;
    }

    case "alert_updated":
    case "alert_read":
      invalidateAlertQueries();
      break;

    case "client_created":
    case "client_updated":
    case "client_deleted":
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/missions/by-client"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/by-client"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/missions"] });
      break;

    case "mission_created":
    case "mission_updated":
    case "mission_completed":
    case "mission_status_changed":
    case "mission_created_from_fuel":
    case "mission_fuel_recorded":
    case "mission_pod_uploaded":
      {
        const missionFromPayload = extractMissionFromPayload(payload);
        if (missionFromPayload) {
          patchMissionCaches(missionFromPayload, update.type === "mission_created");
        }

        const missionId =
          getMissionId(missionFromPayload) ??
          toNumber(payloadRecord.missionId) ??
          toNumericId(update.entityId);
        if (missionId) {
          queryClient.invalidateQueries({ queryKey: [missionPricePath(missionId)] });
          queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
          void queryClient.refetchQueries({
            queryKey: [`/api/missions/${missionId}`],
            type: "active",
          });
          queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/fuel-records`] });
          void queryClient.refetchQueries({
            queryKey: [`/api/missions/${missionId}/fuel-records`],
            type: "active",
          });
          invalidateMissionDerivedQueries(missionId);
        } else {
          invalidateMissionDerivedQueries();
        }
        if (update.type === "mission_fuel_recorded") {
          queryClient.invalidateQueries({ queryKey: ["/api/fuel-vouchers"] });
          queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/anomalies"] });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      void queryClient.refetchQueries({ queryKey: ["/api/missions"], type: "active" });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/me"] });
      void queryClient.refetchQueries({ queryKey: ["/api/drivers/me"], type: "active" });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/missions"] });
      void queryClient.refetchQueries({ queryKey: ["/api/operations/missions"], type: "active" });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/missions/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/missions/upcoming"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/by-client"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/by-destination"] });
      break;

    case "purchase_order_created":
    case "purchase_order_status_updated":
    case "purchase_order_line_updated":
      {
        const purchaseOrderId =
          toNumber(payloadRecord.orderId) ??
          toNumber(asRecord(payloadRecord.order)?.id) ??
          toNumericId(update.entityId);
        if (purchaseOrderId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/purchase-orders/${purchaseOrderId}`],
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/overdue"] });
      // Réception d'une commande : le stock est crédité, l'alerte stock bas et les demandes
      // de pièce changent chez les autres profils (couche 3, AGENTS.md §2).
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/reorder-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/low-on-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/part-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      break;

    case "supplier_created":
    case "supplier_updated":
    case "supplier_deactivated":
    case "supplier_reactivated":
    case "supplier_rating_updated":
    case "supplier_rating_calculated":
      {
        const supplierId =
          toNumber(payloadRecord.supplierId) ??
          toNumber(asRecord(payloadRecord.supplier)?.id) ??
          toNumericId(update.entityId);
        if (supplierId) {
          queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}`] });
          queryClient.invalidateQueries({
            queryKey: [`/api/suppliers/${supplierId}/performance`],
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers/top"] });
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers/summary"] });
      break;

    case "client_invoice_created":
    case "client_invoice_payment_recorded":
    case "client_invoices_overdue":
      {
        const invoiceFromResult =
          toNumber(asRecord(asRecord(payloadRecord.result)?.invoice)?.id);
        const invoiceId =
          toNumber(payloadRecord.invoiceId) ??
          invoiceFromResult ??
          toNumericId(update.entityId);
        if (invoiceId) {
          queryClient.invalidateQueries({ queryKey: [`/api/billing/invoices/${invoiceId}`] });
          queryClient.invalidateQueries({
            queryKey: [`/api/billing/invoices/${invoiceId}/payments`],
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/client-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices/overdue"] });
      void queryClient.refetchQueries({ queryKey: ["/api/billing/invoices"], type: "active" });
      void queryClient.refetchQueries({ queryKey: ["/api/billing/invoices/summary"], type: "active" });
      void queryClient.refetchQueries({ queryKey: ["/api/billing/statistics"], type: "active" });
      void queryClient.refetchQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("/api/billing/invoices/"),
        type: "active",
      });
      break;

    case "fuel_card_recharged":
    case "fuel_card_consumption_recorded":
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records/statistics"] });
      {
        const missionId =
          toNumber(payloadRecord.missionId) ??
          toNumber(asRecord(payloadRecord.record)?.missionId) ??
          toNumber(asRecord(payloadRecord.fuelRecord)?.missionId);
        if (missionId) {
          queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/fuel-records`] });
          invalidateMissionDerivedQueries(missionId);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/operations/missions/by-client"] });
      queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/by-client"] });
      break;

    case "driver_cpc_updated":
    case "driver_cpc_statuses_synced":
      {
        const driverId =
          toNumber(payloadRecord.driverId) ??
          toNumericId(update.entityId);
        if (driverId) {
          queryClient.invalidateQueries({ queryKey: [`/api/drivers/${driverId}`] });
        }
      }
      invalidateDriverCpcDependents(queryClient);
      break;

    // Pneus: le catalogue est tenu par le magasin, le montage par l'atelier.
    // Les deux métiers regardent les mêmes écrans, d'où une invalidation large
    // couvrant inventaire, statistiques et pneus montés par véhicule.
    case "tire_created":
    case "tire_updated":
    case "tire_deleted":
    case "vehicle_tire_installed":
    case "vehicle_tire_removed": {
      queryClient.invalidateQueries({ queryKey: ["/api/tires"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics-advanced"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/low-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-tires"] });

      const vehicleId = toNumber(payloadRecord.vehicleId);
      if (vehicleId) {
        queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${vehicleId}/tires`] });
      } else {
        // Démontage: le payload ne porte pas le véhicule, on cible par motif.
        queryClient.invalidateQueries({
          predicate: (query) => {
            const firstKey = query.queryKey?.[0];
            return typeof firstKey === "string" && /^\/api\/vehicles\/\d+\/tires$/.test(firstKey);
          },
        });
      }
      break;
    }

    case "warehouse_stock_movement_recorded":
      {
        const partId = toNumber(payloadRecord.partId) ?? toNumericId(update.entityId);
        if (partId) {
          queryClient.invalidateQueries({
            queryKey: ["/api/warehouse/parts", partId, "real-stock"],
          });
          queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}/stock-history`] });
          queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}/usage-history`] });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/stock-movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/low-on-stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/reorder-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/stock-value-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/top-consumed-parts"] });
      break;

    case "supplier_invoice_created":
    case "supplier_invoice_updated":
    case "supplier_invoice_settlement_recorded":
    case "supplier_invoice_settlement_reconciled":
    case "supplier_invoice_settlement_rejected":
    case "supplier_invoice_bulk_approved":
      {
        const invoiceId =
          toNumber(payloadRecord.invoiceId) ??
          toNumericId(update.entityId);
        const purchaseOrderId = toNumericId(payloadRecord.purchaseOrderId);

        if (invoiceId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/supplier-invoices/${invoiceId}`],
          });
          queryClient.invalidateQueries({
            queryKey: [`/api/supplier-invoices/${invoiceId}/settlements`],
          });
        }

        if (purchaseOrderId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/purchase-orders/${purchaseOrderId}`],
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/overdue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/discrepancies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/overdue"] });
      break;

    case "document_renewal_request_created":
    case "document_renewal_request_status_updated":
    case "document_renewal_quick_completed":
    case "vehicle_document_updated":
      {
        const requestRecord = asRecord(payloadRecord.request);
        const documentRecord = asRecord(payloadRecord.document);
        const missionId =
          toNumericId(payloadRecord.missionId) ??
          toNumericId(requestRecord?.missionId);
        const vehicleId =
          toNumericId(payloadRecord.vehicleId) ??
          toNumericId(requestRecord?.vehicleId) ??
          toNumericId(documentRecord?.vehicleId);
        const documentId =
          toNumericId(payloadRecord.documentId) ??
          toNumericId(requestRecord?.vehicleDocumentId) ??
          toNumericId(documentRecord?.id);
        const documentType =
          (typeof payloadRecord.documentType === "string" ? payloadRecord.documentType : null) ??
          (typeof documentRecord?.type === "string" ? documentRecord.type : null);
        const newExpiryDate =
          (typeof payloadRecord.newExpiryDate === "string" ? payloadRecord.newExpiryDate : null) ??
          (typeof documentRecord?.expiryDate === "string" ? documentRecord.expiryDate : null);

        if (documentId) {
          queryClient.setQueriesData(
            {
              predicate: (query) => {
                const [firstKey] = query.queryKey ?? [];
                return typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey);
              },
            },
            (currentData) =>
              patchVehicleDocumentInCacheData(currentData, {
                id: documentId,
                vehicleId,
                type: documentType,
                expiryDate: newExpiryDate,
              }),
          );
        }

        if (documentType && newExpiryDate) {
          queryClient.setQueriesData(
            {
              predicate: (query) => {
                const [firstKey] = query.queryKey ?? [];
                return typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+$/.test(firstKey);
              },
            },
            (currentData) => patchVehicleMasterExpiryInCacheData(currentData, documentType, newExpiryDate),
          );
        }

        if (vehicleId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/vehicles/${vehicleId}/documents`],
          });
          void queryClient.refetchQueries({
            queryKey: [`/api/vehicles/${vehicleId}/documents`],
            type: "active",
          });
          queryClient.invalidateQueries({
            queryKey: [`/api/vehicles/${vehicleId}`],
          });
          void queryClient.refetchQueries({
            queryKey: [`/api/vehicles/${vehicleId}`],
            type: "active",
          });
          queryClient.invalidateQueries({
            queryKey: ["/api/vehicles", vehicleId, "status-history"],
          });
        }
        if (documentId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/documents/${documentId}`],
          });
        }

        // Quand missionId n'est pas fourni (quick renew), on invalide toutes les clés dérivées mission.
        invalidateMissionDerivedQueries(missionId);

      }
      queryClient.invalidateQueries({
        predicate: (query) => {
          const [firstKey, secondKey, thirdKey] = query.queryKey ?? [];

          // Détail véhicule avec identifiant dynamique (id OU immatriculation).
          if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+$/.test(firstKey)) {
            return true;
          }

          // Documents du véhicule avec identifiant dynamique.
          if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey)) {
            return true;
          }

          // Historique santé véhicule (queryKey structurée).
          if (firstKey === "/api/vehicles" && typeof secondKey === "number" && thirdKey === "status-history") {
            return true;
          }

          // Demandes de renouvellement filtrées par véhicule.
          if (firstKey === "/api/document-renewals/requests" && typeof secondKey === "number") {
            return true;
          }

          return false;
        },
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/document-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expiring-docs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expired-docs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/documents/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/document-renewals/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/document-renewals/centers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/date-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });
      // Refetch actif immédiat pour éviter d'attendre un refresh manuel.
      void queryClient.refetchQueries({
        predicate: (query) => {
          const [firstKey] = query.queryKey ?? [];
          if (typeof firstKey !== "string") return false;
          return (
            /^\/api\/vehicles\/[^/]+$/.test(firstKey) ||
            /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey) ||
            firstKey === "/api/vehicles" ||
            firstKey === "/api/vehicles/all" ||
            firstKey === "/api/vehicles/all-with-status" ||
            firstKey === "/api/vehicles/document-stats" ||
            firstKey === "/api/vehicles/expiring-docs" ||
            firstKey === "/api/vehicles/expired-docs" ||
            firstKey === "/api/vehicles/documents/all" ||
            firstKey === "/api/document-renewals/requests" ||
            firstKey === "/api/maintenance/date-alerts"
          );
        },
        type: "active",
      });
      // Rechargement aussi des queries inactives pour éviter un retour avec données périmées.
      void queryClient.refetchQueries({
        predicate: (query) => {
          const [firstKey] = query.queryKey ?? [];
          if (typeof firstKey !== "string") return false;
          return (
            /^\/api\/vehicles\/[^/]+$/.test(firstKey) ||
            /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey) ||
            firstKey === "/api/vehicles/document-stats" ||
            firstKey === "/api/vehicles/expiring-docs" ||
            firstKey === "/api/vehicles/expired-docs" ||
            firstKey === "/api/document-renewals/requests"
          );
        },
        type: "inactive",
      });
      break;

    case "driver_created":
    case "driver_updated":
    case "driver_toggled":
      {
        const driverId = toNumericId(update.entityId);
        if (driverId) {
          queryClient.invalidateQueries({ queryKey: [`/api/drivers/${driverId}`] });
        }
      }
      invalidateDriverCpcDependents(queryClient);
      // Création de compte depuis la fiche (#113) : la liste des utilisateurs change aussi.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/statistics"] });
      break;

    default:
      if (update.entity === "work_order") {
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] });
      } else if (update.entity === "vehicle") {
        queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      } else if (update.entity === "alert") {
        queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
      } else if (update.entity === "client") {
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
        queryClient.invalidateQueries({ queryKey: ["/api/clients/all"] });
        queryClient.invalidateQueries({ queryKey: ["/api/operations/missions/by-client"] });
        queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/by-client"] });
      } else if (update.entity === "mission") {
        const missionFromPayload = extractMissionFromPayload(payload);
        if (missionFromPayload) {
          patchMissionCaches(missionFromPayload, false);
        }

        const missionId =
          getMissionId(missionFromPayload) ??
          toNumber(payloadRecord.missionId) ??
          toNumericId(update.entityId);
        if (missionId) {
          queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
          void queryClient.refetchQueries({
            queryKey: [`/api/missions/${missionId}`],
            type: "active",
          });
          invalidateMissionDerivedQueries(missionId);
        } else {
          invalidateMissionDerivedQueries();
        }
        queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
        void queryClient.refetchQueries({ queryKey: ["/api/missions"], type: "active" });
        queryClient.invalidateQueries({ queryKey: ["/api/operations/missions"] });
        void queryClient.refetchQueries({ queryKey: ["/api/operations/missions"], type: "active" });
        queryClient.invalidateQueries({ queryKey: ["/api/operations/missions/active"] });
        queryClient.invalidateQueries({ queryKey: ["/api/operations/missions/upcoming"] });
        queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/by-client"] });
        queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/by-destination"] });
      } else if (update.entity === "driver") {
        const driverId = toNumericId(update.entityId);
        if (driverId) {
          queryClient.invalidateQueries({ queryKey: [`/api/drivers/${driverId}`] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-statistics"] });
        queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      } else if (update.entity === "supplier_invoice") {
        const invoiceId = toNumericId(update.entityId);
        if (invoiceId) {
          queryClient.invalidateQueries({ queryKey: [`/api/supplier-invoices/${invoiceId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/supplier-invoices/${invoiceId}/settlements`] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices"] });
        queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/statistics"] });
        queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/overdue"] });
        queryClient.invalidateQueries({ queryKey: ["/api/supplier-invoices/discrepancies"] });
      } else if (update.entity === "purchase_order") {
        const purchaseOrderId =
          toNumber(payloadRecord.orderId) ??
          toNumericId(update.entityId);
        if (purchaseOrderId) {
          queryClient.invalidateQueries({ queryKey: [`/api/purchase-orders/${purchaseOrderId}`] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
        queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/statistics"] });
        queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/overdue"] });
      } else if (update.entity === "supplier") {
        const supplierId =
          toNumber(payloadRecord.supplierId) ??
          toNumericId(update.entityId);
        if (supplierId) {
          queryClient.invalidateQueries({ queryKey: [`/api/suppliers/${supplierId}`] });
          queryClient.invalidateQueries({
            queryKey: [`/api/suppliers/${supplierId}/performance`],
          });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/suppliers/top"] });
        queryClient.invalidateQueries({ queryKey: ["/api/suppliers/summary"] });
      } else if (update.entity === "client_invoice") {
        const invoiceId = toNumericId(update.entityId);
        if (invoiceId) {
          queryClient.invalidateQueries({ queryKey: [`/api/billing/invoices/${invoiceId}`] });
          queryClient.invalidateQueries({
            queryKey: [`/api/billing/invoices/${invoiceId}/payments`],
          });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
        queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices"] });
        queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices/summary"] });
        queryClient.invalidateQueries({ queryKey: ["/api/billing/statistics"] });
      } else if (update.entity === "fuel_card") {
        queryClient.invalidateQueries({ queryKey: ["/api/fuel-card"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/history"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fuel-records/statistics"] });
        const missionId =
          toNumber(payloadRecord.missionId) ??
          toNumber(asRecord(payloadRecord.record)?.missionId) ??
          toNumber(asRecord(payloadRecord.fuelRecord)?.missionId);
        if (missionId) {
          queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
          queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/fuel-records`] });
          invalidateMissionDerivedQueries(missionId);
        } else {
          invalidateMissionDerivedQueries();
        }
      } else if (update.entity === "warehouse") {
        queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/parts/stock-movements"] });
        queryClient.invalidateQueries({ queryKey: ["/api/parts/low-on-stock"] });
        queryClient.invalidateQueries({ queryKey: ["/api/warehouse"] });
        queryClient.invalidateQueries({ queryKey: ["/api/warehouse/statistics"] });
        queryClient.invalidateQueries({ queryKey: ["/api/warehouse/reorder-alerts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/warehouse/stock-value-history"] });
      } else if (update.entity === "document_renewal_request") {
        const requestRecord = asRecord(payloadRecord.request);
        const documentRecord = asRecord(payloadRecord.document);
        const missionId =
          toNumber(payloadRecord.missionId) ??
          toNumber(requestRecord?.missionId);
        const vehicleId =
          toNumber(payloadRecord.vehicleId) ??
          toNumber(requestRecord?.vehicleId) ??
          toNumber(documentRecord?.vehicleId);
        if (vehicleId) {
          queryClient.invalidateQueries({
            queryKey: [`/api/vehicles/${vehicleId}/documents`],
          });
          queryClient.invalidateQueries({
            queryKey: [`/api/vehicles/${vehicleId}`],
          });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/vehicles/documents/all"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vehicles/all"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vehicles/document-stats"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expiring-docs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expired-docs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/document-renewals/requests"] });
        queryClient.invalidateQueries({ queryKey: ["/api/document-renewals/centers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/maintenance/date-alerts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
        queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
        queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });
        invalidateMissionDerivedQueries(missionId);
      }
  }
}

function startHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }

  lastPongAt = Date.now();
  heartbeatInterval = setInterval(() => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (Date.now() - lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      console.warn("[WS] Heartbeat timeout, fermeture et reconnexion...");
      socket.close();
      return;
    }

    socket.send(
      JSON.stringify({
        type: "ping",
        sentAt: new Date().toISOString(),
      }),
    );
  }, HEARTBEAT_INTERVAL_MS);
}

function scheduleReconnect(): void {
  if (reconnectTimeout || manualClose || !shouldConnect()) {
    return;
  }

  reconnectAttempt += 1;
  emitSnapshot({ reconnectAttempt });

  const exponential = Math.min(
    RECONNECT_MAX_DELAY_MS,
    1000 * 2 ** Math.min(reconnectAttempt, 5),
  );
  const jitter = Math.floor(Math.random() * 500);
  const delay = exponential + jitter;

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = undefined;
    connectSocket();
  }, delay);
}

function connectSocket(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  if (!shouldConnect()) {
    return;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws`;
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    reconnectAttempt = 0;
    emitSnapshot({
      isConnected: false,
      isSocketOpen: true,
      isReady: false,
      reconnectAttempt: 0,
    });
    startHeartbeat();
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data) as unknown;
      lastPongAt = Date.now();

      const messageRecord = asRecord(message);
      const messageType = messageRecord && typeof messageRecord.type === "string" ? messageRecord.type : "";

      if (messageType === "pong") {
        return;
      }

      if (messageType === "auth_success") {
        emitSnapshot({ isConnected: true, isReady: true });
        resyncCriticalData("auth_success");
        return;
      }

      if (messageType === "ping") {
        socket?.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
        return;
      }

      const update = normalizeUpdate(message);
      if (!update) {
        return;
      }

      if (!snapshot.isReady) {
        emitSnapshot({ isConnected: true, isReady: true });
      }

      if (!markEventSeen(update.eventId)) {
        return;
      }

      const updateDate = update.emittedAt ? new Date(update.emittedAt) : new Date();
      emitSnapshot({ lastUpdate: updateDate });
      handleDomainUpdate(update);
    } catch (error) {
      console.error("[WS] Erreur parsing message:", error);
    }
  };

  socket.onclose = () => {
    socket = null;
    emitSnapshot({ isConnected: false, isSocketOpen: false, isReady: false });
    clearTimers();
    scheduleReconnect();
  };

  socket.onerror = (error) => {
    console.error("[WS] Erreur WebSocket:", error);
    emitSnapshot({ isConnected: false, isReady: false });
  };
}

function closeSocket(markManual: boolean): void {
  manualClose = markManual;
  clearTimers();
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    socket.close();
  }
  socket = null;
  emitSnapshot({ isConnected: false, isSocketOpen: false, isReady: false });
}

function setUserId(userId?: number): void {
  const normalizedUserId = typeof userId === "number" ? userId : undefined;
  const hasUserChanged = normalizedUserId !== currentUserId;
  currentUserId = normalizedUserId;

  if (!currentUserId) {
    closeSocket(true);
    return;
  }

  manualClose = false;

  if (hasUserChanged && socket) {
    closeSocket(false);
  }
  connectSocket();
}

function bindNetworkListeners(): void {
  if (networkListenersBound || typeof window === "undefined") {
    return;
  }

  networkListenersBound = true;

  window.addEventListener("online", () => {
    if (!manualClose && shouldConnect()) {
      connectSocket();
      // Le rejeu de la file hors ligne passe d'abord : relire avant l'envoi montrerait l'état d'avant.
      void whenReplaySettled().then(() => resyncCriticalData("network_online"));
    }
  });

  window.addEventListener("offline", () => {
    emitSnapshot({ isConnected: false, isSocketOpen: false, isReady: false });
  });
}

function subscribe(listener: (nextSnapshot: RealtimeSnapshot) => void): () => void {
  bindNetworkListeners();
  listeners.add(listener);
  ensurePeriodicResync();
  listener(snapshot);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearPeriodicResync();
      closeSocket(true);
    }
  };
}

function forceResync(): void {
  resyncCriticalData("manual", true);
  emitSnapshot({ lastUpdate: new Date() });
}

export function useRealTimeSync(userId?: number) {
  const [localSnapshot, setLocalSnapshot] = useState<RealtimeSnapshot>(snapshot);

  useEffect(() => {
    const unsubscribe = subscribe(setLocalSnapshot);
    return unsubscribe;
  }, []);

  useEffect(() => {
    setUserId(userId);
    if (typeof userId === "number") {
      connectSocket();
    }
  }, [userId]);

  return {
    isConnected: localSnapshot.isConnected,
    isSocketOpen: localSnapshot.isSocketOpen,
    isReady: localSnapshot.isReady,
    lastUpdate: localSnapshot.lastUpdate,
    lastResyncAt: localSnapshot.lastResyncAt,
    reconnectAttempt: localSnapshot.reconnectAttempt,
    forceSync: forceResync,
  };
}
