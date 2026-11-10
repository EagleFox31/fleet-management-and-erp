/**
 * Table des routes simulées (T-09b), une entrée par route des contrats
 * `shared/contracts/*`. Module pur (aucun import msw) : la table sert aux
 * handlers navigateur (`handlers.ts`) et aux tests unitaires, qui parsent
 * chaque réponse avec son schéma.
 *
 * Exclus faute de schéma de réponse JSON : `/api/exports/*` et l'export Word
 * d'un OT (fichiers binaires).
 */
import type { ZodTypeAny } from "zod";
import type { ApiErrorBody } from "@shared/errors";
import { AUDIT_LOGS_PATH, auditLogsQuerySchema, auditLogsResponseSchema } from "@shared/contracts/audit-logs";
import {
  LOCKED_USERS_PATH,
  lockedUsersResponseSchema,
  unlockUserResponseSchema,
} from "@shared/contracts/auth-lockout";
import {
  BACKUP_ALERTS_PATH,
  BACKUPS_PATH,
  RUN_BACKUP_PATH,
  backupAlertsResponseSchema,
  backupRunsResponseSchema,
  runBackupResponseSchema,
} from "@shared/contracts/backups";
import { fuelAnomalyResolutionSchema, updateFuelAnomalyRequestSchema } from "@shared/contracts/fuel-anomalies";
import {
  FUEL_PRICES_PATH,
  createFuelPriceRequestSchema,
  fuelPriceSchema,
  fuelPricesResponseSchema,
} from "@shared/contracts/fuel-prices";
import { fuelVoucherValidationResponseSchema } from "@shared/contracts/fuel-vouchers";
import {
  INCIDENTS_PATH,
  createIncidentRequestSchema,
  incidentSchema,
  incidentsQuerySchema,
  incidentsResponseSchema,
} from "@shared/contracts/incidents";
import {
  KPI_AVG_COST_PER_INTERVENTION_PATH,
  KPI_INCIDENTS_PER_MONTH_PATH,
  KPI_PREVENTIVE_COMPLIANCE_PATH,
  avgCostPerInterventionResponseSchema,
  incidentsPerMonthResponseSchema,
  preventiveComplianceResponseSchema,
} from "@shared/contracts/kpi";
import {
  NOTIFICATION_SETTINGS_PATH,
  notificationSettingsResponseSchema,
  updateNotificationSettingsRequestSchema,
} from "@shared/contracts/notification-settings";
import { PENDING_INVOICES_PATH, pendingInvoicesResponseSchema } from "@shared/contracts/pending-invoices";
import { qualityCheckRequestSchema, qualityCheckResponseSchema } from "@shared/contracts/quality-check";
import {
  TIME_CODES,
  TIME_TRACKING_MONTHLY_STATS_PATH,
  TIME_TRACKING_PATH,
  timeTrackingEntrySchema,
  timeTrackingMonthlyStatsResponseSchema,
  timeTrackingQuerySchema,
  timeTrackingResponseSchema,
  upsertTimeTrackingRequestSchema,
  type TimeCode,
} from "@shared/contracts/time-tracking";
import {
  TIRE_MOVEMENTS_PATH,
  tireMovementsQuerySchema,
  tireMovementsResponseSchema,
} from "@shared/contracts/tire-movements";
import {
  VEHICLE_DOCUMENT_TYPES_PATH,
  createVehicleDocumentTypeRequestSchema,
  updateVehicleDocumentTypeRequestSchema,
  vehicleDocumentTypeListResponseSchema,
  vehicleDocumentTypeSchema,
} from "@shared/contracts/vehicle-document-types";
import { vehicleCostSummaryResponseSchema } from "@shared/contracts/vehicle-cost-summary";
import { workOrderAuditTrailResponseSchema } from "@shared/contracts/work-order-audit-trail";
import { MOCK_NOW, mockKpi, type MockStore } from "./fixtures";

export type MockScenario = "normal" | "empty";

export interface MockContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  store: MockStore;
  scenario: MockScenario;
}

export interface MockReply {
  status?: number;
  body: unknown;
}

