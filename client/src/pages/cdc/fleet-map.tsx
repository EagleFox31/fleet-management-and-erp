import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link } from "wouter";
import { Clock, MapPinOff } from "lucide-react";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/layout/page-header";
import { PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system/premium-data-table";
import { LoadingError } from "@/components/ui/loading-error";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { useNow, useVehiclePositions } from "@/hooks/use-gps";
import { ageSecondsOf, describeNearestHub, formatPositionAge, positionFreshness } from "@/lib/gps-display";
import type { VehiclePosition } from "@shared/contracts/gps";

const FleetPositionsMap = lazy(() => import("@/components/gps/fleet-positions-map"));

const FRESHNESS_TEXT = {
  fresh: "text-success",
  stale: "text-warning-text",
  old: "text-muted-foreground",
} as const;

/**
 * Carte de la flotte (CDC-6) : dernière position connue de chaque véhicule qui en a une, avec son
 * âge. Source : GET /api/vehicle-positions (téléphones des chauffeurs en mission, balises plus
 * tard). Mise à jour par `vehicle_position_updated`. Un véhicule sans position n'est pas listé :
 * jamais de point déduit.
 */
export default function FleetMapPage() {
  const { user } = useAuth();
  const query = useVehiclePositions(user?.role);
  const now = useNow();
  const [selected, setSelected] = useState<number | null>(null);
  const onSelect = useCallback((vehicleId: number) => setSelected(vehicleId), []);

  const rows = useMemo(
    () =>
      (query.data ?? []).map((p) => ({ ...p, age: ageSecondsOf(p.recordedAt, now) })),
    [query.data, now],
  );

  const columns: PremiumDataTableColumn<VehiclePosition & { age: number }>[] = [
    {
      id: "vehicle",
      header: "Véhicule",
      cell: (p) => (
        <div>
          <p className="font-medium text-foreground">{p.registrationNumber ?? `Véhicule ${p.vehicleId}`}</p>
          <p className="text-xs text-muted-foreground">{[p.brand, p.model].filter(Boolean).join(" ")}</p>
        </div>
      ),
    },
    {
      id: "mission",
      header: "Mission",
      cell: (p) =>
        p.missionId !== null ? (
          <Link
            href={`/missions/${p.missionId}`}
            className="text-primary-text underline-offset-2 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {p.orderNumber ?? `Mission ${p.missionId}`}
          </Link>
        ) : (
          <span className="text-muted-foreground">Hors mission</span>
        ),
    },
    {
      id: "where",
      header: "Dernière position",
      cell: (p) => (
        <div>
          <p className="text-foreground">{describeNearestHub(p.lat, p.lng)}</p>
          <p className={`flex items-center gap-1 text-xs font-medium ${FRESHNESS_TEXT[positionFreshness(p.age)]}`}>
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatPositionAge(p.age)}
          </p>
        </div>
      ),
    },
    {
      id: "speed",
      header: "Vitesse",
      align: "right",
      cell: (p) => (typeof p.speedKmh === "number" ? `${Math.round(p.speedKmh)} km/h` : "-"),
    },
  ];

  return (
    <PageLayout>
      <PageHeader title="Carte de la flotte" subtitle="Dernière position connue des véhicules en mission, avec son âge." />
      {query.isLoading || query.error ? (
        <LoadingError isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="h-80 overflow-hidden rounded-xl border border-border lg:col-span-3 lg:h-[32rem]">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <FleetPositionsMap positions={rows} selectedVehicleId={selected} onSelect={onSelect} />
            </Suspense>
          </div>
          <div className="lg:col-span-2" data-testid="fleet-positions-table">
            <PremiumDataTable
              columns={columns}
              rows={rows}
              rowKey={(p) => p.vehicleId}
              onRowClick={(p) => setSelected(p.vehicleId)}
              rowClassName={(p) => (p.vehicleId === selected ? "bg-primary/5" : undefined)}
              emptyState={
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <MapPinOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm font-medium text-foreground">Aucune position reçue</p>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Les positions apparaissent dès qu'un chauffeur en mission partage celle de son téléphone.
                  </p>
                </div>
              }
            />
          </div>
        </div>
      )}
    </PageLayout>
  );
}
