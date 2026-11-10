/**
 * Référentiel des Hubs, Corridors et Géométries CEMAC (Cameroun, Tchad, RCA)
 * Utilisé pour la cartographie exécutive et le suivi temps réel de la flotte Yaro FleetOS.
 */

export type LogisticsHub = {
  id: string;
  name: string;
  country: "CM" | "TD" | "CF" | "GA" | "GQ";
  role: "port" | "capital" | "hub_rail_road" | "border_post" | "regional_center";
  coordinates: [number, number]; // [lat, lng]
  description: string;
};

export type CemacCorridor = {
  id: string;
  name: string;
  code: string;
  distanceKm: number;
  color: string;
  description: string;
  hubs: string[]; // IDs des hubs ordonnés
  polyline: [number, number][]; // Coordonnées GPS réelles longeant les axes routiers
};

export type TransitStatus = "in_transit" | "returning" | "loading" | "stopped" | "alert";

/**
 * Source de la position d'un véhicule. "none" : aucune source réelle, le véhicule n'a alors
 * ni `currentLat` ni `currentLng` (jamais de coordonnée déduite d'un rang ou d'un statut).
 * Les sources réelles ("phone", "tracker") s'ajoutent avec la remontée GPS (GPS-API-1).
 */
export type VehiclePositionSource = "none" | "phone" | "tracker";

export type LiveCorridorVehicle = {
  vehicleId: number;
  registrationNumber: string;
  brand: string;
  model: string;
  vehicleStatus: "operational" | "maintenance" | "out_of_service";
  missionId?: number;
  orderNumber?: string;
  clientName?: string;
  driverName?: string;
  origin?: string;
  destination?: string;
  cargoLabel?: string;
  weightTonnes?: number;
  /** Présentes seulement si `positionSource !== "none"`. */
  currentLat?: number;
  currentLng?: number;
  positionSource: VehiclePositionSource;
  /** Horodatage ISO du dernier point réel, si une source existe. */
  positionAt?: string;
  corridorId?: string;
  transitStatus: TransitStatus;
  /** Absent tant qu'aucune position réelle ne permet de le calculer. */
  progressPercent?: number;
  estimatedArrival?: string;
  fuelConsumptionAvg?: number; // L/100 km, seulement si litres et distance réels de la mission
  notes?: string;
};

