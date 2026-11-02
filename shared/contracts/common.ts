/**
 * Briques communes aux contrats du lot recette (ADR 0001).
 *
 * Un contrat exporte ses chemins, ses schémas zod `…Query`, `…Request`,
 * `…Response` et les types inférés. Il est importé tel quel par le serveur
 * (validation) et par le client (typage, données simulées) : les deux côtés
 * ne peuvent pas diverger.
 */
import { z } from "zod";
import { isIsoCalendarDate } from "../constants/calendar-date";

/** Date calendaire `AAAA-MM-JJ`. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date attendue au format AAAA-MM-JJ.")
  .refine(isIsoCalendarDate, "Cette date n'existe pas au calendrier.");

/** Horodatage ISO 8601 renvoyé par le serveur. */
export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Identifiant numérique venant d'une query string ou d'un paramètre de route. */
export const idSchema = z.coerce.number().int().positive();

/** Période `from` / `to`, bornes incluses, toutes deux facultatives. */
export const dateRangeQuerySchema = z
  .object({ from: isoDateSchema.optional(), to: isoDateSchema.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "La date de début doit précéder la date de fin.",
    path: ["from"],
  });

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Réponse paginée : `items` plus le total sans pagination. */
export function pagedResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}

/** Utilisateur résumé, tel qu'affiché à côté d'une action (« par … »). */
export const userRefSchema = z.object({ id: z.number().int(), name: z.string() });

export type IsoDate = z.infer<typeof isoDateSchema>;
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;
export type UserRef = z.infer<typeof userRefSchema>;
