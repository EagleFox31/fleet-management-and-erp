/**
 * Source unique du fond de carte (tuiles). Toutes les cartes Leaflet de l'application
 * (chauffeur, logisticien) lisent ce module : aucune URL de tuiles ailleurs.
 *
 * Réglage par l'environnement de build (Vite) :
 *   VITE_MAP_TILE_URL          modèle d'URL, ex. https://tile.exemple.org/{z}/{x}/{y}.png
 *   VITE_MAP_TILE_ATTRIBUTION  mention légale affichée sur la carte (HTML simple)
 * Sans réglage : tuiles OpenStreetMap et leur attribution obligatoire. Les serveurs de tuiles
 * publics d'OSM ont une politique d'usage (pas de téléchargement en masse) : pour une charge
 * plus forte, pointer vers un fournisseur ou un serveur de tuiles propre via ces deux variables.
 */
export interface MapTiles {
  url: string;
  attribution: string;
  maxZoom: number;
}

export const OSM_TILES: MapTiles = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
  maxZoom: 19,
};

export function resolveMapTiles(env: { VITE_MAP_TILE_URL?: string; VITE_MAP_TILE_ATTRIBUTION?: string }): MapTiles {
  const url = env.VITE_MAP_TILE_URL?.trim();
  const attribution = env.VITE_MAP_TILE_ATTRIBUTION?.trim();
  return {
    url: url || OSM_TILES.url,
    // Une URL personnalisée sans attribution ne garde jamais celle d'OSM, qui serait fausse.
    attribution: attribution || (url ? "" : OSM_TILES.attribution),
    maxZoom: OSM_TILES.maxZoom,
  };
}

export const mapTiles: MapTiles = resolveMapTiles(import.meta.env as Record<string, string | undefined>);
