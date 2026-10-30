/**
 * Réception signée d'une pièce (P-16). Drapeau `part-requirement-receive`.
 *
 * Pas de nouvelle route : la réception passe par la transition existante
 * `PATCH /api/part-requirements/:id` vers `received`, qui attribue déjà
 * `receivedBy` à qui réceptionne (30 octobre 2026, AGENTS.md §9). Une route
 * `POST …/receive` en doublerait la règle. Le lot ajoute la date de réception
 * et l'affichage « Entrée en stock par … le … ».
 *
 * `receivedBy` et `receivedAt` sont posés par le serveur, jamais lus du corps.
 * Les demandes reçues avant le 30 octobre 2026 restent à `null` (« inconnu »).
 */
import { z } from "zod";
import { isoDateTimeSchema } from "./common";

export const partRequirementReceptionSchema = z.object({
  receivedBy: z.number().int().nullable(),
  receivedByName: z.string().nullable(),
  receivedAt: isoDateTimeSchema.nullable(),
});

export type PartRequirementReception = z.infer<typeof partRequirementReceptionSchema>;
