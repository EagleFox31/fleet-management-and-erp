/** Types d'usage essieu (position) — distinct du compound/saison. */
export const TIRE_USAGE_TYPES = [
  { value: "direction", label: "Direction", db: "steer" },
  { value: "moteur", label: "Moteur (traction)", db: "drive" },
  { value: "remorque", label: "Remorque", db: "trailer" },
] as const;

export type TireUsageType = (typeof TIRE_USAGE_TYPES)[number]["value"];

/** Indice de vitesse (lettre → km/h max) — pneus poids lourds et utilitaires. */
export const TIRE_SPEED_RATINGS = [
  { code: "F", kmh: 80 },
  { code: "G", kmh: 90 },
  { code: "J", kmh: 100 },
  { code: "K", kmh: 110 },
  { code: "L", kmh: 120 },
  { code: "M", kmh: 130 },
  { code: "N", kmh: 140 },
  { code: "P", kmh: 150 },
  { code: "Q", kmh: 160 },
  { code: "R", kmh: 170 },
  { code: "S", kmh: 180 },
  { code: "T", kmh: 190 },
  { code: "U", kmh: 200 },
  { code: "H", kmh: 210 },
  { code: "V", kmh: 240 },
  { code: "W", kmh: 270 },
  { code: "Y", kmh: 300 },
] as const;

/** Table indice de charge ISO (kg par pneu) — plage courante flotte PL. */
export const TIRE_LOAD_INDEX_KG: Record<number, number> = {
  100: 800, 101: 825, 102: 850, 103: 875, 104: 900, 105: 925, 106: 950, 107: 975,
  108: 1000, 109: 1030, 110: 1060, 111: 1090, 112: 1120, 113: 1150, 114: 1180,
  115: 1215, 116: 1250, 117: 1285, 118: 1320, 119: 1360, 120: 1400, 121: 1450,
  122: 1500, 123: 1550, 124: 1600, 125: 1650, 126: 1700, 127: 1750, 128: 1800,
  129: 1850, 130: 1900, 131: 1950, 132: 2000, 133: 2060, 134: 2120, 135: 2180,
  136: 2240, 137: 2300, 138: 2360, 139: 2430, 140: 2500, 141: 2575, 142: 2650,
  143: 2725, 144: 2800, 145: 2900, 146: 3000, 147: 3075, 148: 3150, 149: 3250,
  150: 3350, 151: 3450, 152: 3550, 153: 3650, 154: 3750, 155: 3875, 156: 4000,
  157: 4125, 158: 4250, 159: 4375, 160: 4500, 161: 4625, 162: 4750, 163: 4875,
  164: 5000, 165: 5150, 166: 5300, 167: 5450, 168: 5600, 169: 5800,
};

export const TIRE_LOAD_INDEX_OPTIONS = Object.entries(TIRE_LOAD_INDEX_KG)
  .map(([index, kg]) => ({
    value: index,
    label: `${index} — ${kg.toLocaleString("fr-FR")} kg`,
    kg,
  }))
  .sort((a, b) => Number(a.value) - Number(b.value));

export const TIRE_MANUFACTURING_WEEKS = Array.from({ length: 53 }, (_, i) => {
  const value = String(i + 1).padStart(2, "0");
  return { value, label: `Semaine ${value}` };
});

const TIRE_BRAND_SUGGESTIONS = [
  "Michelin",
  "Bridgestone",
  "Goodyear",
  "Continental",
  "Pirelli",
  "Hankook",
  "Yokohama",
  "Giti",
  "Aeolus",
  "Triangle",
  "Double Coin",
  "Sailun",
  "Firestone",
  "Barum",
] as const;

/** Logos servis depuis `/tires-logos/` (client/public + public racine). */
export const TIRE_BRAND_LOGOS: Partial<Record<(typeof TIRE_BRAND_SUGGESTIONS)[number], string>> = {
  Michelin: "/tires-logos/michelin-2.svg",
  Bridgestone: "/tires-logos/bridgestone-26989.svg",
  Goodyear: "/tires-logos/goodyear.svg",
  Continental: "/tires-logos/continental-54.svg",
  Pirelli: "/tires-logos/pirelli-2.svg",
  Hankook: "/tires-logos/hankook-tire-black.svg",
  Yokohama: "/tires-logos/yokohama-logo.svg",
  Giti: "/tires-logos/giti-1.svg",
  Aeolus: "/tires-logos/aeolus-tires-seeklogo.png",
  Triangle: "/tires-logos/triangle-tyres-seeklogo.png",
  "Double Coin": "/tires-logos/doublecoin-logo.webp",
  Sailun: "/tires-logos/sailun-logo.png",
  Firestone: "/tires-logos/firestone-logo.svg",
  Barum: "/tires-logos/barum.svg",
};

