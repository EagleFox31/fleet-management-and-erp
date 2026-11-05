/**
 * Composants des écrans du lot, par `id` de `lot-screens.ts`.
 *
 * Un écran livré s'ajoute ici : un import et une ligne dans la table.
 * Un `id` absent affiche la page vide (`pages/lot/screen-placeholder.tsx`).
 * Le composant reçoit `{ screen, params }`.
 */
import { lazy, type ComponentType } from "react";
import type { LotScreen } from "@/config/lot-screens";
import LockedUsersPage from "@/pages/admin/locked-users";
import AuditLogsPage from "@/pages/admin/audit-logs";
import VehicleDocumentTypesPage from "@/pages/admin/vehicle-document-types";
import {
  BackupsScreen,
  FuelAnomaliesScreen,
  FuelVouchersScreen,
  IncidentDeclareScreen,
  IncidentsListScreen,
  MissionOperationsScreen,
  PendingInvoicesScreen,
  TimeTrackingScreen,
  TireMovementsScreen,
} from "@/pages/lot/screens";

export type LotScreenComponentProps = {
  screen: LotScreen;
  params: Record<string, string | undefined>;
};

export const LOT_SCREEN_COMPONENTS: Partial<Record<string, ComponentType<LotScreenComponentProps>>> = {
  scope: lazy(() => import("@/pages/scope")),
  "admin-locked-users": LockedUsersPage,
  "admin-audit-logs": AuditLogsPage,
  "admin-vehicle-document-types": VehicleDocumentTypesPage,
  "admin-backups": BackupsScreen,
  "incident-declare": IncidentDeclareScreen,
  "incidents-list": IncidentsListScreen,
  "tire-movements": TireMovementsScreen,
  "fuel-vouchers": FuelVouchersScreen,
  "fuel-anomalies": FuelAnomaliesScreen,
  "time-tracking": TimeTrackingScreen,
  "pending-invoices": PendingInvoicesScreen,
  "mission-operations": MissionOperationsScreen,
};
