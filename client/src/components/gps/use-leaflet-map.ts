import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MAP_TILES } from "@/lib/map-tiles";
import { positionFreshness } from "@/lib/gps-display";

/** Centre par défaut : Cameroun (la flotte opère sur les corridors CEMAC). */
export const DEFAULT_MAP_CENTER: [number, number] = [5.5, 12.3];
export const DEFAULT_MAP_ZOOM = 6;

/**
 * Crée une carte Leaflet dans le conteneur et la détruit au démontage. Le fond vient de
 * `lib/map-tiles.ts` (jamais d'URL de tuiles ici). Hors réseau, la carte reste utilisable sur fond
 * vide : repères et trace ne dépendent pas des tuiles.
 */
export function useLeafletMap(options: { scrollWheelZoom?: boolean } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<L.Map | null>(null);
  const scrollWheelZoom = options.scrollWheelZoom ?? false;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const instance = L.map(container, {
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      scrollWheelZoom,
    });
    L.tileLayer(MAP_TILES.url, { maxZoom: MAP_TILES.maxZoom, attribution: MAP_TILES.attribution }).addTo(instance);
    setMap(instance);
    return () => {
      instance.remove();
      setMap(null);
    };
  }, [scrollWheelZoom]);

  return { containerRef, map };
}

/** Repère rond coloré avec une lettre courte (jamais d'emoji). */
export function letterIcon(label: string, background: string): L.DivIcon {
  return L.divIcon({
    className: "gps-letter-pin",
    html: `<div style="width:26px;height:26px;border-radius:9999px;background:${background};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font:700 12px/1 sans-serif;">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  });
}

/** Vert sous 15 min, orange jusqu'à 60 min, gris au-delà (cadrage §3.3). */
export const POSITION_COLORS = {
  fresh: "#16a34a",
  stale: "#d97706",
  old: "#64748b",
} as const;

export function positionFreshnessColor(ageSeconds: number): string {
  return POSITION_COLORS[positionFreshness(ageSeconds)];
}
