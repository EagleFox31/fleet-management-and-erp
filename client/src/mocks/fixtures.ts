/**
 * Données simulées (T-09b), typées par les types inférés des contrats
 * `shared/contracts/*`. Dates figées : aucune lecture de l'horloge, pour des
 * tests stables.
 *
 * `createMockStore()` renvoie une copie neuve et modifiable ; les handlers
 * écrivent dedans (création d'incident, sauvegarde lancée, pointage saisi…) pour
 * que les écrans se comportent comme avec le serveur réel.
 */
import type { AuditLogRow } from "@shared/contracts/audit-logs";
import type { BackupRun } from "@shared/contracts/backups";
import type { FuelPrice } from "@shared/contracts/fuel-prices";
import type { Incident } from "@shared/contracts/incidents";
import type { LockedUser } from "@shared/contracts/auth-lockout";
import type { NotificationSetting } from "@shared/contracts/notification-settings";
import type { PendingInvoice } from "@shared/contracts/pending-invoices";
import type { TimeTrackingEntry, TimeTrackingMonthlyStatsResponse } from "@shared/contracts/time-tracking";
import type { TireMovement } from "@shared/contracts/tire-movements";
import type { VehicleDocumentType } from "@shared/contracts/vehicle-document-types";
import { DEFAULT_NOTIFICATION_SETTINGS } from "@shared/contracts/notification-settings";
import { VEHICLE_DOCUMENT_TYPE_SEED } from "@shared/contracts/vehicle-document-types";

/** Date de référence de la recette (lundi 2 novembre 2026). */
export const MOCK_NOW = "2026-11-02T08:00:00.000Z";
export const MOCK_YEAR = 2026;
export const MOCK_MONTH = 11;

export const mockBackups = (): BackupRun[] => [
  {
    id: 3,
    startedAt: "2026-11-01T02:00:00.000Z",
    finishedAt: "2026-11-01T02:00:04.000Z",
    status: "failed",
    sizeBytes: null,
    durationMs: 4000,
    checksum: null,
    errorCode: "DUMP_UNAVAILABLE",
  },
  {
    id: 2,
    startedAt: "2026-10-31T02:00:00.000Z",
    finishedAt: "2026-10-31T02:03:12.000Z",
    status: "success",
    sizeBytes: 48_234_496,
    durationMs: 192_000,
    checksum: "9f2c1d7a5b",
    errorCode: null,
  },
  {
    id: 1,
    startedAt: "2026-10-30T02:00:00.000Z",
    finishedAt: "2026-10-30T02:03:05.000Z",
    status: "success",
    sizeBytes: 47_911_936,
    durationMs: 185_000,
    checksum: "4be08c33e1",
    errorCode: null,
  },
];

export const mockNotificationSettings = (): NotificationSetting[] =>
  DEFAULT_NOTIFICATION_SETTINGS.map((row) => ({ ...row }));

export const mockIncidents = (): Incident[] => [
  {
    id: 2,
    vehicleId: 13,
    reportedBy: 21,
    reportedByName: "Ali Sawadogo",
    description: "Fuite d'huile visible sous le moteur au démarrage.",
    severity: "high",
    status: "open",
    workOrderId: null,
    createdAt: "2026-11-01T07:15:00.000Z",
    updatedAt: "2026-11-01T07:15:00.000Z",
  },
  {
    id: 1,
    vehicleId: 13,
    reportedBy: 22,
    reportedByName: "Moussa Ouedraogo",
    description: "Voyant de freinage allumé en roulant.",
    severity: "medium",
    status: "in_progress",
    workOrderId: 62,
    createdAt: "2026-10-29T09:40:00.000Z",
    updatedAt: "2026-10-30T10:00:00.000Z",
  },
];

export const mockTireMovements = (): TireMovement[] => [
  {
    kind: "installed",
    at: "2026-10-31T09:00:00.000Z",
    tireId: 4,
    tireLabel: "Michelin XZE 315/80R22.5",
    vehicleId: 13,
    vehicleLabel: "AB-123-CD",
    position: "AVG",
    mileage: 182_450,
    byUserName: "Issa Compaore",
  },
  {
    kind: "removed",
    at: "2026-10-31T08:40:00.000Z",
    tireId: 2,
    tireLabel: "Bridgestone R249 315/80R22.5",
    vehicleId: 13,
    vehicleLabel: "AB-123-CD",
    position: "AVG",
    mileage: 182_450,
    byUserName: "Issa Compaore",
  },
  {
    kind: "rotated",
    at: "2026-10-20T14:10:00.000Z",
    tireId: 7,
    tireLabel: "Michelin XZE 315/80R22.5",
    vehicleId: 14,
    vehicleLabel: "EF-456-GH",
    position: "ARD",
    mileage: null,
    byUserName: null,
  },
  {
    kind: "inspected",
    at: "2026-10-15T11:00:00.000Z",
    tireId: 7,
    tireLabel: "Michelin XZE 315/80R22.5",
    vehicleId: 14,
    vehicleLabel: "EF-456-GH",
    position: "ARD",
    mileage: 171_900,
    byUserName: "Issa Compaore",
  },
];

