import { useEffect, useRef } from "react";
import L from "leaflet";
import { escapeHtml } from "@/lib/escape-html";
import { formatPositionAge, groupByVehicle, hubCoordinates, hubName, splitTrack } from "@/lib/gps-display";
import type { MissionTrackEnd, MissionTrackPoint, VehiclePosition } from "@shared/contracts/gps";
import { letterIcon, positionFreshnessColor, useLeafletMap } from "./use-leaflet-map";

type Props = {
  pickup: MissionTrackEnd | null;
  delivery: MissionTrackEnd | null;
  /** Trace complète ; `null` pour qui n'y a pas droit (chef d'atelier) : seule la dernière position est tracée. */
  points: MissionTrackPoint[] | null;
  lastPosition: VehiclePosition | null;
};

function endLatLng(end: MissionTrackEnd | null): [number, number] | null {
  if (!end) return null;
  if (typeof end.lat === "number" && typeof end.lng === "number") return [end.lat, end.lng];
  return hubCoordinates(end.hubCode);
}

function endPopup(title: string, end: MissionTrackEnd): string {
  const label = hubName(end.hubCode) ?? end.address ?? "";
  return `<div style="font-family:sans-serif"><strong>${escapeHtml(title)}</strong><div>${escapeHtml(label)}</div></div>`;
}

/**
 * Carte d'une mission : repères A et B, trace en trait plein, points suspects à part (cercles
 * orange creux, hors du trait), dernière position avec cercle de précision.
 */
export default function MissionTrackMap({ pickup, delivery, points, lastPosition }: Props) {
  const { containerRef, map } = useLeafletMap({ scrollWheelZoom: false });
  const layerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];

    const a = endLatLng(pickup);
    const b = endLatLng(delivery);
    if (a && pickup) {
      L.marker(a, { icon: letterIcon("A", "#2563eb") }).bindPopup(endPopup("Départ", pickup)).addTo(layer);
      bounds.push(a);
    }
    if (b && delivery) {
      L.marker(b, { icon: letterIcon("B", "#16a34a") }).bindPopup(endPopup("Livraison", delivery)).addTo(layer);
      bounds.push(b);
    }
    // Trajet indicatif A vers B (à vol d'oiseau), en pointillé.
    if (a && b) L.polyline([a, b], { color: "#94a3b8", weight: 2, dashArray: "6 8", opacity: 0.8 }).addTo(layer);

    if (points) {
      const { reliable, suspect } = splitTrack(points);
      for (const group of groupByVehicle(reliable)) {
        if (group.length > 1) {
          L.polyline(group.map((p) => [p.lat, p.lng] as [number, number]), { color: "#1d4ed8", weight: 4, opacity: 0.9 }).addTo(layer);
        }
      }
      for (const p of reliable) bounds.push([p.lat, p.lng]);
      for (const p of suspect) {
        L.circleMarker([p.lat, p.lng], { radius: 6, color: "#d97706", weight: 2, fillOpacity: 0, dashArray: "2 3" })
          .bindPopup('<div style="font-family:sans-serif"><strong>Point suspect</strong><div>Relevé écarté de la trace (vitesse ou saut impossible).</div></div>')
          .addTo(layer);
        bounds.push([p.lat, p.lng]);
      }
    }

    if (lastPosition) {
      const here: [number, number] = [lastPosition.lat, lastPosition.lng];
      const color = positionFreshnessColor(lastPosition.ageSeconds);
      if (typeof lastPosition.accuracyM === "number" && lastPosition.accuracyM > 0) {
        L.circle(here, { radius: lastPosition.accuracyM, color, weight: 1, fillOpacity: 0.12 }).addTo(layer);
      }
      L.circleMarker(here, { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 })
        .bindPopup(`<div style="font-family:sans-serif"><strong>Dernière position</strong><div>${escapeHtml(formatPositionAge(lastPosition.ageSeconds))}</div></div>`)
        .addTo(layer);
      bounds.push(here);
    }

    if (bounds.length > 0) map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 11 });
  }, [map, pickup, delivery, points, lastPosition]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full rounded-lg"
      data-testid="mission-track-map"
      role="img"
      aria-label="Carte de la mission : départ, livraison et position"
    />
  );
}