export interface MockRoute {
  id: string;
  method: "get" | "post" | "put" | "patch";
  /** Chemin au format msw (`:param`). */
  path: string;
  /** Schéma de la réponse en cas de succès. */
  response: ZodTypeAny;
  handle: (ctx: MockContext) => MockReply;
  /** Requête d'exemple pour le test unitaire (corps, paramètres). */
  sample?: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown };
}

export function errorReply(
  status: number,
  code: ApiErrorBody["code"],
  message: string,
  extra: Partial<ApiErrorBody> = {},
): MockReply {
  const body: ApiErrorBody = { message, code, requestId: "mock-0001", ...extra };
  return { status, body };
}

const invalid = (message = "Certaines informations sont invalides. Vérifiez le formulaire.") =>
  errorReply(400, "VALIDATION", message);

const pad = (n: number) => String(n).padStart(2, "0");

export const MOCK_ROUTES: MockRoute[] = [
  // ---- Sauvegardes ----
  {
    id: "backups.list",
    method: "get",
    path: BACKUPS_PATH,
    response: backupRunsResponseSchema,
    handle: ({ store, scenario }) => ({ body: scenario === "empty" ? [] : store.backups }),
  },
  {
    id: "backups.alerts",
    method: "get",
    path: BACKUP_ALERTS_PATH,
    response: backupAlertsResponseSchema,
    handle: ({ store, scenario }) => {
      const latest = scenario === "empty" ? undefined : store.backups[0];
      if (!latest) {
        return { body: [{ kind: "no_recent_success", message: "Aucune sauvegarde enregistrée.", since: null }] };
      }
      if (latest.status === "failed") {
        return { body: [{ kind: "last_run_failed", message: "La dernière sauvegarde a échoué.", since: latest.startedAt }] };
      }
      return { body: [] };
    },
  },
  {
    id: "backups.run",
    method: "post",
    path: RUN_BACKUP_PATH,
    response: runBackupResponseSchema,
    handle: ({ store }) => {
      const running = store.backups.find((run) => run.status === "running");
      if (running) return { body: running };
      const run = {
        id: Math.max(0, ...store.backups.map((r) => r.id)) + 1,
        startedAt: MOCK_NOW,
        finishedAt: MOCK_NOW,
        status: "success" as const,
        sizeBytes: 48_300_000,
        durationMs: 187_000,
        checksum: "c0ffee1234",
        errorCode: null,
      };
      store.backups.unshift(run);
      return { body: run };
    },
  },
  // ---- Préférences de notification ----
  {
    id: "notifications.get",
    method: "get",
    path: NOTIFICATION_SETTINGS_PATH,
    response: notificationSettingsResponseSchema,
    handle: ({ store }) => ({ body: store.notificationSettings }),
  },
  {
    id: "notifications.patch",
    method: "patch",
    path: NOTIFICATION_SETTINGS_PATH,
    response: notificationSettingsResponseSchema,
    sample: { body: [{ topic: "fuel", inApp: false }] },
    handle: ({ store, body }) => {
      const parsed = updateNotificationSettingsRequestSchema.safeParse(body);
      if (!parsed.success) return invalid();
      for (const change of parsed.data) {
        const row = store.notificationSettings.find((r) => r.topic === change.topic);
        if (!row) continue;
        if (change.inApp !== undefined) row.inApp = change.inApp;
        if (change.email !== undefined) row.email = change.email;
      }
      return { body: store.notificationSettings };
    },
  },
  // ---- KPI ----
  {
    id: "kpi.incidents",
    method: "get",
    path: KPI_INCIDENTS_PER_MONTH_PATH,
    response: incidentsPerMonthResponseSchema,
    handle: ({ scenario }) => ({ body: scenario === "empty" ? [] : mockKpi.incidentsPerMonth }),
  },
  {
    id: "kpi.compliance",
    method: "get",
    path: KPI_PREVENTIVE_COMPLIANCE_PATH,
    response: preventiveComplianceResponseSchema,
    handle: ({ scenario }) => ({
      body: scenario === "empty" ? { planned: 0, doneOnTime: 0, rate: null } : mockKpi.preventiveCompliance,
    }),
  },
  {
    id: "kpi.avg-cost",
    method: "get",
    path: KPI_AVG_COST_PER_INTERVENTION_PATH,
    response: avgCostPerInterventionResponseSchema,
    handle: ({ scenario }) => ({
      body: scenario === "empty" ? { interventions: 0, totalCost: 0, averageCost: null } : mockKpi.avgCost,
    }),
  },
  // ---- Incidents ----
  {
    id: "incidents.list",
    method: "get",
    path: INCIDENTS_PATH,
    response: incidentsResponseSchema,
    handle: ({ store, query, scenario }) => {
      const parsed = incidentsQuerySchema.safeParse(query);
      if (!parsed.success) return invalid();
      if (scenario === "empty") return { body: [] };
      const { status } = parsed.data;
      return { body: store.incidents.filter((i) => !status || i.status === status) };
    },
  },
  {
    id: "incidents.create",
    method: "post",
    path: INCIDENTS_PATH,
    response: incidentSchema,
    sample: { body: { vehicleId: 13, description: "Pneu avant crevé en route.", severity: "medium" } },
    handle: ({ store, body }) => {
      const parsed = createIncidentRequestSchema.safeParse(body);
      if (!parsed.success) return invalid("Décrivez la panne en quelques mots.");
      const incident = {
        id: Math.max(0, ...store.incidents.map((i) => i.id)) + 1,
        ...parsed.data,
        vehicleRegistration: "TEST-013",
        reportedBy: 21,
        reportedByName: "Ali Sawadogo",
        status: "open" as const,
        workOrderId: null,
        createdAt: MOCK_NOW,
        updatedAt: MOCK_NOW,
      };
      store.incidents.unshift(incident);
      return { status: 201, body: incident };
    },
  },
  // ---- Mouvements de pneus ----
  {
    id: "tire-movements.list",
    method: "get",
    path: TIRE_MOVEMENTS_PATH,
    response: tireMovementsResponseSchema,
    handle: ({ store, query, scenario }) => {
      const parsed = tireMovementsQuerySchema.safeParse(query);
      if (!parsed.success) return invalid();
      if (scenario === "empty") return { body: [] };
      const { from, to, tireId, vehicleId } = parsed.data;
      return {
        body: store.tireMovements.filter((m) => {
          const day = m.at.slice(0, 10);
          return (
            (!from || day >= from) &&
            (!to || day <= to) &&
            (!tireId || m.tireId === tireId) &&
            (!vehicleId || m.vehicleId === vehicleId)
          );
        }),
      };
    },
  },
  // ---- Pointage ----
  {
    id: "time-tracking.list",
    method: "get",
    path: TIME_TRACKING_PATH,
    response: timeTrackingResponseSchema,
    sample: { query: { month: "11", year: "2026" } },
    handle: ({ store, query, scenario }) => {
      const parsed = timeTrackingQuerySchema.safeParse(query);
      if (!parsed.success) return invalid();
      if (scenario === "empty") return { body: [] };
      const { month, year, userId } = parsed.data;
      const prefix = `${year}-${pad(month)}-`;
      return { body: store.timeEntries.filter((e) => e.date.startsWith(prefix) && (!userId || e.userId === userId)) };
    },
  },
  {
    id: "time-tracking.upsert",
    method: "put",
    path: TIME_TRACKING_PATH,
    response: timeTrackingEntrySchema,
    sample: { body: { userId: 21, date: "2026-11-03", status: "JT" } },
    handle: ({ store, body }) => {
      const parsed = upsertTimeTrackingRequestSchema.safeParse(body);
      if (!parsed.success) return invalid("Code de pointage ou date invalide.");
      const { userId, date, status, notes } = parsed.data;
      const entry = { userId, date, status, notes: notes ?? null };
      const index = store.timeEntries.findIndex((e) => e.userId === userId && e.date === date);
      if (index >= 0) store.timeEntries[index] = entry;
      else store.timeEntries.push(entry);
      return { body: entry };
    },
  },
  {
    id: "time-tracking.monthly-stats",
    method: "get",
    path: TIME_TRACKING_MONTHLY_STATS_PATH,
    response: timeTrackingMonthlyStatsResponseSchema,
    sample: { query: { month: "11", year: "2026" } },
    handle: ({ store, query }) => {
      const month = Number(query.month);
      const year = Number(query.year);
      if (!Number.isInteger(month) || !Number.isInteger(year)) return invalid();
      const prefix = `${year}-${pad(month)}-`;
      return {
        body: store.timeStats.map((person) => {
          const counts = Object.fromEntries(TIME_CODES.map((code) => [code, 0])) as Record<TimeCode, number>;
          for (const entry of store.timeEntries) {
            if (entry.userId === person.userId && entry.date.startsWith(prefix)) counts[entry.status] += 1;
          }
          return { ...person, counts };
        }),
      };
    },
  },
  // ---- Factures en attente ----
  {
    id: "pending-invoices.list",
    method: "get",
    path: PENDING_INVOICES_PATH,
    response: pendingInvoicesResponseSchema,
    handle: ({ store, scenario }) => ({ body: scenario === "empty" ? [] : store.pendingInvoices }),
  },
  // ---- Verrouillage, journal d'audit ----
  {
    id: "lockout.list",
    method: "get",
    path: LOCKED_USERS_PATH,
    response: lockedUsersResponseSchema,
    handle: ({ store, scenario }) => ({ body: scenario === "empty" ? [] : store.lockedUsers }),
  },
  {
    id: "lockout.unlock",
    method: "post",
    path: "/api/admin/users/:id/unlock",
    response: unlockUserResponseSchema,
    sample: { params: { id: "31" } },
    handle: ({ store, params }) => {
      const id = Number(params.id);
      const index = store.lockedUsers.findIndex((u) => u.id === id);
      if (index < 0) return errorReply(404, "NOT_FOUND", "Cet utilisateur n'est pas verrouillé.");
      store.lockedUsers.splice(index, 1);
      return { body: { id, unlocked: true } };
    },
  },
  {
    id: "audit-logs.list",
    method: "get",
    path: AUDIT_LOGS_PATH,
    response: auditLogsResponseSchema,
    handle: ({ store, query, scenario }) => {
      const parsed = auditLogsQuerySchema.safeParse(query);
      if (!parsed.success) return invalid();
      const rows = scenario === "empty" ? [] : store.auditLogs;
      const { page, pageSize } = parsed.data;
      return { body: { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize } };
    },
  },
  {
    id: "work-orders.audit-trail",
    method: "get",
    path: "/api/work-orders/:id/audit-trail",
    response: workOrderAuditTrailResponseSchema,
    sample: { params: { id: "62" } },
    handle: ({ store, scenario }) => ({
      body: scenario === "empty" ? [] : store.auditLogs.filter((r) => r.entityType === "work_order"),
    }),
  },
  // ---- Carburant ----
  {
    id: "fuel-prices.list",
    method: "get",
    path: FUEL_PRICES_PATH,
    response: fuelPricesResponseSchema,
    handle: ({ store }) => ({ body: store.fuelPrices }),
  },
  {
    id: "fuel-prices.create",
    method: "post",
    path: FUEL_PRICES_PATH,
    response: fuelPriceSchema,
    sample: { body: { effectiveFrom: "2026-11-01", pricePerLiter: 860 } },
    handle: ({ store, body }) => {
      const parsed = createFuelPriceRequestSchema.safeParse(body);
      if (!parsed.success) return invalid("Date ou prix invalide.");
      if (store.fuelPrices.some((p) => p.effectiveFrom === parsed.data.effectiveFrom)) {
        return errorReply(409, "CONFLICT", "Un prix existe déjà à cette date.");
      }
      const price = { ...parsed.data, createdBy: 1, createdAt: MOCK_NOW };
      store.fuelPrices.push(price);
      store.fuelPrices.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      return { status: 201, body: price };
    },
  },
  {
    id: "fuel-vouchers.validate",
    method: "post",
    path: "/api/fuel-vouchers/:id/validate",
    response: fuelVoucherValidationResponseSchema,
    sample: { params: { id: "412" } },
    handle: ({ params }) => ({
      body: { id: Number(params.id), validationStatus: "validated", validatedBy: 1, validatedAt: MOCK_NOW },
    }),
  },
  {
    id: "fuel-anomalies.update",
    method: "patch",
    path: "/api/fuel-card/anomalies/:key",
    response: fuelAnomalyResolutionSchema,
    sample: { params: { key: "consumption-gap:412" }, body: { status: "justified", comment: "Plein partagé." } },
    handle: ({ params, body }) => {
      const parsed = updateFuelAnomalyRequestSchema.safeParse(body);
      if (!parsed.success) return invalid();
      const key = decodeURIComponent(params.key ?? "");
      const recordId = key.split(":")[1];
      return {
        body: {
          anomalyKey: key,
          fuelRecordId: Number(recordId),
          status: parsed.data.status,
          comment: parsed.data.comment ?? null,
          resolvedBy: 1,
          resolvedAt: MOCK_NOW,
        },
      };
    },
  },
  // ---- OT et véhicules ----
  {
    id: "quality-check.post",
    method: "post",
    path: "/api/work-orders/:id/quality-check",
    response: qualityCheckResponseSchema,
    sample: { params: { id: "62" }, body: { result: "passed" } },
    handle: ({ params, body }) => {
      const parsed = qualityCheckRequestSchema.safeParse(body);
      if (!parsed.success) return invalid("Indiquez le motif du refus.");
      return {
        body: {
          workOrderId: Number(params.id),
          qcStatus: parsed.data.result,
          qcBy: 1,
          qcAt: MOCK_NOW,
          qcReason: parsed.data.reason ?? null,
        },
      };
    },
  },
  {
    id: "vehicles.cost-summary",
    method: "get",
    path: "/api/vehicles/:id/cost-summary",
    response: vehicleCostSummaryResponseSchema,
    sample: { params: { id: "13" } },
    handle: ({ params, query }) => ({
      body: {
        vehicleId: Number(params.id),
        from: query.from ?? null,
        to: query.to ?? null,
        labor: 240_000,
        parts: 515_000,
        fuel: 1_020_000,
        total: 1_775_000,
        workOrderCount: 4,
        fuelLiters: 1_200,
      },
    }),
  },
  // ---- Types de document ----
  {
    id: "document-types.list",
    method: "get",
    path: VEHICLE_DOCUMENT_TYPES_PATH,
    response: vehicleDocumentTypeListResponseSchema,
    handle: ({ store }) => ({ body: store.documentTypes }),
  },
  {
    id: "document-types.create",
    method: "post",
    path: VEHICLE_DOCUMENT_TYPES_PATH,
    response: vehicleDocumentTypeSchema,
    sample: { body: { code: "permis_transport", label: "Permis de transport", validityMonths: 12 } },
    handle: ({ store, body }) => {
      const parsed = createVehicleDocumentTypeRequestSchema.safeParse(body);
      if (!parsed.success) return invalid();
      if (store.documentTypes.some((t) => t.code === parsed.data.code)) {
        return errorReply(409, "CONFLICT", "Ce code de document existe déjà.");
      }
      store.documentTypes.push(parsed.data);
      return { status: 201, body: parsed.data };
    },
  },
  {
    id: "document-types.update",
    method: "patch",
    path: "/api/vehicle-document-types/:code",
    response: vehicleDocumentTypeSchema,
    sample: { params: { code: "assurance" }, body: { alertDays: 45 } },
    handle: ({ store, params, body }) => {
      const parsed = updateVehicleDocumentTypeRequestSchema.safeParse(body);
      if (!parsed.success) return invalid();
      const type = store.documentTypes.find((t) => t.code === params.code);
      if (!type) return errorReply(404, "NOT_FOUND", "Ce type de document n'existe plus.");
      Object.assign(type, parsed.data);
      return { body: type };
    },
  },
];
