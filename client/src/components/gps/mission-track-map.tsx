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
  /** Âge réel de la dernière position (horloge locale), pas l'âge figé de la réponse serveur. */
  lastPositionAgeSeconds?: number | null;
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
export default function MissionTrackMap({ pickup, delivery, points, lastPosition, lastPositionAgeSeconds }: Props) {
  const { containerRef, map } = useLeafletMap({ scrollWheelZoom: false });
  const layerRef = useRef<L.LayerGroup | null>(null);
  const hereLayerRef = useRef<L.LayerGroup | null>(null);
  const hereRef = useRef<{ dot: L.CircleMarker; accuracy: L.Circle | null } | null>(null);
  // Cadrage une seule fois : une mise à jour temps réel ne doit pas déplacer la vue.
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;
    // Couche à part : le tracé est redessiné à chaque mise à jour, le repère de position non.
    const hereLayer = L.layerGroup().addTo(map);
    hereLayerRef.current = hereLayer;
    return () => {
      layer.remove();
      hereLayer.remove();
      layerRef.current = null;
      hereLayerRef.current = null;
      hereRef.current = null;
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

    // Le repère de la dernière position vit dans son propre effet (mis à jour sur place) ; on le
    // relit ici seulement pour le cadrage initial.
    const dot = hereRef.current?.dot.getLatLng();
    if (dot) bounds.push([dot.lat, dot.lng]);
    if (!fittedRef.current && bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 11 });
      fittedRef.current = true;
    }
  }, [map, pickup, delivery, points]);

  const lat = lastPosition?.lat;
  const lng = lastPosition?.lng;
  const accuracyM = lastPosition?.accuracyM;
  useEffect(() => {
    const layer = hereLayerRef.current;
    if (!map || !layer) return;
    if (typeof lat !== "number" || typeof lng !== "number") {
      if (hereRef.current) {
        hereRef.current.accuracy?.remove();
        hereRef.current.dot.remove();
        hereRef.current = null;
      }
      return;
    }
    const here: [number, number] = [lat, lng];
    const color = positionFreshnessColor(lastPositionAgeSeconds ?? 0);
    const popup = `<div style="font-family:sans-serif"><strong>Dernière position</strong><div>${escapeHtml(formatPositionAge(lastPositionAgeSeconds ?? 0))}</div></div>`;
    let current = hereRef.current;
    if (!current) {
      current = {
        dot: L.circleMarker(here, { radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).bindPopup(popup).addTo(layer),
        accuracy: null,
      };
      hereRef.current = current;
      if (!fittedRef.current) {
        map.fitBounds(L.latLngBounds([here]), { padding: [32, 32], maxZoom: 11 });
        fittedRef.current = true;
      }
    } else {
      current.dot.setLatLng(here);
      current.dot.setStyle({ fillColor: color });
      current.dot.setPopupContent(popup);
    }
    if (typeof accuracyM === "number" && accuracyM > 0) {
      if (current.accuracy) {
        current.accuracy.setLatLng(here);
        current.accuracy.setRadius(accuracyM);
        current.accuracy.setStyle({ color });
      } else {
        current.accuracy = L.circle(here, { radius: accuracyM, color, weight: 1, fillOpacity: 0.12 }).addTo(layer);
      }
    } else if (current.accuracy) {
      current.accuracy.remove();
      current.accuracy = null;
    }
  }, [map, lat, lng, accuracyM, lastPositionAgeSeconds]);

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
