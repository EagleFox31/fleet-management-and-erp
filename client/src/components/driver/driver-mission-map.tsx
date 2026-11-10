import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_TILES } from "@/lib/map-tiles";

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface DriverMissionMapProps {
  origin: MapPoint | null;
  destination: MapPoint | null;
  /** Trace déjà reçue par le serveur, puis points relevés et pas encore envoyés. */
  trace: MapPoint[];
  current: (MapPoint & { accuracyM: number | null }) | null;
  className?: string;
}

function markerIcon(label: string, tone: "origin" | "destination"): L.DivIcon {
  const color = tone === "origin" ? "hsl(var(--primary))" : "hsl(var(--success))";
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:700 13px/1 system-ui,sans-serif">${label}</div>`,
  });
}

/**
 * Carte de la mission (Leaflet, sans surcouche React : même motif que la carte direction).
 * Départ A, arrivée B, droite A-B indicative (à vol d'oiseau, pas un itinéraire), trace du
 * téléphone et position courante. Les tuiles viennent de `@/lib/map-tiles`. Hors réseau, les
 * tuiles manquent mais repères et trace restent tracés sur le fond vide.
 */
export function DriverMissionMap({ origin, destination, trace, current, className }: DriverMissionMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([4.05, 9.77], 6);
    L.tileLayer(MAP_TILES.url, { attribution: MAP_TILES.attribution, maxZoom: MAP_TILES.maxZoom }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngTuple[] = [];

    if (origin && destination) {
      L.polyline(
        [[origin.lat, origin.lng], [destination.lat, destination.lng]],
        { color: "#64748b", weight: 3, dashArray: "6 8", opacity: 0.9 },
      ).addTo(layer);
    }
    if (origin) {
      L.marker([origin.lat, origin.lng], { icon: markerIcon("A", "origin"), title: "Départ" }).addTo(layer);
      bounds.push([origin.lat, origin.lng]);
    }
    if (destination) {
      L.marker([destination.lat, destination.lng], { icon: markerIcon("B", "destination"), title: "Arrivée" }).addTo(layer);
      bounds.push([destination.lat, destination.lng]);
    }
    if (trace.length > 1) {
      L.polyline(trace.map((p) => [p.lat, p.lng] as L.LatLngTuple), { color: "#2563eb", weight: 4, opacity: 0.95 }).addTo(layer);
    }
    if (current) {
      if (current.accuracyM && current.accuracyM > 0) {
        L.circle([current.lat, current.lng], { radius: current.accuracyM, color: "#2563eb", weight: 1, fillOpacity: 0.12 }).addTo(layer);
      }
      L.circleMarker([current.lat, current.lng], {
        radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1,
      }).addTo(layer);
      bounds.push([current.lat, current.lng]);
    }

    // Cadrage une fois par jeu de repères, pour ne pas arracher la carte au chauffeur qui la déplace.
    if (!fittedRef.current && bounds.length > 0) {
      if (bounds.length === 1) map.setView(bounds[0], 13);
      else map.fitBounds(L.latLngBounds(bounds), { padding: [28, 28], maxZoom: 14 });
      fittedRef.current = true;
    }
  }, [origin, destination, trace, current]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Carte de la mission : départ, arrivée et position du téléphone"
      className={className}
      data-testid="driver-mission-map"
    />
  );
}

export default DriverMissionMap;
