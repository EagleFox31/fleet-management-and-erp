import { useEffect, useRef } from "react";
import L from "leaflet";
import { hubCoordinates, type GeoSelection } from "@/lib/gps-display";
import { letterIcon, useLeafletMap } from "./use-leaflet-map";

type Props = {
  value: GeoSelection;
  letter: "A" | "B";
  color: string;
  /** L'autre point de la mission, affiché en gris pour situer le trajet. */
  other?: GeoSelection;
  onPick: (lat: number, lng: number) => void;
};

function latLngOf(selection: GeoSelection | undefined): [number, number] | null {
  if (!selection) return null;
  if (selection.kind === "map") return [selection.lat, selection.lng];
  if (selection.kind === "hub") return hubCoordinates(selection.hubCode);
  return null;
}

/** Petite carte de saisie : un clic pose le point. Les coordonnées sont arrondies à 5 décimales (~1 m). */
export default function GeoPointMap({ value, letter, color, other, onPick }: Props) {
  const { containerRef, map } = useLeafletMap({ scrollWheelZoom: true });
  const layerRef = useRef<L.LayerGroup | null>(null);
  // Cadrage initial une seule fois : un clic ne doit pas changer le zoom choisi par l'utilisateur.
  const fittedRef = useRef(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;
    const handler = (event: L.LeafletMouseEvent) => {
      onPickRef.current(Number(event.latlng.lat.toFixed(5)), Number(event.latlng.lng.toFixed(5)));
    };
    map.on("click", handler);
    return () => {
      map.off("click", handler);
      layer.remove();
      layerRef.current = null;
    };
  }, [map]);

  const here = latLngOf(value);
  const there = latLngOf(other);
  const hereKey = here ? `${here[0]},${here[1]}` : "";
  const thereKey = there ? `${there[0]},${there[1]}` : "";

  useEffect(() => {
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];
    if (there) {
      L.circleMarker(there, { radius: 6, color: "#64748b", fillColor: "#94a3b8", fillOpacity: 0.9, weight: 2 }).addTo(layer);
      bounds.push(there);
    }
    if (here) {
      L.marker(here, { icon: letterIcon(letter, color) }).addTo(layer);
      bounds.push(here);
    }
    if (!fittedRef.current && bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [32, 32], maxZoom: 9 });
      fittedRef.current = true;
    } else if (here && !map.getBounds().contains(here)) {
      // Après un clic ou un changement de point : on garde le zoom de l'utilisateur, on recentre seulement si besoin.
      map.panTo(here);
    }
    // `hereKey` / `thereKey` : dépendances par valeur, les tableaux changent d'identité à chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, hereKey, thereKey, letter, color]);

  return (
    <div
      ref={containerRef}
      className="h-56 w-full cursor-crosshair rounded-lg border border-border"
      data-testid={`geo-map-${letter}`}
      role="application"
      aria-label={`Carte : cliquer pour poser le point ${letter}`}
    />
  );
}
