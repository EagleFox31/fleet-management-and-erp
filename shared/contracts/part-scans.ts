/**
 * QR code et code-barres des pièces (CDC-3, drapeau `part-qr`).
 *
 * Deux routes, toutes deux en lecture seule, montées sur `/api/part-scans` :
 * - `GET /api/part-scans/resolve?code=…` : code scanné -> fiche pièce minimale
 *   (rôles `PART_SCAN_ROLES`) ;
 * - `GET /api/part-scans/labels?ids=1,2,3` : charge utile et textes à imprimer
 *   (rôles `PART_LABEL_ROLES`, garde propre au routeur).
 *
 * Aucune réponse ne porte de prix : ni prix d'achat, ni prix unitaire, ni fournisseur.
 * La sortie de stock reste `POST /api/work-orders/:id/part-requirements/:id/issue`.
 *
 * Charge utile d'une étiquette : URL relative versionnée `/inventory/scan?c=FM1:<partId>`.
 * Le client l'imprime telle quelle dans le QR, ou la préfixe de son origine courante
 * (`window.location.origin`) pour qu'un appareil photo ordinaire l'ouvre : le serveur
 * accepte les deux formes, sur n'importe quel hôte.
 */
import { z } from "zod";

export const PART_SCANS_BASE_PATH = "/api/part-scans";
export const PART_SCAN_RESOLVE_PATH = `${PART_SCANS_BASE_PATH}/resolve`;
export const PART_SCAN_LABELS_PATH = `${PART_SCANS_BASE_PATH}/labels`;

/** Écran client qui reçoit le scan ; chemin de la charge utile. */
export const PART_SCAN_SCREEN_PATH = "/inventory/scan";
/** Clé de requête de la charge utile (`/inventory/scan?c=FM1:12`). */
export const PART_SCAN_QUERY_KEY = "c";
/** Version de la charge utile. Un changement de forme incrémente ce numéro (`FM2:`), jamais l'inverse. */
export const PART_SCAN_CODE_VERSION = 1;

/** Plus grand identifiant de pièce (colonne `serial` PostgreSQL). */
export const PART_ID_MAX = 2_147_483_647;
/** Longueur maximale d'un code reçu : une URL de QR fait moins de 100 caractères. */
export const PART_SCAN_CODE_MAX_LENGTH = 300;
/** Nombre maximal de pièces par demande d'étiquettes. */
export const PART_LABELS_MAX_IDS = 100;

// --- Résolution d'un code scanné

export const partScanResolveQuerySchema = z.object({
  code: z
    .string({ required_error: "Code à résoudre manquant.", invalid_type_error: "Code à résoudre invalide." })
    .trim()
    .min(1, "Code à résoudre manquant.")
    .max(PART_SCAN_CODE_MAX_LENGTH, `Code trop long (${PART_SCAN_CODE_MAX_LENGTH} caractères au plus).`),
});
export type PartScanResolveQuery = z.infer<typeof partScanResolveQuerySchema>;

/**
 * Projection minimale de la fiche pièce. `name` est la désignation (même nom que sur
 * `/api/parts`). `strict` : tout champ ajouté, un prix par exemple, fait échouer le parse
 * de la réponse côté serveur plutôt que de fuiter.
 */
export const partScanResolveResponseSchema = z
  .object({
    id: z.number().int().positive(),
    reference: z.string(),
    name: z.string(),
    quantity: z.number().int(),
    location: z.string().nullable(),
    unit: z.string(),
  })
  .strict();
export type PartScanResolveResponse = z.infer<typeof partScanResolveResponseSchema>;

// --- Étiquettes

const ID_TOKEN = /^[1-9]\d{0,9}$/;

/** `ids=1,2,3` -> `[1, 2, 3]` : entiers stricts, sans doublon, bornés en nombre. Rien n'est tronqué. */
export const partLabelsQuerySchema = z.object({
  ids: z
    .string({ required_error: "Liste de pièces manquante.", invalid_type_error: "Liste de pièces invalide." })
    .max(PART_LABELS_MAX_IDS * 12, "Liste de pièces trop longue.")
    .transform((raw, ctx) => {
      const tokens = raw.split(",").map((token) => token.trim());
      if (tokens.length > PART_LABELS_MAX_IDS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${PART_LABELS_MAX_IDS} pièces au plus par demande.` });
        return z.NEVER;
      }
      const ids: number[] = [];
      for (const token of tokens) {
        const id = ID_TOKEN.test(token) ? Number(token) : NaN;
        if (!Number.isSafeInteger(id) || id > PART_ID_MAX) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Identifiants de pièces invalides : nombres entiers séparés par des virgules." });
          return z.NEVER;
        }
        if (!ids.includes(id)) ids.push(id);
      }
      return ids;
    }),
});
export type PartLabelsQuery = z.infer<typeof partLabelsQuerySchema>;

/** Une étiquette : la charge utile du QR et les textes imprimés dessous. Pas de prix. */
export const partLabelSchema = z
  .object({
    partId: z.number().int().positive(),
    /** Contenu du QR : `/inventory/scan?c=FM1:<partId>`. */
    payload: z.string(),
    reference: z.string(),
    name: z.string(),
    location: z.string().nullable(),
    unit: z.string(),
  })
  .strict();
export type PartLabel = z.infer<typeof partLabelSchema>;

export const partLabelsResponseSchema = z
  .object({
    /** Dans l'ordre demandé. */
    items: z.array(partLabelSchema),
    /** Identifiants demandés qui ne correspondent à aucune pièce. */
    missingIds: z.array(z.number().int().positive()),
  })
  .strict();
export type PartLabelsResponse = z.infer<typeof partLabelsResponseSchema>;