export const TIRE_BRAND_OPTIONS = TIRE_BRAND_SUGGESTIONS.map((brand) => ({
  value: brand,
  label: brand,
  logoUrl: TIRE_BRAND_LOGOS[brand] ?? null,
}));

export function getTireBrandLogoUrl(brand: string): string | null {
  return TIRE_BRAND_LOGOS[brand as (typeof TIRE_BRAND_SUGGESTIONS)[number]] ?? null;
}

export function getTireManufacturingYears(minYear = 2015): { value: string; label: string }[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: currentYear - minYear + 1 }, (_, i) => {
    const year = String(currentYear - i);
    return { value: year, label: year };
  });
}

/** Extrait semaine + année depuis les 4 derniers chiffres d'un code DOT (WWYY). */
export function parseDotManufacturingDate(dotCode: string): { week: string; year: string } | null {
  const digits = dotCode.replace(/\D/g, "");
  if (digits.length < 4) {
    return null;
  }

  const lastFour = digits.slice(-4);
  const week = lastFour.slice(0, 2);
  const yearSuffix = lastFour.slice(2, 4);
  const weekNum = Number.parseInt(week, 10);
  const yearNum = 2000 + Number.parseInt(yearSuffix, 10);
  const currentYear = new Date().getFullYear();

  if (weekNum < 1 || weekNum > 53 || yearNum < 2000 || yearNum > currentYear) {
    return null;
  }

  return { week, year: String(yearNum) };
}

