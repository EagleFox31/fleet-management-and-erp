import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BackupsPanel } from "@/components/admin/backups-panel";
import { PendingInvoicesTable } from "@/components/billing/pending-invoices-table";
import { FuelAnomaliesTable } from "@/components/fuel/fuel-anomalies-table";
import { FuelVouchersTable } from "@/components/fuel/fuel-vouchers-table";
import { IncidentForm } from "@/components/incidents/incident-form";
import { IncidentList } from "@/components/incidents/incident-list";
import { TireMovementsTable } from "@/components/inventory/tire-movements-table";
import { TimeGrid } from "@/components/time-tracking/time-grid";
import { Input } from "@/components/ui/input";
import { LoadingError } from "@/components/ui/loading-error";
import { useAuth } from "@/hooks/useAuth";
import { driverVehicleOptions, fleetVehicleOptions } from "@/lib/incident-vehicles";
import { canEditTankCapacity, canWriteFuel, canWriteTimeTracking } from "@shared/constants/roles";

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

export function PendingInvoicesScreen() {
  return <PendingInvoicesTable />;
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

export function IncidentDeclareScreen() {
  const { user } = useAuth();
  const isDriver = user?.role === "driver";
  // Chauffeur : ses véhicules via ses missions ; administrateur : la flotte.
  const me = useQuery<unknown>({ queryKey: ["/api/drivers/me"], enabled: isDriver });
  const fleet = useQuery<unknown>({ queryKey: ["/api/vehicles"], enabled: !isDriver });
  const source = isDriver ? me : fleet;
  const list = isDriver
    ? driverVehicleOptions(me.data as Parameters<typeof driverVehicleOptions>[0])
    : fleetVehicleOptions(fleet.data);
  const [chosen, setChosen] = useState<number | null>(null);
  const vehicleId = list.some((v) => v.id === chosen) ? chosen : list[0]?.id;

  if (source.isLoading || source.isError) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <LoadingError isLoading={source.isLoading} error={source.error} onRetry={() => source.refetch()} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      {list.length > 1 && (
        <select
          className="h-9 w-full rounded-md border bg-background px-2"
          value={vehicleId ?? ""}
          onChange={(e) => setChosen(Number(e.target.value))}
          aria-label="Véhicule"
          data-testid="select-incident-vehicle"
        >
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      )}
      {vehicleId ? (
        <IncidentForm vehicleId={vehicleId} />
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="incident-no-vehicle">Aucun véhicule affecté.</p>
      )}
    </div>
  );
}
