import { useEffect, useRef } from "react";
import L from "leaflet";
import { escapeHtml } from "@/lib/escape-html";
import { formatPositionAge } from "@/lib/gps-display";
import type { VehiclePosition } from "@shared/contracts/gps";
import { positionFreshnessColor, useLeafletMap } from "./use-leaflet-map";

type Props = {
  positions: VehiclePosition[];
  selectedVehicleId: number | null;
  onSelect: (vehicleId: number) => void;
};

function positionIcon(position: VehiclePosition, selected: boolean): L.DivIcon {
  const color = positionFreshnessColor(position.ageSeconds);
  const shadow = selected ? "0 0 0 4px rgba(22,163,74,.35)" : "0 1px 4px rgba(0,0,0,.4)";
  return L.divIcon({
    className: "gps-position-pin",
    html: `<div style="width:18px;height:18px;border-radius:9999px;background:${color};border:2px solid #fff;box-shadow:${shadow};"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -9],
  });
}

function popupOf(position: VehiclePosition): string {
  const plate = escapeHtml(position.registrationNumber ?? `Véhicule ${position.vehicleId}`);
  const order = position.orderNumber ? `<div>Mission ${escapeHtml(position.orderNumber)}</div>` : "";
  const speed = typeof position.speedKmh === "number" ? `<div>${Math.round(position.speedKmh)} km/h</div>` : "";
  return `<div style="font-family:sans-serif;min-width:150px"><strong>${plate}</strong>${order}${speed}<div>Position ${escapeHtml(formatPositionAge(position.ageSeconds))}</div></div>`;
}

/**
 * Carte de flotte : un repère par véhicule, couleur selon l'âge de la dernière position.
 * `positions[].ageSeconds` doit être l'âge réel (horloge locale), pas celui de la réponse serveur.
 */
export default function FleetPositionsMap({ positions, selectedVehicleId, onSelect }: Props) {
  const { containerRef, map } = useLeafletMap({ scrollWheelZoom: true });
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;
    const markers = markersRef.current;
    return () => {
      layer.remove();
      layerRef.current = null;
      markers.clear();
    };
  }, [map]);

  // Mise à jour sur place : un repère existant change de position, d'icône et de contenu sans être
  // recréé, pour ne pas fermer la bulle ouverte à chaque tick de l'horloge ou trame temps réel.
  useEffect(() => {
    const layer = layerRef.current;
    if (!map || !layer) return;
    const markers = markersRef.current;
    const seen = new Set<number>();
    for (const position of positions) {
      seen.add(position.vehicleId);
      const latLng: [number, number] = [position.lat, position.lng];
      const icon = positionIcon(position, position.vehicleId === selectedVehicleId);
      const existing = markers.get(position.vehicleId);
      if (existing) {
        existing.setLatLng(latLng);
        existing.setIcon(icon);
        existing.setPopupContent(popupOf(position));
        continue;
      }
      const marker = L.marker(latLng, { icon, title: position.registrationNumber ?? undefined });
      marker.bindPopup(popupOf(position));
      marker.on("click", () => onSelectRef.current(position.vehicleId));
      marker.addTo(layer);
      markers.set(position.vehicleId, marker);
    }
    for (const [vehicleId, marker] of Array.from(markers)) {
      if (!seen.has(vehicleId)) {
        marker.remove();
        markers.delete(vehicleId);
      }
    }
    // Cadrage une seule fois : un rafraîchissement temps réel ne doit pas déplacer la vue.
    if (!fittedRef.current && positions.length > 0) {
      map.fitBounds(L.latLngBounds(positions.map((p) => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 9 });
      fittedRef.current = true;
    }
  }, [map, positions, selectedVehicleId]);

  useEffect(() => {
    if (!map || selectedVehicleId === null) return;
    const marker = markersRef.current.get(selectedVehicleId);
    if (marker) map.panTo(marker.getLatLng());
  }, [map, selectedVehicleId]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full rounded-lg"
      data-testid="fleet-positions-map"
      role="img"
      aria-label="Carte des dernières positions des véhicules"
    />
  );
}
