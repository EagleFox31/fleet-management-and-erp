import { useState } from "react";
import { Redirect } from "wouter";
import { BackupsPanel } from "@/components/admin/backups-panel";
import { PendingInvoicesTable } from "@/components/billing/pending-invoices-table";
import { InvoicesAwaitingPaymentTable } from "@/components/finance/invoices-awaiting-payment-table";
import { WithholdingsSummary } from "@/components/finance/withholdings-summary";
import { FuelAnomaliesTable } from "@/components/fuel/fuel-anomalies-table";
import { FuelVouchersTable } from "@/components/fuel/fuel-vouchers-table";
import { IncidentList } from "@/components/incidents/incident-list";
import { TireMovementsTable } from "@/components/inventory/tire-movements-table";
import { TimeGrid } from "@/components/time-tracking/time-grid";
import { Input } from "@/components/ui/input";
import { TariffGridTable } from "@/components/operations/tariff-grid-table";
import { MissionOperationsTable } from "@/components/operations/mission-operations-table";
import { MISSION_OPERATIONS_WRITE_ROLES } from "@shared/constants/roles";
import { useAuth } from "@/hooks/useAuth";
import { canEditTankCapacity, canWriteFinanceReceivable, canWriteFuel, canWriteTariffGrid, canWriteTimeTracking } from "@shared/constants/roles";

/** Écrans du lot : fines enveloppes, la garde de rôle et de drapeau est posée par `lot-routes`. */

export function BackupsScreen() {
  return <BackupsPanel />;
}

export function IncidentsListScreen() {
  return <IncidentList />;
}

export function TireMovementsScreen() {
  return <TireMovementsTable />;
}

export function MissionOperationsScreen() {
  const { user } = useAuth();
  const canWrite = !!user?.role && (MISSION_OPERATIONS_WRITE_ROLES as readonly string[]).includes(user.role);
  return <MissionOperationsTable canWrite={canWrite} />;
}

/** Secrétariat et logistique consultent ; création, modification et désactivation : admin et direction. */
export function TariffGridScreen() {
  const { user } = useAuth();
  return <TariffGridTable readOnly={!canWriteTariffGrid(user?.role)} />;
}

export function PendingInvoicesScreen() {
  return <PendingInvoicesTable />;
}

/** La direction consulte sans déposer (hors FINANCE_RECEIVABLE_WRITE_ROLES). */
export function InvoicesAwaitingPaymentScreen() {
  const { user } = useAuth();
  return <InvoicesAwaitingPaymentTable readOnly={!canWriteFinanceReceivable(user?.role)} />;
}

/** Lecture seule pour tous les rôles de FINANCE_RECEIVABLE_READ_ROLES : aucune action. */
export function WithholdingsScreen() {
  return <WithholdingsSummary />;
}

/** Chef d'atelier et direction consultent les bons sans les valider (hors FUEL_WRITE_ROLES). */
export function FuelVouchersScreen() {
  const { user } = useAuth();
  return <FuelVouchersTable readOnly={!canWriteFuel(user?.role)} />;
}

/** Chef d'atelier et direction consultent les anomalies sans les traiter (hors FUEL_WRITE_ROLES). */
export function FuelAnomaliesScreen() {
  const { user } = useAuth();
  return <FuelAnomaliesTable readOnly={!canWriteFuel(user?.role)} canEditTankCapacity={canEditTankCapacity(user?.role)} />;
}

export function TimeTrackingScreen() {
  const { user } = useAuth();
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [year, month] = period.split("-").map(Number);
  return (
    <div className="space-y-4">
      <Input type="month" className="w-44" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Mois" />
      <TimeGrid year={year} month={month} readOnly={!canWriteTimeTracking(user?.role)} />
    </div>
  );
}

/**
 * Un seul point d'entrée chauffeur : le tableau de bord (`/driver`), qui envoie à `/api/driver/breakdowns`.
 * L'ancienne adresse redirige vers lui, sans entrée de menu supplémentaire.
 */
export function IncidentDeclareScreen() {
  return <Redirect to="/driver" />;
}
