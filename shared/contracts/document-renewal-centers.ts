/**
 * Centres agréés de renouvellement de documents (DOC1).
 *
 * Un centre ne se supprime pas : les demandes le référencent (snapshot du nom).
 * Il se désactive (`isActive = false`) ; une demande vers un centre désactivé
 * est refusée (409), les demandes existantes ne changent pas.
 * Écriture : `DOCUMENT_RENEWAL_WRITER_ROLES`. Lecture : `GET /centers` (inchangé),
 * `?includeInactive=1` réservé aux rôles écrivains (403 sinon).
 */
import { z } from "zod";

export const DOCUMENT_RENEWAL_CENTERS_PATH = "/api/document-renewals/centers";
export const documentRenewalCenterPath = (id: number) => `${DOCUMENT_RENEWAL_CENTERS_PATH}/${id}`;
export const documentRenewalCenterActivePath = (id: number) => `${documentRenewalCenterPath(id)}/active`;

export const DOCUMENT_RENEWAL_CENTER_DOCUMENT_TYPES = ["carte_grise", "assurance", "visite_technique", "taxe", "autre"] as const;

/** Forme de comparaison d'un nom de centre : casse, bords et espaces répétés ignorés. */
export function normalizeCenterName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

export const optionalText =(max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value ? value : null));

export const nameSchema = z.string().trim().min(2, "Nom du centre trop court.").max(150);
const documentTypeSchema = z.enum(DOCUMENT_RENEWAL_CENTER_DOCUMENT_TYPES).nullable().optional();

export const createDocumentRenewalCenterRequestSchema = z
  .object({
    name: nameSchema,
    /** `null` : centre valable pour tous les types de document. */
    documentType: documentTypeSchema,
    accreditationNumber: optionalText(80),
    address: optionalText(300),
    contact: optionalText(200),
  })
  .strict();
export type CreateDocumentRenewalCenterRequest = z.infer<typeof createDocumentRenewalCenterRequestSchema>;

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));

export const updateDocumentRenewalCenterRequestSchema = z
  .object({
    name: nameSchema,
    documentType: z.enum(DOCUMENT_RENEWAL_CENTER_DOCUMENT_TYPES).nullable(),
    accreditationNumber: nullableText(80),
    address: nullableText(300),
    contact: nullableText(200),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Aucune modification fournie." });
export type UpdateDocumentRenewalCenterRequest = z.infer<typeof updateDocumentRenewalCenterRequestSchema>;

export const setDocumentRenewalCenterActiveRequestSchema = z.object({ isActive: z.boolean() }).strict();

export const documentRenewalCenterSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  documentType: z.enum(DOCUMENT_RENEWAL_CENTER_DOCUMENT_TYPES).nullable(),
  accreditationNumber: z.string().nullable(),
  address: z.string().nullable(),
  contact: z.string().nullable(),
  isActive: z.boolean(),
});
export type DocumentRenewalCenter = z.infer<typeof documentRenewalCenterSchema>;
