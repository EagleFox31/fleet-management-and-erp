/**
 * Composants des écrans du lot, par `id` de `lot-screens.ts`.
 *
 * Un écran livré s'ajoute ici : un import et une ligne dans la table.
 * Un `id` absent affiche la page vide (`pages/lot/screen-placeholder.tsx`).
 * Le composant reçoit `{ screen, params }`.
 */
import type { ComponentType } from "react";
import type { LotScreen } from "@/config/lot-screens";
import LockedUsersPage from "@/pages/admin/locked-users";
import AuditLogsPage from "@/pages/admin/audit-logs";
import VehicleDocumentTypesPage from "@/pages/admin/vehicle-document-types";
import {
  BackupsScreen,
  IncidentDeclareScreen,
  IncidentsListScreen,
  PendingInvoicesScreen,
  TimeTrackingScreen,
  TireMovementsScreen,
} from "@/pages/lot/screens";

export type LotScreenComponentProps = {
  screen: LotScreen;
  params: Record<string, string | undefined>;
};

export const LOT_SCREEN_COMPONENTS: Partial<Record<string, ComponentType<LotScreenComponentProps>>> = {
  "admin-locked-users": LockedUsersPage,
  "admin-audit-logs": AuditLogsPage,
  "admin-vehicle-document-types": VehicleDocumentTypesPage,
};
