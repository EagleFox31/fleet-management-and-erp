import { TriangleAlert } from "lucide-react";
import { HeaderCard, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { INCIDENT_SEVERITY_LABELS, INCIDENT_STATUS_LABELS } from "@/components/incidents/incident-labels";
import { LoadingError } from "@/components/ui/loading-error";
import { useContractQuery } from "@/lib/contract-query";
import { formatDate } from "@/lib/utils";
import { INCIDENTS_PATH, incidentsResponseSchema, type Incident } from "@shared/contracts/incidents";

const SEVERITY_CLASS: Record<Incident["severity"], string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-700",
};

/** Liste des pannes déclarées, pour le chef d'atelier (T-52). */
export function IncidentList({ onRowClick }: { onRowClick?: (incident: Incident) => void }) {
  const incidents = useContractQuery(INCIDENTS_PATH, incidentsResponseSchema);

  const columns: PremiumDataTableColumn<Incident>[] = [
    { id: "createdAt", header: "Déclarée le", cell: (i) => formatDate(i.createdAt) },
    { id: "vehicle", header: "Véhicule", cell: (i) => i.vehicleRegistration ?? `Véhicule ${i.vehicleId}` },
    { id: "description", header: "Description", cell: (i) => i.description },
    { id: "reportedBy", header: "Par", cell: (i) => i.reportedByName ?? "—" },
    {
      id: "severity",
      header: "Gravité",
      cell: (i) => (
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${SEVERITY_CLASS[i.severity]}`}>
          {INCIDENT_SEVERITY_LABELS[i.severity]}
        </span>
      ),
    },
    { id: "status", header: "Statut", cell: (i) => INCIDENT_STATUS_LABELS[i.status] },
    { id: "workOrder", header: "OT", cell: (i) => (i.workOrderId ? `#${i.workOrderId}` : "—") },
  ];

  return (
    <div className="space-y-4" data-testid="incident-list">
      <HeaderCard moduleLabel="Atelier" title="Pannes déclarées" icon={<TriangleAlert className="h-5 w-5" />} />
      {incidents.isLoading || incidents.isError ? (
        <LoadingError isLoading={incidents.isLoading} error={incidents.error} onRetry={() => incidents.refetch()} />
      ) : (
        <PremiumDataTable
          columns={columns}
          rows={incidents.data ?? []}
          rowKey={(i) => i.id}
          onRowClick={onRowClick}
          rowClassName={(i) => (i.severity === "high" && i.status === "open" ? "border-l-2 border-l-red-400 bg-red-50/30" : "")}
          emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucune panne déclarée.</p>}
        />
      )}
    </div>
  );
}
