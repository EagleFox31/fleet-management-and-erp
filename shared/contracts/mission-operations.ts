import { z } from "zod";
import { bodyIdSchema, MAX_DB_INTEGER_ID } from "./common";

/** Suivi des opérations clients (O1) : une ligne par mission, colonnes de la feuille de suivi client. */
export const MISSION_OPERATIONS_PATH = "/api/mission-operations";

/**
 * Récapitulatif en 5 statuts (réponses client Q4) : voyage (chargement, départ) puis facturation
 * (retour, pas de n° de facture) puis attente de paiement (facture déposée) puis payée ; annulée à part.
 * Simple correspondance : l'enum `missions.status` reste inchangé. La bascule voyage vers facturation
 * n'est pas formalisée côté client : elle suit le statut livrée/terminée de la mission (action manuelle)
 * ou une date de retour saisie.
 */
export const OPERATION_RECAP_STATUSES = ["trip", "invoicing", "awaiting_payment", "paid", "cancelled"] as const;
export type OperationRecapStatus = (typeof OPERATION_RECAP_STATUSES)[number];

export const OPERATION_RECAP_LABELS: Record<OperationRecapStatus, string> = {
  trip: "Voyage",
  invoicing: "Facturation",
  awaiting_payment: "Attente paiement",
  paid: "Payée",
  cancelled: "Annulée",
};

/** `invoiceStatus` : statut de la facture client liée à la mission, `null` s'il n'y en a pas. */
export function recapStatusOf(input: {
  missionStatus: string | null | undefined;
  invoiceStatus?: string | null;
  returnDate?: string | Date | null;
}): OperationRecapStatus {
  if (input.missionStatus === "cancelled") return "cancelled";
  if (input.invoiceStatus === "cancelled") return "invoicing";
  if (input.invoiceStatus === "paid") return "paid";
  if (input.invoiceStatus) return "awaiting_payment";
  if (input.missionStatus === "delivered" || input.missionStatus === "completed" || input.returnDate) return "invoicing";
  return "trip";
}

/**
 * Base de calcul de la durée de voyage. Défaut : déchargement moins départ (les formules du client
 * utilisent le départ, réponse Q6) ; configurable, jamais figée.
 */
export const TRIP_DURATION_BASES = ["loading_unloading", "departure_unloading", "loading_return"] as const;
export type TripDurationBasis = (typeof TRIP_DURATION_BASES)[number];
export const DEFAULT_TRIP_DURATION_BASIS: TripDurationBasis = "departure_unloading";

export const TRIP_DURATION_BASIS_LABELS: Record<TripDurationBasis, string> = {
  loading_unloading: "Déchargement − chargement",
  departure_unloading: "Déchargement − départ",
  loading_return: "Retour − chargement",
};

const MS_PER_DAY = 86_400_000;

type OperationDates = {
  loadingDate?: string | Date | null;
  departureDate?: string | Date | null;
  returnDate?: string | Date | null;
  unloadingDate?: string | Date | null;
};

/** Durée en jours (arrondie à 0,1), `null` si une date manque ou si la fin précède le début. */
export function tripDurationDays(op: OperationDates, basis: TripDurationBasis = DEFAULT_TRIP_DURATION_BASIS): number | null {
  const [from, to] =
    basis === "departure_unloading" ? [op.departureDate, op.unloadingDate]
    : basis === "loading_return" ? [op.loadingDate, op.returnDate]
    : [op.loadingDate, op.unloadingDate];
  if (!from || !to) return null;
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round(((end - start) / MS_PER_DAY) * 10) / 10;
}

const isoDate = z.union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]).nullable().optional();
const text = (max: number) => z.string().trim().max(max).nullable().optional();

/** Corps de la saisie : tout est facultatif, une chaîne vide efface. L'id de mission vient de l'URL. */
export const missionOperationBodySchema = z.object({
  trailerVehicleId: bodyIdSchema.nullable().optional(),
  containerNumber: text(60),
  blNumber: text(60),
  sector: text(120),
  loadingDate: isoDate,
  departureDate: isoDate,
  returnDate: isoDate,
  unloadingDate: isoDate,
  goodsNature: text(200),
  comment: text(2000),
}).strict();
export type MissionOperationBody = z.infer<typeof missionOperationBodySchema>;

export const missionOperationRowSchema = z.object({
  missionId: z.number().max(MAX_DB_INTEGER_ID),
  orderNumber: z.string(),
  clientId: z.number().max(MAX_DB_INTEGER_ID).nullable(),
  clientName: z.string().nullable(),
  pickupAddress: z.string(),
  deliveryAddress: z.string(),
  missionStatus: z.string(),
  invoiceNumber: z.string().nullable(),
  invoiceStatus: z.string().nullable(),
  recapStatus: z.enum(OPERATION_RECAP_STATUSES),
  trailerVehicleId: z.number().max(MAX_DB_INTEGER_ID).nullable(),
  containerNumber: z.string().nullable(),
  blNumber: z.string().nullable(),
  sector: z.string().nullable(),
  loadingDate: z.string().nullable(),
  departureDate: z.string().nullable(),
  returnDate: z.string().nullable(),
  unloadingDate: z.string().nullable(),
  goodsNature: z.string().nullable(),
  comment: z.string().nullable(),
});
export type MissionOperationRow = z.infer<typeof missionOperationRowSchema>;

export const missionOperationsResponseSchema = z.object({
  rows: z.array(missionOperationRowSchema),
  recap: z.record(z.enum(OPERATION_RECAP_STATUSES), z.number()),
});
export type MissionOperationsResponse = z.infer<typeof missionOperationsResponseSchema>;
