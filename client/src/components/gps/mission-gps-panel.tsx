import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Clock, MapPinOff, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingError } from "@/components/ui/loading-error";
import { Skeleton } from "@/components/ui/skeleton";
import { MissionGeoField } from "@/components/gps/mission-geo-field";
import { useMissionTrack, useNow, useVehiclePositions } from "@/hooks/use-gps";
import { appToast } from "@/lib/app-toast";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  adoptStoredGeo,
  ageSecondsOf,
  canEditMissionGeo,
  canViewTrack,
  describeNearestHub,
  formatPositionAge,
  geoEditorReady,
  geoInputOf,
  geoSelectionOf,
  missionGeoEditable,
  positionFreshness,
  sameGeoPair,
  splitTrack,
  type GeoPair,
} from "@/lib/gps-display";
import { missionGeoPath, missionTrackPath, type MissionTrackResponse, type VehiclePosition } from "@shared/contracts/gps";

const MissionTrackMap = lazy(() => import("./mission-track-map"));

const FRESHNESS_TEXT = {
  fresh: "text-success",
  stale: "text-warning-text",
  old: "text-muted-foreground",
} as const;

/**
 * Onglet « Suivi GPS » d'une mission : dernière position et son âge, trace (logistique, direction,
 * admin), points A/B modifiables (admin, logistique). Le chef d'atelier ne reçoit que la dernière
 * position : la trace n'est ni demandée ni dessinée pour lui.
 */
export function MissionGpsPanel({ missionId, status, role }: { missionId: number; status?: string | null; role?: string | null }) {
  const showTrack = canViewTrack(role);
  const trackQuery = useMissionTrack(missionId, role);
  const positionsQuery = useVehiclePositions(role);
  const now = useNow();

  const lastPosition: VehiclePosition | null = useMemo(
    () => (positionsQuery.data ?? []).find((p) => p.missionId === missionId) ?? null,
    [positionsQuery.data, missionId],
  );
  const track = showTrack ? trackQuery.data ?? null : null;
  const split = useMemo(() => (track ? splitTrack(track.points) : null), [track]);

  const age = lastPosition ? ageSecondsOf(lastPosition.recordedAt, now) : null;
  const freshness = age === null ? null : positionFreshness(age);

  // Le formulaire n'existe qu'une fois la trace chargée : sinon il s'initialiserait « sans point » et
  // un enregistrement effacerait les points A/B déjà saisis.
  const canEdit = geoEditorReady(track, role, status);
  if (positionsQuery.error || (showTrack && trackQuery.error)) {
    return (
      <LoadingError
        error={positionsQuery.error ?? trackQuery.error}
        onRetry={() => {
          void positionsQuery.refetch();
          if (showTrack) void trackQuery.refetch();
        }}
      />
    );
  }
  if (positionsQuery.isLoading || (showTrack && trackQuery.isLoading)) {
    return <Skeleton className="h-80 w-full rounded-xl" />;
  }

  const hasAnyPoint = !!lastPosition || (track?.points.length ?? 0) > 0;

  return (
    <div className="space-y-4" data-testid="mission-gps-panel">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Position du camion
            {lastPosition && age !== null && freshness && (
              <span className={`inline-flex items-center gap-1 text-sm font-medium ${FRESHNESS_TEXT[freshness]}`} data-testid="gps-position-age">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {formatPositionAge(age)}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lastPosition ? (
            <p className="text-sm text-muted-foreground" data-testid="gps-position-where">
              {describeNearestHub(lastPosition.lat, lastPosition.lng)}
              {typeof lastPosition.accuracyM === "number" ? `, précision ${Math.round(lastPosition.accuracyM)} m` : ""}
              {freshness === "old" ? ". Position ancienne : le téléphone n'envoie plus." : ""}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="gps-no-position">
              <MapPinOff className="h-4 w-4" aria-hidden="true" />
              Aucune position reçue pour cette mission.
            </p>
          )}
          {split && split.suspect.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-warning-text" data-testid="gps-suspect-note">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {split.suspect.length} point{split.suspect.length > 1 ? "s" : ""} suspect{split.suspect.length > 1 ? "s" : ""} écarté{split.suspect.length > 1 ? "s" : ""} de la trace (cercles orange).
            </p>
          )}
          <div className="h-80 w-full overflow-hidden rounded-lg border border-border">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <MissionTrackMap
                pickup={track?.pickup ?? null}
                delivery={track?.delivery ?? null}
                points={track?.points ?? null}
                lastPosition={lastPosition}
                lastPositionAgeSeconds={age}
              />
            </Suspense>
          </div>
          {track?.truncated && (
            <p className="text-xs text-muted-foreground">Trace tronquée : seuls les premiers relevés sont affichés.</p>
          )}
          {!hasAnyPoint && (
            <p className="text-xs text-muted-foreground">
              La position n'est relevée que lorsque l'appli du chauffeur est ouverte au premier plan, pendant la mission en cours.
            </p>
          )}
        </CardContent>
      </Card>

      {canEdit && track && <MissionGeoEditor key={missionId} missionId={missionId} track={track} />}
    </div>
  );
}

