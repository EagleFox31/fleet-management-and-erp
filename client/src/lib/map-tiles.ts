/**
 * Fond de carte unique de l'application (Leaflet).
 *
 * Par défaut les tuiles publiques d'OpenStreetMap (volume faible : dizaines d'utilisateurs). Pour
 * basculer vers un fournisseur à clé, définir `VITE_MAP_TILE_URL` (gabarit `{z}/{x}/{y}`, `{s}` et
 * `{r}` admis) et `VITE_MAP_TILE_ATTRIBUTION` : aucun écran n'est à retoucher. Aucune URL de tuiles
 * ne s'écrit ailleurs que dans ce fichier.
 */
const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const env = import.meta.env as Record<string, string | undefined>;

function orDefault(value: string | undefined, fallback: string): string {
  return value && value.trim() !== "" ? value.trim() : fallback;
}

export const MAP_TILES = {
  url: orDefault(env.VITE_MAP_TILE_URL, OSM_URL),
  attribution: orDefault(env.VITE_MAP_TILE_ATTRIBUTION, OSM_ATTRIBUTION),
  maxZoom: 19,
} as const;

export const { url, attribution, maxZoom } = MAP_TILES;