// Hubs logistiques d'Afrique Centrale
export const LOGISTICS_HUBS: Record<string, LogisticsHub> = {
  douala: {
    id: "douala",
    name: "Douala (Port & Base)",
    country: "CM",
    role: "port",
    coordinates: [4.0511, 9.7679],
    description: "Port autonome de Douala, principale base logistique",
  },
  yaounde: {
    id: "yaounde",
    name: "Yaoundé",
    country: "CM",
    role: "capital",
    coordinates: [3.8480, 11.5021],
    description: "Capitale politique et carrefour multimodal",
  },
  bafoussam: {
    id: "bafoussam",
    name: "Bafoussam",
    country: "CM",
    role: "regional_center",
    coordinates: [5.4778, 10.4176],
    description: "Hub logistique des Hauts Plateaux de l'Ouest",
  },
  bamenda: {
    id: "bamenda",
    name: "Bamenda",
    country: "CM",
    role: "regional_center",
    coordinates: [5.9631, 10.1591],
    description: "Extrémité du corridor Ouest",
  },
  bertoua: {
    id: "bertoua",
    name: "Bertoua",
    country: "CM",
    role: "regional_center",
    coordinates: [4.5773, 13.6846],
    description: "Carrefour logistique de l'Est camerounais",
  },
  batouri: {
    id: "batouri",
    name: "Batouri",
    country: "CM",
    role: "regional_center",
    coordinates: [4.4333, 14.3667],
    description: "Étape intermédiaire corridor RCA",
  },
  garoua_boulai: {
    id: "garoua_boulai",
    name: "Garoua-Boulaï",
    country: "CM",
    role: "border_post",
    coordinates: [5.8833, 14.5500],
    description: "Poste frontière principal Cameroun — République Centrafricaine",
  },
  bangui: {
    id: "bangui",
    name: "Bangui",
    country: "CF",
    role: "capital",
    coordinates: [4.3947, 18.5582],
    description: "Capitale RCA, terminus corridor Est",
  },
  ngaoundere: {
    id: "ngaoundere",
    name: "Ngaoundéré",
    country: "CM",
    role: "hub_rail_road",
    coordinates: [7.3195, 13.5841],
    description: "Hub rail-route Château d'eau et porte du Grand Nord",
  },
  garoua: {
    id: "garoua",
    name: "Garoua",
    country: "CM",
    role: "regional_center",
    coordinates: [9.3014, 13.3977],
    description: "Port fluvial de la Bénoué et pôle agro-industriel",
  },
  maroua: {
    id: "maroua",
    name: "Maroua",
    country: "CM",
    role: "regional_center",
    coordinates: [10.5956, 14.3247],
    description: "Pôle de l'Extrême-Nord",
  },
  kousseri: {
    id: "kousseri",
    name: "Kousseri",
    country: "CM",
    role: "border_post",
    coordinates: [12.0772, 15.0319],
    description: "Pont de N'Gueli, frontière Tchad",
  },
  ndjamena: {
    id: "ndjamena",
    name: "N'Djamena",
    country: "TD",
    role: "capital",
    coordinates: [12.1348, 15.0557],
    description: "Capitale du Tchad, terminus corridor Nord",
  },
  kribi: {
    id: "kribi",
    name: "Kribi",
    country: "CM",
    role: "port",
    coordinates: [2.9372, 9.9077],
    description: "Port en eau profonde et complexe industrialo-portuaire",
  },
  ebolowa: {
    id: "ebolowa",
    name: "Ebolowa",
    country: "CM",
    role: "regional_center",
    coordinates: [2.9000, 11.1500],
    description: "Chef-lieu du Sud forestier",
  },
  ambam: {
    id: "ambam",
    name: "Ambam (Kye-Ossi)",
    country: "CM",
    role: "border_post",
    coordinates: [2.3833, 11.2833],
    description: "Marché transfrontalier Cameroun - Gabon - Guinée Équatoriale",
  },
};

// 4 Grands Corridors Stratégiques CEMAC
export const CEMAC_CORRIDORS: Record<string, CemacCorridor> = {
  "corridor-nord": {
    id: "corridor-nord",
    name: "Corridor Nord (Douala — N'Djamena)",
    code: "N1 / N3",
    distanceKm: 1850,
    color: "#10b981", // Émeraude principal
    description: "Axe vital d'approvisionnement du Tchad et du Grand Nord Cameroun",
    hubs: ["douala", "yaounde", "ngaoundere", "garoua", "maroua", "kousseri", "ndjamena"],
    polyline: [
      [4.0511, 9.7679], // Douala
      [3.8480, 11.5021], // Yaoundé
      [4.7478, 11.2333], // Bafia
      [5.8500, 12.2000], // Yoko
      [6.4833, 12.6167], // Tibati
      [7.3195, 13.5841], // Ngaoundéré
      [8.5000, 13.5500], // Mbé (Falaise)
      [9.3014, 13.3977], // Garoua
      [9.9333, 13.9167], // Guider
      [10.5956, 14.3247], // Maroua
      [11.5000, 14.8000], // Waza
      [12.0772, 15.0319], // Kousseri
      [12.1348, 15.0557], // N'Djamena
    ],
  },
  "corridor-ouest": {
    id: "corridor-ouest",
    name: "Corridor Ouest (Douala — Bamenda)",
    code: "N3 / N4 / N6",
    distanceKm: 380,
    color: "#06b6d4", // Cyan
    description: "Liaison économique Douala - Hauts Plateaux - Nord-Ouest",
    hubs: ["douala", "bafoussam", "bamenda"],
    polyline: [
      [4.0511, 9.7679], // Douala
      [4.4667, 9.9667], // Loum
      [4.9500, 9.9667], // Nkongsamba
      [5.4778, 10.4176], // Bafoussam
      [5.7333, 10.2833], // Mbouda
      [5.9631, 10.1591], // Bamenda
    ],
  },
  "corridor-est": {
    id: "corridor-est",
    name: "Corridor Est / RCA (Yaoundé — Bangui)",
    code: "N10",
    distanceKm: 1100,
    color: "#f59e0b", // Ambre
    description: "Axe de transit vers la République Centrafricaine",
    hubs: ["yaounde", "bertoua", "batouri", "garoua_boulai", "bangui"],
    polyline: [
      [3.8480, 11.5021], // Yaoundé
      [4.1833, 12.2833], // Ayos
      [4.5773, 13.6846], // Bertoua
      [4.4333, 14.3667], // Batouri
      [5.8833, 14.5500], // Garoua-Boulaï
      [5.5000, 15.3000], // Bouar (RCA)
      [4.9833, 16.5000], // Bossembélé (RCA)
      [4.3947, 18.5582], // Bangui (RCA)
    ],
  },
  "corridor-sud": {
    id: "corridor-sud",
    name: "Corridor Sud / Minier (Douala — Kribi — Gabon)",
    code: "N7 / N2",
    distanceKm: 420,
    color: "#8b5cf6", // Violet
    description: "Desserte portuaire Kribi et frontière sud CEMAC",
    hubs: ["douala", "kribi", "ebolowa", "ambam"],
    polyline: [
      [4.0511, 9.7679], // Douala
      [3.6000, 10.1333], // Edéa
      [2.9372, 9.9077], // Kribi
      [2.9000, 11.1500], // Ebolowa
      [2.3833, 11.2833], // Ambam (Kye-Ossi)
    ],
  },
};

