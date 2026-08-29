import { Clock, Route, Wrench } from "lucide-react";
import { KpiGrid, KpiTile } from "@/components/design-system";
import { formatDistance, formatPrice } from "@/lib/utils";
import type { ManagementExecutiveKpis } from "@shared/constants/management-dashboard";

type ManagementExecutiveKpisPanelProps = {
  kpis: ManagementExecutiveKpis;
};

function formatFcfPerKm(value: number | null): string {
  if (value == null) return "—";
  return `${formatPrice(Math.round(value))}/km`;
}

function formatHours(value: number | null): string {
  if (value == null) return "—";
  return `${value.toFixed(1)} h`;
}

export function ManagementExecutiveKpisPanel({ kpis }: ManagementExecutiveKpisPanelProps) {
  const { prk, cpkMaintenance, downtime } = kpis;

  return (
    <KpiGrid columns={3}>
      <KpiTile
        featured
        label="PRK"
        value={formatFcfPerKm(prk.fcfPerKm)}
        subValue={`${formatDistance(prk.totalKm)} · ${formatPrice(prk.directChargesHT)} HT`}
        icon={<Route className="h-4 w-4" />}
      />
      <KpiTile
        label="CPK atelier"
        value={formatFcfPerKm(cpkMaintenance.fcfPerKm)}
        subValue={`${formatPrice(cpkMaintenance.maintenanceHT)} · pneus ${formatPrice(cpkMaintenance.tireSupplierHT)}`}
        icon={<Wrench className="h-4 w-4" />}
        iconWrapperClassName="bg-amber-50 text-amber-700"
      />
      <KpiTile
        label="Immobilisation"
        value={formatHours(downtime.averageHoursPerCompletedOrder)}
        subValue={`${downtime.totalImmobilizationHours} h · ${downtime.completedWorkOrders} OT`}
        icon={<Clock className="h-4 w-4" />}
        iconWrapperClassName="bg-blue-50 text-blue-700"
      />
    </KpiGrid>
  );
}
