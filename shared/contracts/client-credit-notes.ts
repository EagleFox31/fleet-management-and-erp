import { z } from "zod";

/**
 * Avoirs sur facture client (lot V1, PR5).
 * Un avoir est immuable : il se corrige par un autre avoir, jamais par une modification.
 * Montant en HT ; la TVA reprend le taux de la facture. Remboursements hors v1 : l'avoir est plafonné au solde.
 */
export const CREDIT_NOTE_REASON_MIN = 3;
export const CREDIT_NOTE_REASON_MAX = 500;

/** Décimal strictement positif à 2 chiffres au plus (nombre ou chaîne), ramené à un nombre. */
const positiveAmount = z
  .union([z.string(), z.number()], { errorMap: () => ({ message: "Le montant de l'avoir est obligatoire." }) })
  .transform((v) => String(v).trim().replace(",", "."))
  .refine((v) => /^\d{1,13}(\.\d{1,2})?$/.test(v), "Le montant de l'avoir est invalide (2 décimales au plus).")
  .transform((v) => Number(v))
  .refine((v) => v > 0, "Le montant de l'avoir doit être supérieur à 0.");

export const createClientCreditNoteSchema = z.object({
  amountHt: positiveAmount,
  reason: z
    .string({ required_error: "Le motif de l'avoir est obligatoire." })
    .trim()
    .min(CREDIT_NOTE_REASON_MIN, `Le motif doit faire au moins ${CREDIT_NOTE_REASON_MIN} caractères.`)
    .max(CREDIT_NOTE_REASON_MAX, `Le motif ne doit pas dépasser ${CREDIT_NOTE_REASON_MAX} caractères.`),
  requestKey: z
    .string({ required_error: "La clé de requête est obligatoire." })
    .trim()
    .min(8, "La clé de requête est trop courte.")
    .max(100, "La clé de requête est trop longue."),
});

export type CreateClientCreditNoteInput = z.infer<typeof createClientCreditNoteSchema>;

export type ClientCreditNoteDto = {
  id: number;
  creditNoteNumber: string;
  invoiceId: number;
  reason: string;
  amountHT: string;
  vatRate: string;
  vatAmount: string;
  amountTTC: string;
  createdBy: number | null;
  createdAt: string;
};

export type CreateClientCreditNoteResult = {
  creditNote: ClientCreditNoteDto;
  invoiceId: number;
  previousBalance: number;
  newBalance: number;
  creditedAmountTtc: number;
  status: string;
  replayed: boolean;
};