export const mockTimeStats = (): TimeTrackingMonthlyStatsResponse => [
  { userId: 21, userName: "Ali Sawadogo", counts: { JT: 0, M: 0, Mi: 0, C: 0, A: 0, R: 0, Re: 0 } },
  { userId: 22, userName: "Moussa Ouedraogo", counts: { JT: 0, M: 0, Mi: 0, C: 0, A: 0, R: 0, Re: 0 } },
  { userId: 23, userName: "Fatim Zongo", counts: { JT: 0, M: 0, Mi: 0, C: 0, A: 0, R: 0, Re: 0 } },
];

export const mockTimeEntries = (): TimeTrackingEntry[] => [
  { userId: 21, date: "2026-11-02", status: "JT", notes: null },
  { userId: 22, date: "2026-11-02", status: "Mi", notes: "Convoi Bobo" },
  { userId: 23, date: "2026-11-02", status: "R", notes: null },
];

export const mockPendingInvoices = (): PendingInvoice[] => [
  { clientId: 5, clientName: "SOCOGIB", operationCount: 6, amount: 1_840_000, missionsWithoutPrice: 0, oldestOperationDate: "2026-09-12" },
  { clientId: 8, clientName: "Brakina", operationCount: 3, amount: 720_500, missionsWithoutPrice: 0, oldestOperationDate: "2026-10-14" },
  { clientId: 9, clientName: "Sodigaz", operationCount: 1, amount: 95_000, missionsWithoutPrice: 0, oldestOperationDate: "2026-10-29" },
];

export const mockLockedUsers = (): LockedUser[] => [
  {
    id: 31,
    username: "k.traore",
    name: "Karim Traore",
    role: "technician",
    failedLoginCount: 5,
    lockedUntil: "2026-11-02T08:15:00.000Z",
    lastFailedLoginAt: "2026-11-02T08:00:00.000Z",
  },
];

export const mockAuditLogs = (): AuditLogRow[] => [
  {
    id: 2,
    at: "2026-11-02T08:00:00.000Z",
    userId: null,
    userName: null,
    action: "lock",
    entityType: "user",
    entityId: "31",
    method: "POST",
    path: "/api/auth/login",
    details: { password: "***" },
  },
  {
    id: 1,
    at: "2026-11-01T16:30:00.000Z",
    userId: 1,
    userName: "Administrateur",
    action: "update",
    entityType: "work_order",
    entityId: "62",
    method: "PATCH",
    path: "/api/work-orders/62",
    details: null,
  },
];

export const mockFuelPrices = (): FuelPrice[] => [
  { effectiveFrom: "2000-01-01", pricePerLiter: 828, createdBy: null, createdAt: null },
  { effectiveFrom: "2026-10-01", pricePerLiter: 850, createdBy: 1, createdAt: "2026-09-30T16:00:00.000Z" },
];

export const mockDocumentTypes = (): VehicleDocumentType[] => VEHICLE_DOCUMENT_TYPE_SEED.map((type) => ({ ...type }));

export const mockKpi = {
  incidentsPerMonth: [
    { month: "2026-06", count: 3 },
    { month: "2026-07", count: 5 },
    { month: "2026-08", count: 2 },
    { month: "2026-09", count: 4 },
    { month: "2026-10", count: 6 },
    { month: "2026-11", count: 1 },
  ],
  preventiveCompliance: { planned: 24, doneOnTime: 21, rate: 0.875 },
  avgCost: { interventions: 18, totalCost: 1_260_000, averageCost: 70_000 },
} as const;

export function createMockStore() {
  return {
    backups: mockBackups(),
    notificationSettings: mockNotificationSettings(),
    incidents: mockIncidents(),
    tireMovements: mockTireMovements(),
    timeEntries: mockTimeEntries(),
    timeStats: mockTimeStats(),
    pendingInvoices: mockPendingInvoices(),
    lockedUsers: mockLockedUsers(),
    auditLogs: mockAuditLogs(),
    fuelPrices: mockFuelPrices(),
    documentTypes: mockDocumentTypes(),
  };
}

export type MockStore = ReturnType<typeof createMockStore>;
