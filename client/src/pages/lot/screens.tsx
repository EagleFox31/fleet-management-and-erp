import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BackupsPanel } from "@/components/admin/backups-panel";
import { PendingInvoicesTable } from "@/components/billing/pending-invoices-table";
import { IncidentForm } from "@/components/incidents/incident-form";
import { IncidentList } from "@/components/incidents/incident-list";
import { TireMovementsTable } from "@/components/inventory/tire-movements-table";
import { TimeGrid } from "@/components/time-tracking/time-grid";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";

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

export function TimeTrackingScreen() {
  const { user } = useAuth();
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const [year, month] = period.split("-").map(Number);
  return (
    <div className="space-y-4">
      <Input type="month" className="w-44" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} aria-label="Mois" />
      <TimeGrid year={year} month={month} readOnly={user?.role === "driver"} />
    </div>
  );
}

type VehicleOption = { id: number; registrationNumber?: string; registration?: string };

export function IncidentDeclareScreen() {
  const vehicles = useQuery<VehicleOption[]>({ queryKey: ["/api/vehicles"] });
  const [chosen, setChosen] = useState<number | null>(null);
  const list = Array.isArray(vehicles.data) ? vehicles.data : [];
  const vehicleId = chosen ?? list[0]?.id;
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      {list.length > 1 && (
        <select
          className="h-9 w-full rounded-md border bg-background px-2"
          value={vehicleId ?? ""}
          onChange={(e) => setChosen(Number(e.target.value))}
          aria-label="Véhicule"
        >
          {list.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registrationNumber ?? v.registration ?? `Véhicule ${v.id}`}
            </option>
          ))}
        </select>
      )}
      {vehicleId ? (
        <IncidentForm vehicleId={vehicleId} />
      ) : (
        <p className="text-sm text-muted-foreground">Aucun véhicule affecté.</p>
      )}
    </div>
  );
}
