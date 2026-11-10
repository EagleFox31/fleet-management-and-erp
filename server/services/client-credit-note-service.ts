import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { clientCreditNotes, clientInvoices, type ClientCreditNote } from "@shared/schema";
import { statusAfterBalanceChange } from "@shared/constants/client-invoices";
import {
  CREDIT_NOTE_KEY_CONFLICT_MESSAGE,
  CREDIT_NOTE_KEY_OTHER_INVOICE_MESSAGE,
  type CreateClientCreditNoteInput,
  type CreateClientCreditNoteResult,
} from "@shared/contracts/client-credit-notes";
import { AppError } from "../lib/app-error";
import { moduleLogger } from "../lib/logger";
import { pgConstraintOf } from "../lib/pg-errors";
import { CREDIT_NOTE_NUMBER_SPEC, nextDailyNumber } from "../lib/daily-document-number";
import { creditNoteAmounts, toCents } from "../lib/credit-note-amounts";
import { publicClientInvoiceColumns } from "../lib/client-public-columns";

const log = moduleLogger("client-credit-note");

const fromCents = (cents: number): string => (cents / 100).toFixed(2);

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
}

const toDto = (row: ClientCreditNote) => ({ ...row, createdAt: row.createdAt.toISOString() });

/**
 * Avoir sur une facture client (lot V1, PR5), en une transaction : facture verrouillée, plafond au solde
 * (remboursements hors v1), rejeu par `request_key`, solde et cumul crédité mis à jour, statut recalculé.
 */
export async function createCreditNote(
  invoiceId: number,
  input: CreateClientCreditNoteInput,
  userId: number,
): Promise<CreateClientCreditNoteResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await createCreditNoteOnce(invoiceId, input, userId);
    } catch (error) {
      if (pgCode(error) !== "23505") throw error;
      const constraint = pgConstraintOf(error) ?? "";
      if (constraint.includes("credit_note_number")) {
        // Numéro du jour pris entre la lecture et l'insertion : un seul nouvel essai relit le numéro suivant.
        if (attempt === 0) {
          log.warn({ invoiceId, constraint }, "numéro d'avoir en collision, nouvel essai");
          continue;
        }
        throw new AppError(409, "Le numéro d'avoir est déjà pris par un autre avoir. Réessayez dans un instant.", { cause: error });
      }
      // Même clé utilisée en parallèle sur deux factures : la contrainte d'unicité de request_key tranche.
      if (constraint.includes("request_key")) {
        throw new AppError(409, "Cet avoir est déjà en cours d'enregistrement. Rechargez la facture avant de réessayer.", { cause: error });
      }
      throw error;
    }
  }
}

