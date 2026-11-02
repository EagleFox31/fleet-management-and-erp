import { z } from "zod";

/**
 * Démontage d'un pneu : l'atelier choisit OBLIGATOIREMENT sa destination,
 * comme dans les logiciels de gestion de pneus du marché (RTA Fleet, Eptura) :
 *
 * - `stock` : pneu réutilisable, il retourne au magasin en usagé (`tires.used_stock_quantity + 1`) ;
 * - `scrap` : pneu mis au rebut, motif obligatoire, le stock ne bouge pas.
 *
 * Le montage (`vehicle_tires`) garde la trace dans son `status` :
 * `removed` = remis en stock, `worn` / `damaged` / `punctured` = rebut et sa cause.
 *
 * Le rechapage n'est pas modélisé (absent de la feuille PNEUMATIQUE).
 */
export const TIRE_REMOVAL_DESTINATIONS = ["stock", "scrap"] as const;
export type TireRemovalDestination = (typeof TIRE_REMOVAL_DESTINATIONS)[number];

export const TIRE_SCRAP_REASONS = ["worn", "damaged", "punctured"] as const;
export type TireScrapReason = (typeof TIRE_SCRAP_REASONS)[number];

export const TIRE_REMOVAL_DESTINATION_LABELS: Record<TireRemovalDestination, string> = {
  stock: "Remettre en stock (usagé)",
  scrap: "Mettre au rebut",
};

export const TIRE_SCRAP_REASON_LABELS: Record<TireScrapReason, string> = {
  worn: "Usé",
  damaged: "Endommagé",
  punctured: "Crevé, non réparable",
};

/** Libellé du montage : il décrit l'état du pneu sur ce véhicule, pas l'action. */
export const VEHICLE_TIRE_STATUS_LABELS = {
  active: "Monté",
  removed: "Remis en stock",
  worn: "Rebut : usé",
  damaged: "Rebut : endommagé",
  punctured: "Rebut : crevé",
} as const;

export function getVehicleTireStatusLabel(status: string): string {
  return VEHICLE_TIRE_STATUS_LABELS[status as keyof typeof VEHICLE_TIRE_STATUS_LABELS] ?? status;
}

export const tireRemovalSchema = z
  .object({
    destination: z.enum(TIRE_REMOVAL_DESTINATIONS, {
      errorMap: () => ({ message: "Choisir la destination du pneu démonté" }),
    }),
    scrapReason: z.enum(TIRE_SCRAP_REASONS).optional(),
    removalMileage: z.coerce.number().int().min(0, "Kilométrage invalide").optional(),
    removalReason: z.string().trim().max(500).optional(),
  })
  .refine((data) => data.destination !== "scrap" || data.scrapReason !== undefined, {
    message: "Indiquer le motif de mise au rebut",
    path: ["scrapReason"],
  });

export type TireRemoval = z.infer<typeof tireRemovalSchema>;

/** Colonnes de `vehicle_tires` que le PATCH générique refuse : elles relèvent du montage / démontage. */
export const VEHICLE_TIRE_LIFECYCLE_FIELDS = [
  "status",
  "tireId",
  "vehicleId",
  "removalDate",
  "removalMileage",
  "removalReason",
  "stockSource",
] as const;

/** Statut du montage après démontage. */
export function vehicleTireStatusAfterRemoval(removal: Pick<TireRemoval, "destination" | "scrapReason">) {
  return removal.destination === "stock" ? "removed" : removal.scrapReason!;
}
