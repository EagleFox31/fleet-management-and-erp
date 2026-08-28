import { z } from "zod";
import {
  TIRE_LOAD_INDEX_KG,
  TIRE_SPEED_RATINGS,
  formatTireSize,
  getTireAgeStatus,
  getTireAgeYears,
  manufactureDateFromWeekYear,
  mapTireUsageToDb,
  parseDotManufacturingDate,
  parseTireSize,
} from "./constants/tires";

const speedRatingCodes = TIRE_SPEED_RATINGS.map((r) => r.code) as [string, ...string[]];

const currentYear = new Date().getFullYear();

/** Schéma formulaire UI — champs alignés sur la saisie magasinier. */
export const tireFormSchema = z.object({
  brand: z.string().trim().min(1, "La marque est obligatoire"),
  model: z.string().trim().min(1, "Le modèle est obligatoire"),
  sizeWidth: z
    .string()
    .trim()
    .regex(/^\d{3}$/, "Largeur invalide (3 chiffres, ex: 315)"),
  sizeAspect: z
    .string()
    .trim()
    .regex(/^\d{2,3}$/, "Profil invalide (ex: 80)"),
  sizeDiameter: z
    .string()
    .trim()
    .regex(/^\d{2}(\.\d)?$/, "Diamètre invalide (ex: 22.5)"),
  tireType: z.enum(["direction", "moteur", "remorque"]),
  speedRating: z.enum(speedRatingCodes),
  loadIndex: z
    .string()
    .regex(/^\d{2,3}$/, "Indice de charge invalide")
    .refine((val) => TIRE_LOAD_INDEX_KG[Number.parseInt(val, 10)] !== undefined, {
      message: "Indice de charge non reconnu",
    }),
  dotCode: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || val.replace(/\D/g, "").length >= 4, {
      message: "Code DOT incomplet (4 chiffres date minimum)",
    }),
  manufacturingWeek: z
    .string()
    .regex(/^\d{2}$/, "Semaine invalide")
    .refine((val) => {
      const n = Number.parseInt(val, 10);
      return n >= 1 && n <= 53;
    }, "Semaine entre 01 et 53"),
  manufacturingYear: z
    .string()
    .regex(/^\d{4}$/, "Année invalide")
    .refine((val) => {
      const n = Number.parseInt(val, 10);
      return n >= 2015 && n <= currentYear;
    }, `Année entre 2015 et ${currentYear}`),
  compound: z.enum(["ete", "hiver", "toutes_saisons", "rechape"]).optional(),
  stockQuantity: z.number().int().min(0, "La quantité doit être positive"),
  minStockLevel: z.number().int().min(0, "Le seuil minimal doit être positif"),
  purchasePrice: z.number().min(0, "Le prix doit être positif"),
  supplier: z.string().trim().min(1, "Le fournisseur est obligatoire"),
  location: z.string().trim().min(1, "L'emplacement est obligatoire"),
  receptionDate: z.string().min(1, "Date de réception obligatoire"),
  warrantyMonths: z.number().int().min(0).max(120),
  serialNumber: z.string().trim().optional(),
  treadPattern: z.string().trim().optional(),
  reinforcement: z.enum(["standard", "renforce", "extra_load", "xl"]).optional(),
  qualityGrade: z.enum(["premium", "standard", "economique"]).optional(),
  batchNumber: z.string().trim().optional(),
  approvals: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  inspectionNotes: z.string().trim().optional(),
});

export type TireFormData = z.infer<typeof tireFormSchema>;

export const TIRE_WIZARD_STEPS = [
  { number: 1, title: "Produit", description: "Marque et dimension" },
  { number: 2, title: "Technique", description: "Usage et indices" },
  { number: 3, title: "Traçabilité", description: "DOT et date" },
  { number: 4, title: "Stock", description: "Quantités et lieu" },
  { number: 5, title: "Validation", description: "Notes et enregistrement" },
] as const;

export const TIRE_WIZARD_TOTAL_STEPS = TIRE_WIZARD_STEPS.length;

export const TIRE_WIZARD_STEP_FIELDS: Record<number, (keyof TireFormData)[]> = {
  1: ["brand", "model", "sizeWidth", "sizeAspect", "sizeDiameter"],
  2: ["tireType", "speedRating", "loadIndex"],
  3: ["manufacturingWeek", "manufacturingYear"],
  4: ["stockQuantity", "minStockLevel", "purchasePrice", "supplier", "location", "receptionDate"],
  5: [],
};

export function getDefaultTireFormValues(): TireFormData {
  return {
    brand: "",
    model: "",
    sizeWidth: "315",
    sizeAspect: "80",
    sizeDiameter: "22.5",
    tireType: "moteur",
    speedRating: "K",
    loadIndex: "152",
    dotCode: "",
    serialNumber: "",
    manufacturingWeek: "",
    manufacturingYear: new Date().getFullYear().toString(),
    treadPattern: "",
    compound: "toutes_saisons",
    reinforcement: "standard",
    qualityGrade: "standard",
    stockQuantity: 0,
    minStockLevel: 2,
    purchasePrice: 0,
    supplier: "",
    location: "",
    batchNumber: "",
    receptionDate: new Date().toISOString().split("T")[0],
    warrantyMonths: 24,
    notes: "",
    inspectionNotes: "",
  };
}

