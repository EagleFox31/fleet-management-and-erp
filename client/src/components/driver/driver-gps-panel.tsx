import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { fr } from "date-fns/locale";
import { LocateFixed, LocateOff, Navigation } from "lucide-react";
import { useFeature } from "@/hooks/use-feature";
import { useGpsBufferReplay, useGpsTracking, useMissionTrack } from "@/hooks/use-gps-tracking";
import { buildGoogleDirectionsUrl, shouldTrack, type RoutePoint } from "@/lib/gps-tracking";

// Leaflet et ses styles ne chargent qu'à l'ouverture de la carte : la PWA reste légère ailleurs.
const DriverMissionMap = lazy(() => import("./driver-mission-map"));

export interface DriverGpsPanelMission {
  id: number;
  status: string;
  pickupAddress?: string | null;
  deliveryAddress?: string | null;
}

const TRACK_REFRESH_MS = 120_000;

function hasCoords(point: { lat: number | null | undefined; lng: number | null | undefined } | undefined): point is { lat: number; lng: number } {
  return !!point && typeof point.lat === "number" && typeof point.lng === "number";
}

function ago(timestamp: number | null): string | null {
  if (!timestamp) return null;
  return formatDistanceToNowStrict(timestamp, { locale: fr, addSuffix: false });
}

/**
 * Carte, itinéraire et partage de position de la mission active. Tout est derrière le drapeau
 * `gps` : coupé, rien n'est rendu et aucune position n'est relevée ni envoyée.
 */
export function DriverGpsPanel(props: { mission: DriverGpsPanelMission; userId: number | undefined }) {
  const gpsEnabled = useFeature("gps");
  if (!gpsEnabled) return null;
  return <DriverGpsPanelInner {...props} />;
}

/**
 * Rejoue les positions restées au téléphone pour des missions déjà closes (envoi coupé à la livraison).
 * Ne rend rien ; derrière le drapeau `gps`, comme le reste.
 */
export function DriverGpsBufferReplay(props: { userId: number | undefined; trackingMissionId: number | undefined }) {
  const gpsEnabled = useFeature("gps");
  if (!gpsEnabled) return null;
  return <DriverGpsBufferReplayInner {...props} />;
}

function DriverGpsBufferReplayInner({ userId, trackingMissionId }: { userId: number | undefined; trackingMissionId: number | undefined }) {
  useGpsBufferReplay({ userId, trackingMissionId });
  return null;
}

function DriverGpsPanelInner({ mission, userId }: { mission: DriverGpsPanelMission; userId: number | undefined }) {
  const tracking = shouldTrack(mission.status, true);
  const gps = useGpsTracking({ userId, missionId: mission.id, active: tracking });
  const { track, points } = useMissionTrack(mission.id, true, tracking ? TRACK_REFRESH_MS : false);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Références stables : la carte ne recrée pas ses repères A/B à chaque rendu.
  const pickupLat = track?.pickup.lat;
  const pickupLng = track?.pickup.lng;
  const deliveryLat = track?.delivery.lat;
  const deliveryLng = track?.delivery.lng;
  const origin = useMemo(
    () => (hasCoords({ lat: pickupLat, lng: pickupLng }) ? { lat: pickupLat as number, lng: pickupLng as number } : null),
    [pickupLat, pickupLng],
  );
  const destination = useMemo(
    () => (hasCoords({ lat: deliveryLat, lng: deliveryLng }) ? { lat: deliveryLat as number, lng: deliveryLng as number } : null),
    [deliveryLat, deliveryLng],
  );

  const trace = useMemo(
    () => [
      ...points.map((p) => ({ lat: p.lat, lng: p.lng })),
      ...gps.pending.map((p) => ({ lat: p.lat, lng: p.lng })),
    ],
    [points, gps.pending],
  );
  const lastServerPoint = points[points.length - 1];
  const current = gps.current ?? (lastServerPoint ? { lat: lastServerPoint.lat, lng: lastServerPoint.lng, accuracyM: lastServerPoint.accuracyM ?? null, at: Date.parse(lastServerPoint.recordedAt) } : null);

  const routeOrigin: RoutePoint | null = gps.current
    ? { lat: gps.current.lat, lng: gps.current.lng }
    : { lat: track?.pickup.lat, lng: track?.pickup.lng, address: mission.pickupAddress };
  const routeUrl = buildGoogleDirectionsUrl(routeOrigin, {
    lat: track?.delivery.lat,
    lng: track?.delivery.lng,
    address: mission.deliveryAddress,
  });

  const sentAgo = ago(gps.lastSentAt ?? (lastServerPoint ? Date.parse(lastServerPoint.recordedAt) : null));
  const showMap = !!(origin || destination || current || trace.length > 0);

  return (
    <section
      className="rounded-2xl bg-card border border-border shadow-sm overflow-hidden"
      aria-label="Carte de la mission"
      data-testid="driver-gps-panel"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-sm font-semibold text-foreground">Trajet</h2>
        {gps.state === "sharing" && (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success" data-testid="driver-gps-sharing">
            <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />
            Position partagée
          </span>
        )}
      </div>

      {showMap ? (
        <Suspense fallback={<div className="h-[220px] bg-muted animate-pulse" aria-hidden="true" />}>
          <DriverMissionMap
            origin={origin}
            destination={destination}
            trace={trace}
            current={current}
            className="h-[220px] w-full z-0"
          />
        </Suspense>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground bg-muted/40" data-testid="driver-gps-no-map">
          Les points de départ et d'arrivée ne sont pas renseignés. La carte apparaîtra avec votre position
          dès le départ confirmé.
        </p>
      )}

      <div className="px-4 py-3 space-y-2">
        {origin && destination && (
          <p className="text-xs text-muted-foreground">Ligne pointillée : droite entre A et B, à vol d'oiseau, pas la route à suivre.</p>
        )}
        {gps.state === "sharing" && sentAgo && (
          <p className="text-xs text-muted-foreground" data-testid="driver-gps-last-sent">Dernière position envoyée il y a {sentAgo}.</p>
        )}
        {gps.state === "waiting" && (
          <p className="text-xs text-muted-foreground" role="status" data-testid="driver-gps-waiting">
            Recherche de votre position en cours.
          </p>
        )}
        {gps.state === "denied" && (
          <div
            className="flex items-start gap-2 rounded-xl bg-warning/10 border border-warning/20 p-3"
            role="status"
            data-testid="driver-gps-denied"
          >
            <LocateOff className="h-4 w-4 mt-0.5 shrink-0 text-warning-text" aria-hidden="true" />
            <p className="text-xs text-warning-text leading-relaxed">
              Position non partagée : la localisation est refusée dans le navigateur. La mission continue normalement.
              Pour partager votre position, autorisez la localisation pour ce site dans les réglages du navigateur.
            </p>
          </div>
        )}
        {gps.state === "unavailable" && (
          <p className="text-xs text-muted-foreground" role="status" data-testid="driver-gps-unavailable">
            Position non partagée : ce téléphone ne permet pas la localisation depuis le navigateur.
          </p>
        )}
        {gps.sendError && (
          <p className="text-xs text-warning-text" role="status" data-testid="driver-gps-send-error">{gps.sendError}</p>
        )}
        {routeUrl && (
          <a
            href={routeUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="driver-gps-route-link"
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted active:scale-95 transition-transform"
          >
            <Navigation className="h-4 w-4 text-primary-text" aria-hidden="true" />
            Itinéraire
          </a>
        )}
      </div>
    </section>
  );
}
