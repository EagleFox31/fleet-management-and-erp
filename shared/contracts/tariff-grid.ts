import { z } from "zod";
import { bodyIdSchema, idSchema, isoDateSchema, MAX_DB_INTEGER_ID } from "./common";

/**
 * Grille tarifaire (O3) : prix suggéré par client, trajet, type de marchandise et période.
 * Une suggestion n'est jamais appliquée seule : l'utilisateur garde la main sur le prix de la facture.
 * Devise unique : XAF (aucune colonne de devise).
 */
export const TARIFF_GRID_PATH = "/api/tariff-grid";
export const TARIFF_SUGGEST_PATH = "/api/tariff-grid/suggest";

export const PRICING_UNITS = ["ton", "container", "trip"] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];
export const PRICING_UNIT_LABELS: Record<PricingUnit, string> = {
  ton: "Tonne",
  container: "Conteneur",
  trip: "Voyage",
};

const day = isoDateSchema;
const place = z.string().trim().min(1).max(120);
const unitPrice = z.number().int().min(0).max(9_999_999_999_999);

/** Champs saisissables : jamais d'id, d'auteur ni d'horodatage (posés par le serveur). */
export const tariffBodyShape = {
  clientId: bodyIdSchema.nullable().optional(),
  origin: place,
  destination: place,
  cargoType: z.string().trim().max(120).optional(),
  pricingUnit: z.enum(PRICING_UNITS),
  unitPrice,
  validFrom: day,
  validTo: day.nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
};
export const tariffBodySchema = z.object(tariffBodyShape);
export type TariffBody = z.infer<typeof tariffBodySchema>;

export const tariffRowSchema = z.object({
  id: z.number().max(MAX_DB_INTEGER_ID),
  clientId: z.number().max(MAX_DB_INTEGER_ID).nullable(),
  clientName: z.string().nullable(),
  origin: z.string(),
  destination: z.string(),
  cargoType: z.string(),
  pricingUnit: z.enum(PRICING_UNITS),
  unitPrice: z.number(),
  validFrom: z.string(),
  validTo: z.string().nullable(),
  active: z.boolean(),
  notes: z.string().nullable(),
});
export type TariffRow = z.infer<typeof tariffRowSchema>;

/** Pagination de la liste : `rows` reste la page courante, `total` compte toutes les lignes du filtre. */
export const TARIFF_PAGE_SIZE_DEFAULT = 50;
export const TARIFF_PAGE_SIZE_MAX = 200;
export const tariffListResponseSchema = z.object({
  rows: z.array(tariffRowSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(TARIFF_PAGE_SIZE_MAX),
  offset: z.number().int().min(0),
});
export type TariffListResponse = z.infer<typeof tariffListResponseSchema>;

export const tariffListQuerySchema = z.object({
  clientId: idSchema.optional(),
  activeOnly: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(TARIFF_PAGE_SIZE_MAX).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

export const tariffSuggestQuerySchema = z.object({
  clientId: idSchema.optional(),
  origin: place,
  destination: place,
  cargoType: z.string().trim().max(120).optional(),
  date: day.optional(),
});

export const TARIFF_SUGGESTION_SOURCES = ["client", "generic"] as const;
export const tariffSuggestionSchema = z.object({
  suggestion: z
    .object({
      tariffId: z.number().max(MAX_DB_INTEGER_ID),
      unitPrice: z.number(),
      pricingUnit: z.enum(PRICING_UNITS),
      source: z.enum(TARIFF_SUGGESTION_SOURCES),
    })
    .nullable(),
});
export type TariffSuggestion = z.infer<typeof tariffSuggestionSchema>;

type Candidate = {
  id: number;
  clientId: number | null;
  origin: string;
  destination: string;
  cargoType: string;
  pricingUnit: PricingUnit;
  unitPrice: number;
  validFrom: string;
  validTo: string | null;
  active: boolean;
};

const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

/**
 * Choix du tarif à suggérer : même trajet (insensible à la casse), actif, date dans la période.
 * Un type de marchandise renseigné doit correspondre ; un tarif sans type vaut pour tous les types,
 * mais un tarif au type exact passe devant. Le tarif du client passe devant le générique ;
 * à égalité, la période la plus récente l'emporte.
 */
export function pickTariff(
  candidates: readonly Candidate[],
  query: { clientId?: number | null; origin: string; destination: string; cargoType?: string; date: string },
): TariffSuggestion["suggestion"] {
  const cargo = norm(query.cargoType);
  const rank = (t: Candidate) => (t.clientId !== null ? 2 : 0) + (norm(t.cargoType) === cargo && cargo !== "" ? 1 : 0);
  const eligible = candidates.filter(
    (t) =>
      t.active &&
      (t.clientId === null || t.clientId === (query.clientId ?? -1)) &&
      norm(t.origin) === norm(query.origin) &&
      norm(t.destination) === norm(query.destination) &&
      (norm(t.cargoType) === "" || norm(t.cargoType) === cargo) &&
      t.validFrom <= query.date &&
      (t.validTo === null || t.validTo >= query.date),
  );
  if (!eligible.length) return null;
  const best = [...eligible].sort((a, b) => rank(b) - rank(a) || (a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : 0))[0];
  return { tariffId: best.id, unitPrice: best.unitPrice, pricingUnit: best.pricingUnit, source: best.clientId !== null ? "client" : "generic" };
}

/** Deux périodes [from, to] (to nul = sans fin) se chevauchent-elles ? */
export function periodsOverlap(a: { validFrom: string; validTo: string | null }, b: { validFrom: string; validTo: string | null }): boolean {
  return (a.validTo === null || a.validTo >= b.validFrom) && (b.validTo === null || b.validTo >= a.validFrom);
}