/** Formulaire des points A/B ; monté seulement quand la trace (donc les points stockés) est connue. */
function MissionGeoEditor({ missionId, track }: { missionId: number; track: MissionTrackResponse }) {
  const storedPickup = track.pickup;
  const storedDelivery = track.delivery;
  const stored = useMemo<GeoPair>(
    () => ({ pickup: geoSelectionOf(storedPickup), delivery: geoSelectionOf(storedDelivery) }),
    [storedPickup, storedDelivery],
  );
  const [local, setLocal] = useState<GeoPair>(stored);
  const previousStored = useRef<GeoPair>(stored);
  const dirty = !sameGeoPair(local, stored);

  // Une mise à jour serveur (temps réel) ne remplace pas une saisie en cours.
  useEffect(() => {
    const before = previousStored.current;
    previousStored.current = stored;
    setLocal((current) => adoptStoredGeo(current, before, stored));
  }, [stored]);

  const save = useMutation({
    mutationFn: async (vars: { id: number; pickup: GeoPair["pickup"]; delivery: GeoPair["delivery"] }) =>
      apiRequest("PATCH", missionGeoPath(vars.id), { pickup: geoInputOf(vars.pickup), delivery: geoInputOf(vars.delivery) }),
    onSuccess: (_data, vars) => {
      appToast({ title: "Points enregistrés", description: "Le départ et la livraison sont à jour sur la carte.", variant: "success" });
      // Resynchronisation locale (détail, liste, trace) ; les autres profils la reçoivent par mission_updated { geo: true }.
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${vars.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      queryClient.invalidateQueries({ queryKey: [missionTrackPath(vars.id)] });
    },
    onError: (error: unknown) => {
      appToast({ title: "Enregistrement impossible", description: userMessageOf(error, "Les points n'ont pas pu être enregistrés."), variant: "destructive" });
    },
  });

  return (
    <Card data-testid="mission-geo-edit">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Points de départ et de livraison</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MissionGeoField which="pickup" value={local.pickup} onChange={(pickup) => setLocal((c) => ({ ...c, pickup }))} other={local.delivery} disabled={save.isPending} />
        <MissionGeoField which="delivery" value={local.delivery} onChange={(delivery) => setLocal((c) => ({ ...c, delivery }))} other={local.pickup} disabled={save.isPending} />
        <Button
          type="button"
          size="sm"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ id: missionId, pickup: local.pickup, delivery: local.delivery })}
          data-testid="geo-save"
        >
          <Save className="mr-2 h-4 w-4" aria-hidden="true" />
          Enregistrer les points
        </Button>
      </CardContent>
    </Card>
  );
}