/**
 * Projette une coordonnée GPS le long d'une polyline de corridor selon un pourcentage de progression
 */
export function interpolateCorridorPosition(
  polyline: [number, number][],
  progressPercent: number
): [number, number] {
  if (!polyline || polyline.length === 0) {
    return [4.0511, 9.7679]; // Douala par défaut
  }
  if (polyline.length === 1 || progressPercent <= 0) {
    return polyline[0];
  }
  if (progressPercent >= 100) {
    return polyline[polyline.length - 1];
  }

  const clampedProgress = Math.max(0, Math.min(100, progressPercent)) / 100;
  const totalSegments = polyline.length - 1;
  const targetIndex = clampedProgress * totalSegments;
  const segmentIndex = Math.min(Math.floor(targetIndex), totalSegments - 1);
  const segmentProgress = targetIndex - segmentIndex;

  const start = polyline[segmentIndex];
  const end = polyline[segmentIndex + 1];

  const lat = start[0] + (end[0] - start[0]) * segmentProgress;
  const lng = start[1] + (end[1] - start[1]) * segmentProgress;

  return [Number(lat.toFixed(4)), Number(lng.toFixed(4))];
}

/**
 * Trouve le corridor le plus proche selon une destination ou une ville de départ
 */
export function findCorridorByDestination(destinationStr?: string): CemacCorridor {
  if (!destinationStr) return CEMAC_CORRIDORS["corridor-nord"];
  const lower = destinationStr.toLowerCase();

  if (
    lower.includes("ndjamena") ||
    lower.includes("n'djamena") ||
    lower.includes("garoua") ||
    lower.includes("maroua") ||
    lower.includes("ngaoundere") ||
    lower.includes("ngaoundéré") ||
    lower.includes("kousseri") ||
    lower.includes("nord")
  ) {
    return CEMAC_CORRIDORS["corridor-nord"];
  }

  if (
    lower.includes("bafoussam") ||
    lower.includes("bamenda") ||
    lower.includes("ouest") ||
    lower.includes("nkongsamba")
  ) {
    return CEMAC_CORRIDORS["corridor-ouest"];
  }

  if (
    lower.includes("bangui") ||
    lower.includes("bertoua") ||
    lower.includes("batouri") ||
    lower.includes("rca") ||
    lower.includes("centrafrique")
  ) {
    return CEMAC_CORRIDORS["corridor-est"];
  }

  if (
    lower.includes("kribi") ||
    lower.includes("ebolowa") ||
    lower.includes("ambam") ||
    lower.includes("gabon") ||
    lower.includes("sud")
  ) {
    return CEMAC_CORRIDORS["corridor-sud"];
  }

  return CEMAC_CORRIDORS["corridor-nord"];
}
