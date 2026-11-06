import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Archive, RotateCcw } from "lucide-react";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/layout/page-header";
import { PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system/premium-data-table";
import { AlertModal } from "@/components/design-system/alert-modal";
import { LoadingError } from "@/components/ui/loading-error";
import { Button } from "@/components/ui/button";
import { appToast } from "@/lib/app-toast";
import { userMessageOf } from "@/lib/api-error";
import { formatDate, translateStatus } from "@/lib/utils";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useRestoreVehicle, type RetiredVehicle } from "@/hooks/useVehicles";

function vehicleLabel(vehicle: RetiredVehicle): string {
  return [vehicle.brand, vehicle.model].filter(Boolean).join(" ") || "-";
}

/**
 * Véhicules retirés de la flotte (suppression douce) et leur remise en service. Admin seul, comme
 * `GET /api/vehicles/archived` et `POST /api/vehicles/:id/restore`.
 */
export default function RetiredVehiclesPage() {
  const [, setLocation] = useLocation();
  const [target, setTarget] = useState<RetiredVehicle | null>(null);

  // Clé écrite en littéral : realtime-invalidation-keys.test.ts relève les clés posées par les écrans
  // sous cette forme. Elle vaut RETIRED_VEHICLES_KEY, que le hook de restauration met à jour.
  const query = useQuery<RetiredVehicle[]>({ queryKey: ["/api/vehicles/archived"] });

  const restore = useRestoreVehicle({
    onSuccess: (response) => {
      appToast({ title: "Véhicule restauré", description: response.message, variant: "success" });
      setTarget(null);
    },
    onError: (error) => {
      appToast({
        title: "Restauration impossible",
        description: userMessageOf(error, "Le véhicule n'a pas pu être remis dans la flotte."),
        variant: "destructive",
      });
    },
  });
  const submitRestore = useSingleFlightMutate(restore.mutate);

  const columns: PremiumDataTableColumn<RetiredVehicle>[] = [
    {
      id: "registration",
      header: "Immatriculation",
      cell: (v) => <span className="font-medium text-foreground">{v.registration_number}</span>,
    },
    { id: "vehicle", header: "Véhicule", cell: (v) => <span className="text-foreground">{vehicleLabel(v)}</span> },
    {
      id: "status",
      header: "Dernier statut",
      cell: (v) => <span className="text-muted-foreground">{v.status ? translateStatus(v.status) : "-"}</span>,
    },
    { id: "retiredAt", header: "Retiré le", cell: (v) => formatDate(v.archived_at) },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (v) => (
        <Button
          size="sm"
          variant="outline"
          onClick={(event) => {
            // La ligne ouvre la fiche : le bouton ne doit pas déclencher aussi la navigation.
            event.stopPropagation();
            setTarget(v);
          }}
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Restaurer
        </Button>
      ),
    },
  ];

  return (
    <PageLayout>
      <PageHeader
        title="Véhicules retirés"
        subtitle="Véhicules sortis de la flotte dont l'historique est conservé. Un véhicule restauré revient dans la flotte."
      />
      {query.isLoading || query.error ? (
        <LoadingError isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PremiumDataTable
          columns={columns}
          rows={query.data ?? []}
          rowKey={(v) => v.id}
          // Fiche en consultation seule : le détail d'un véhicule retiré n'y propose aucune écriture.
          onRowClick={(v) => setLocation(`/vehicles/${v.id}?returnTo=${encodeURIComponent("/admin/retired-vehicles")}`)}
          emptyState={
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Archive className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Aucun véhicule retiré</p>
              <p className="text-sm text-muted-foreground">Un véhicule retiré de la flotte apparaîtra ici.</p>
            </div>
          }
        />
      )}
      <AlertModal
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        variant="confirm"
        title="Restaurer ce véhicule ?"
        description={
          target
            ? `${target.registration_number} revient dans la flotte. Les plans de maintenance désactivés par le retrait sont réactivés s'ils n'ont pas été modifiés depuis.`
            : undefined
        }
        confirmLabel="Restaurer"
        cancelLabel="Annuler"
        onConfirm={() => target && submitRestore({ id: target.id })}
      />
    </PageLayout>
  );
}