async function createCreditNoteOnce(
  invoiceId: number,
  input: CreateClientCreditNoteInput,
  userId: number,
): Promise<CreateClientCreditNoteResult> {
  return await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select({ ...publicClientInvoiceColumns, depositedAt: clientInvoices.depositedAt })
      .from(clientInvoices)
      .where(eq(clientInvoices.id, invoiceId))
      .limit(1)
      .for("update");
    if (!invoice) throw new AppError(404, "Cette facture n'existe plus.");

    const balanceCents = toCents(invoice.balance);

    // Même clé : même avoir rejoué (double clic, retry réseau). Rien n'est réécrit.
    const [same] = await tx
      .select()
      .from(clientCreditNotes)
      .where(eq(clientCreditNotes.requestKey, input.requestKey))
      .limit(1);
    if (same) {
      if (same.invoiceId !== invoiceId) {
        throw new AppError(409, CREDIT_NOTE_KEY_OTHER_INVOICE_MESSAGE);
      }
      // Rejeu identique seulement : même montant HT et même motif. Sinon la clé est déjà prise par un autre avoir.
      const sameAmount = toCents(same.amountHT) === toCents(input.amountHt);
      if (!sameAmount || same.reason !== input.reason) {
        throw new AppError(409, CREDIT_NOTE_KEY_CONFLICT_MESSAGE);
      }
      return {
        creditNote: toDto(same),
        invoiceId,
        previousBalance: balanceCents / 100,
        newBalance: balanceCents / 100,
        creditedAmountTtc: Number(invoice.creditedAmountTtc),
        status: invoice.status,
        replayed: true,
      };
    }

    if (invoice.status === "cancelled") {
      throw new AppError(409, "Cette facture est annulée : elle ne peut plus recevoir d'avoir.");
    }

    const { htCents, vatCents, ttcCents } = creditNoteAmounts(input.amountHt, invoice.vatRate);
    if (htCents <= 0) throw new AppError(400, "Le montant de l'avoir doit être supérieur à 0.");

    if (balanceCents <= 0) {
      throw new AppError(409, "Cette facture est déjà soldée : un avoir ne peut pas dépasser le solde restant.");
    }
    if (ttcCents > balanceCents) {
      throw new AppError(
        409,
        `L'avoir (${fromCents(ttcCents)} FCFA TTC) dépasse le solde restant de la facture (${fromCents(balanceCents)} FCFA). ` +
          "Le remboursement d'un trop-perçu n'est pas géré pour l'instant.",
      );
    }

    if (invoice.depositedAt) {
      // Net à payer figé au dépôt sur la base d'avant l'avoir : recalcul = backlog, on refuse (fail-closed).
      throw new AppError(409, "Facture déposée : l'avoir n'est pas encore possible, net à payer figé.");
    }

    const newBalanceCents = balanceCents - ttcCents;
    const creditedCents = toCents(invoice.creditedAmountTtc) + ttcCents;
    const status = statusAfterBalanceChange(invoice.status, newBalanceCents / 100, Number(invoice.amountTTC));

    const creditNoteNumber = await nextDailyNumber(tx, CREDIT_NOTE_NUMBER_SPEC);
    const [created] = await tx
      .insert(clientCreditNotes)
      .values({
        creditNoteNumber,
        invoiceId,
        reason: input.reason,
        amountHT: fromCents(htCents),
        vatRate: String(invoice.vatRate ?? "0"),
        vatAmount: fromCents(vatCents),
        amountTTC: fromCents(ttcCents),
        requestKey: input.requestKey,
        createdBy: userId,
      })
      .returning();

    // Compare-and-set sur le statut lu sous verrou : une facture qui a changé d'état entre-temps n'est pas écrasée.
    const [updated] = await tx
      .update(clientInvoices)
      .set({
        balance: fromCents(newBalanceCents),
        creditedAmountTtc: fromCents(creditedCents),
        status,
        updatedAt: new Date(),
      })
      .where(and(eq(clientInvoices.id, invoiceId), eq(clientInvoices.status, invoice.status)))
      .returning({ id: clientInvoices.id });
    if (!updated) {
      throw new AppError(409, "La facture a changé d'état pendant l'opération. Rechargez-la et recommencez.");
    }

    log.info({ invoiceId, creditNoteNumber, userId }, "avoir émis");
    return {
      creditNote: toDto(created),
      invoiceId,
      previousBalance: balanceCents / 100,
      newBalance: newBalanceCents / 100,
      creditedAmountTtc: creditedCents / 100,
      status,
      replayed: false,
    };
  });
}

/** Avoirs d'une facture, du plus ancien au plus récent. */
export async function listCreditNotesOfInvoice(invoiceId: number) {
  const [invoice] = await db
    .select({ id: clientInvoices.id })
    .from(clientInvoices)
    .where(eq(clientInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new AppError(404, "Cette facture n'existe plus.");
  const rows = await db
    .select()
    .from(clientCreditNotes)
    .where(eq(clientCreditNotes.invoiceId, invoiceId))
    .orderBy(asc(clientCreditNotes.id));
  return rows.map(toDto);
}

export async function getCreditNoteById(id: number): Promise<ClientCreditNote> {
  const [row] = await db
    .select()
    .from(clientCreditNotes)
    .where(and(eq(clientCreditNotes.id, id)))
    .limit(1);
  if (!row) throw new AppError(404, "Cet avoir n'existe pas.");
  return row;
}