/** Date ISO (lundi de la semaine DOT) pour colonne manufacture_date. */
export function manufactureDateFromWeekYear(week: string, year: string): string | null {
  const weekNum = Number.parseInt(week, 10);
  const yearNum = Number.parseInt(year, 10);
  if (!Number.isInteger(weekNum) || !Number.isInteger(yearNum) || weekNum < 1 || weekNum > 53) {
    return null;
  }

  const jan4 = new Date(yearNum, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const weekOneMonday = new Date(jan4);
  weekOneMonday.setDate(jan4.getDate() - dayOfWeek + 1);

  const target = new Date(weekOneMonday);
  target.setDate(weekOneMonday.getDate() + (weekNum - 1) * 7);
  return target.toISOString().split("T")[0];
}

const USAGE_TO_DB: Record<TireUsageType, string> = {
  direction: "steer",
  moteur: "drive",
  remorque: "trailer",
};

const DB_TO_USAGE: Record<string, TireUsageType> = {
  steer: "direction",
  drive: "moteur",
  trailer: "remorque",
  all_season: "moteur",
  winter: "moteur",
  summer: "moteur",
};

export function mapTireUsageToDb(usage: string): string {
  return USAGE_TO_DB[usage as TireUsageType] ?? usage;
}

export function mapTireUsageFromDb(dbType: string): TireUsageType {
  return DB_TO_USAGE[dbType] ?? "moteur";
}

export function formatTireUsageLabel(dbType: string): string {
  const usage = mapTireUsageFromDb(dbType);
  return TIRE_USAGE_TYPES.find((t) => t.value === usage)?.label ?? dbType;
}

export function getLoadIndexKg(loadIndex: string | number | null | undefined): number | null {
  if (loadIndex === null || loadIndex === undefined || loadIndex === "") {
    return null;
  }
  const parsed = typeof loadIndex === "number" ? loadIndex : Number.parseInt(String(loadIndex), 10);
  return TIRE_LOAD_INDEX_KG[parsed] ?? null;
}

export function getSpeedRatingKmh(code: string | null | undefined): number | null {
  if (!code) {
    return null;
  }
  return TIRE_SPEED_RATINGS.find((r) => r.code === code.toUpperCase())?.kmh ?? null;
}

/** Assemble une dimension normalisée (ex: 315/80R22.5). */
export function formatTireSize(width: string, aspect: string, diameter: string): string {
  return `${width}/${aspect}R${diameter}`;
}

/** Décompose une dimension stockée en BDD. */
export function parseTireSize(size: string): { width: string; aspect: string; diameter: string } | null {
  const match = size.trim().match(/^(\d{3})\/(\d{2,3})R?(\d{2}(?:\.\d)?)$/i);
  if (!match) {
    return null;
  }
  return {
    width: match[1],
    aspect: match[2],
    diameter: match[3],
  };
}

export const TIRE_SIZE_WIDTH_PRESETS = ["295", "315", "385", "425"] as const;
export const TIRE_SIZE_ASPECT_PRESETS = ["60", "65", "70", "80"] as const;
export const TIRE_SIZE_DIAMETER_PRESETS = ["19.5", "22.5", "24.5"] as const;

/** Dimensions courantes poids lourds (présélection rapide). */
export const TIRE_SIZE_PRESETS = [
  { label: "295/80R22.5", width: "295", aspect: "80", diameter: "22.5", usage: "Tracteur / porteur" },
  { label: "315/80R22.5", width: "315", aspect: "80", diameter: "22.5", usage: "Tracteur longue distance" },
  { label: "315/70R22.5", width: "315", aspect: "70", diameter: "22.5", usage: "Mixte route" },
  { label: "385/65R22.5", width: "385", aspect: "65", diameter: "22.5", usage: "Essieu directeur wide" },
  { label: "425/65R22.5", width: "425", aspect: "65", diameter: "22.5", usage: "Grand tonnage" },
] as const;

/** Politique flotte : au-delà de 6 ans, pneu considéré trop vieux (DOT / sécurité). */
export const TIRE_FLEET_MAX_AGE_YEARS = 6;
export const TIRE_FLEET_WARNING_AGE_YEARS = 5;

export type TireAgeStatus = "unknown" | "ok" | "warning" | "critical";

export function getTireAgeYears(manufacturingWeek: string, manufacturingYear: string): number | null {
  const manufactureDate = manufactureDateFromWeekYear(manufacturingWeek, manufacturingYear);
  if (!manufactureDate) {
    return null;
  }

  const manufactured = new Date(manufactureDate);
  const now = new Date();
  const ageMs = now.getTime() - manufactured.getTime();
  if (ageMs < 0) {
    return 0;
  }

  return ageMs / (365.25 * 24 * 60 * 60 * 1000);
}

export function getTireAgeStatus(manufacturingWeek: string, manufacturingYear: string): TireAgeStatus {
  if (!manufacturingWeek || !manufacturingYear) {
    return "unknown";
  }

  const ageYears = getTireAgeYears(manufacturingWeek, manufacturingYear);
  if (ageYears === null) {
    return "unknown";
  }
  if (ageYears >= TIRE_FLEET_MAX_AGE_YEARS) {
    return "critical";
  }
  if (ageYears >= TIRE_FLEET_WARNING_AGE_YEARS) {
    return "warning";
  }
  return "ok";
}

/** Extrait et formate la portion date (WWYY) d'un DOT pour affichage guidé. */
export function formatDotDateHighlight(dotCode: string): {
  prefix: string;
  week: string;
  yearSuffix: string;
} | null {
  const digits = dotCode.replace(/\D/g, "");
  if (digits.length < 4) {
    return null;
  }

  const week = digits.slice(-4, -2);
  const yearSuffix = digits.slice(-2);
  const prefix = dotCode.slice(0, Math.max(0, dotCode.length - 4)).trimEnd();

  return { prefix, week, yearSuffix };
}

/** Positions de montage sur véhicule (enum BDD `vehicle_tires.position`). */
export const TIRE_MOUNT_POSITIONS = [
  { value: "front_left", label: "Avant gauche" },
  { value: "front_right", label: "Avant droit" },
  { value: "rear_left_outer", label: "Arrière gauche extérieur" },
  { value: "rear_left_inner", label: "Arrière gauche intérieur" },
  { value: "rear_right_outer", label: "Arrière droit extérieur" },
  { value: "rear_right_inner", label: "Arrière droit intérieur" },
  { value: "spare", label: "Secours" },
] as const;

export type TireMountPosition = (typeof TIRE_MOUNT_POSITIONS)[number]["value"];

export function getTireMountPositionLabel(position: string): string {
  return TIRE_MOUNT_POSITIONS.find((p) => p.value === position)?.label ?? position;
}

/** Pourcentage de sculpture restante (100 = neuf, 0 = usé). */
export function computeTireWearScore(
  currentTreadDepth?: number | null,
  initialTreadDepth?: number | null,
): number {
  const initial = Number(initialTreadDepth);
  const current = Number(currentTreadDepth);
  if (!Number.isFinite(initial) || initial <= 0) {
    return 100;
  }
  if (!Number.isFinite(current)) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((current / initial) * 100)));
}