export type TireDbPayload = {
  brand: string;
  model: string;
  size: string;
  tireType: string;
  speedRating: string;
  maxLoadIndex: number;
  dotCode: string | null;
  manufactureDate: string | null;
  supplier: string | null;
  purchasePrice: string;
  warrantyMonths: number | null;
  stockQuantity: number;
  minStockLevel: number;
  location: string | null;
  notes: string | null;
};

function buildSupplementaryNotes(data: TireFormData): string | null {
  const lines: string[] = [];

  if (data.compound) {
    const compoundLabels: Record<string, string> = {
      ete: "Été",
      hiver: "Hiver",
      toutes_saisons: "Toutes saisons",
      rechape: "Rechapé",
    };
    lines.push(`Compound: ${compoundLabels[data.compound] ?? data.compound}`);
  }
  if (data.serialNumber) lines.push(`N° série: ${data.serialNumber}`);
  if (data.treadPattern) lines.push(`Sculpture: ${data.treadPattern}`);
  if (data.reinforcement) lines.push(`Renfort: ${data.reinforcement}`);
  if (data.qualityGrade) lines.push(`Qualité: ${data.qualityGrade}`);
  if (data.batchNumber) lines.push(`Lot: ${data.batchNumber}`);
  if (data.approvals) lines.push(`Homologations: ${data.approvals}`);
  if (data.receptionDate) lines.push(`Réception: ${data.receptionDate}`);
  if (data.inspectionNotes) lines.push(`Inspection réception: ${data.inspectionNotes}`);

  const ageStatus = getTireAgeStatus(data.manufacturingWeek, data.manufacturingYear);
  if (ageStatus === "warning" || ageStatus === "critical") {
    const ageYears = getTireAgeYears(data.manufacturingWeek, data.manufacturingYear);
    lines.push(
      `Alerte âge flotte: ${ageYears?.toFixed(1) ?? "?"} ans (${ageStatus === "critical" ? "limite dépassée" : "proche limite"})`,
    );
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/** Mappe le formulaire vers les colonnes réelles de la table `tires`. */
export function mapTireFormToDb(data: TireFormData): TireDbPayload {
  const manufactureDate = manufactureDateFromWeekYear(data.manufacturingWeek, data.manufacturingYear);
  const supplementary = buildSupplementaryNotes(data);
  const mergedNotes = [data.notes?.trim(), supplementary].filter(Boolean).join("\n\n") || null;

  return {
    brand: data.brand.trim(),
    model: data.model.trim(),
    size: formatTireSize(data.sizeWidth, data.sizeAspect, data.sizeDiameter),
    tireType: mapTireUsageToDb(data.tireType),
    speedRating: data.speedRating,
    maxLoadIndex: Number.parseInt(data.loadIndex, 10),
    dotCode: data.dotCode?.trim() || null,
    manufactureDate,
    supplier: data.supplier.trim(),
    purchasePrice: String(data.purchasePrice),
    warrantyMonths: data.warrantyMonths,
    stockQuantity: data.stockQuantity,
    minStockLevel: data.minStockLevel,
    location: data.location.trim(),
    notes: mergedNotes,
  };
}

/** Applique la date DOT sur semaine/année si les 4 derniers chiffres sont valides. */
export function applyDotToManufacturingFields(
  dotCode: string,
): { manufacturingWeek?: string; manufacturingYear?: string } {
  const parsed = parseDotManufacturingDate(dotCode);
  if (!parsed) {
    return {};
  }
  return {
    manufacturingWeek: parsed.week,
    manufacturingYear: parsed.year,
  };
}

/** Compatibilité : accepte l'ancien champ `size` monolithique. */
export function coerceTireFormInput(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    return body;
  }

  const record = { ...(body as Record<string, unknown>) };

  if (!record.sizeWidth && typeof record.size === "string") {
    const parsed = parseTireSize(record.size);
    if (parsed) {
      record.sizeWidth = parsed.width;
      record.sizeAspect = parsed.aspect;
      record.sizeDiameter = parsed.diameter;
    }
  }

  delete record.size;
  return record;
}

/** Valide et normalise un body API (formulaire ou champs partiels). */
export function parseTireFormPayload(body: unknown): TireFormData {
  return tireFormSchema.parse(coerceTireFormInput(body));
}

export function parseTireDbPayload(body: unknown): TireDbPayload {
  return mapTireFormToDb(parseTireFormPayload(body));
}

/** Accepte un body formulaire ou un payload déjà mappé vers la BDD. */
export function normalizeTireCreatePayload(body: unknown): TireDbPayload {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if ("maxLoadIndex" in record && !("loadIndex" in record)) {
      return record as TireDbPayload;
    }
  }
  return parseTireDbPayload(body);
}
