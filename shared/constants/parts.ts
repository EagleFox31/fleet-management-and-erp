export const PART_UNITS = [
  "pièce",
  "paire",
  "kit",
  "jeu",
  "boîte",
  "bidon",
  "litre",
  "kg",
  "mètre",
] as const;

export type PartUnit = (typeof PART_UNITS)[number];
