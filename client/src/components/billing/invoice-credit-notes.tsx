import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PremiumTableShell } from "@/components/design-system";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { newRequestKey } from "@/lib/request-key";
import { satelliteTargetsOf } from "@/lib/realtime-satellites";
import { formatPrice } from "@/lib/utils";
import { canIssueCreditNote, creditNoteBlockerOf, creditNotesKeyOf, invoiceKeyOf, type CreditableInvoice } from "@/lib/credit-note-rules";
import { creditNoteAmounts, maxCreditNoteHtOf } from "@shared/constants/client-invoices";
import {
  CREDIT_NOTE_REASON_MAX,
  CREDIT_NOTE_REASON_MIN,
  type ClientCreditNoteDto,
  type CreateClientCreditNoteResult,
} from "@shared/contracts/client-credit-notes";

/** Couche 1 : solde, statut, cumul des avoirs et liste des avoirs à jour dans le cache, sans attendre le refetch. */
function applyCreditNoteToCache(result: CreateClientCreditNoteResult): void {
  queryClient.setQueryData([invoiceKeyOf(result.invoiceId)], (current: unknown) =>
    current && typeof current === "object"
      ? {
          ...current,
          balance: String(result.newBalance),
          status: result.status,
          creditedAmountTtc: String(result.creditedAmountTtc),
        }
      : current,
  );
  queryClient.setQueryData<ClientCreditNoteDto[]>([creditNotesKeyOf(result.invoiceId)], (current) =>
    Array.isArray(current)
      ? current.some((row) => row.id === result.creditNote.id)
        ? current
        : [result.creditNote, ...current]
      : current,
  );
}

/** Couche 3 : détail, avoirs, listes de factures et écrans satellites de l'argent client. */
function invalidateAfterCreditNote(invoiceId: number): void {
  const keys = new Set<string>([
    ...satelliteTargetsOf("client_credit_note_created").keys,
    invoiceKeyOf(invoiceId),
    creditNotesKeyOf(invoiceId),
    "/api/billing/invoices",
    "/api/billing/invoices/summary",
    "/api/billing/invoices/pending",
    "/api/billing/invoices/overdue",
    "/api/billing/statistics",
    "/api/billing/client-summary",
  ]);
  for (const key of keys) queryClient.invalidateQueries({ queryKey: [key] });
}

async function downloadCreditNotePdf(creditNote: ClientCreditNoteDto): Promise<void> {
  const response = await fetch(`/api/billing/credit-notes/${creditNote.id}/pdf`, { credentials: "include" });
  if (!response.ok) throw new Error(String(response.status));
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Avoir_${creditNote.creditNoteNumber}.pdf`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  a.remove();
}

const formatDateTime = (value: string) =>
  new Date(value).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });

const th = "text-left px-5 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500";

/**
 * Avoirs d'une facture : liste (rôles de facturation), PDF, et émission (admin, comptable).
 * Le serveur reste juge : plafond au solde, facture annulée, soldée ou déposée refusées en 409.
 * L'événement `client_credit_note_created` est émis par le serveur (couche 2).
 */
export function InvoiceCreditNotes({ invoice, role }: { invoice: CreditableInvoice; role: string | null | undefined }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [amountHt, setAmountHt] = useState("");
  const [reason, setReason] = useState("");
  // Une clé par saisie : un double envoi ou un nouvel essai après coupure rend le même avoir.
  const [requestKey, setRequestKey] = useState(newRequestKey);

  const { data: creditNotes = [], isLoading } = useQuery<ClientCreditNoteDto[]>({
    queryKey: [creditNotesKeyOf(invoice.id)],
  });

  const canWrite = canIssueCreditNote(role);
  const blocker = creditNoteBlockerOf(invoice);
  const balance = Number.parseFloat(invoice.balance || "0");
  const maxHt = maxCreditNoteHtOf(balance, invoice.vatRate);

  const parsedHt = Number(amountHt.trim().replace(",", "."));
  const amountValid = /^\d{1,13}([.,]\d{1,2})?$/.test(amountHt.trim()) && parsedHt > 0;
  const preview = amountValid ? creditNoteAmounts(parsedHt, invoice.vatRate) : null;
  const overBalance = preview !== null && preview.ttcCents > Math.round(balance * 100);
  const reasonLength = reason.trim().length;
  const reasonValid = reasonLength >= CREDIT_NOTE_REASON_MIN && reasonLength <= CREDIT_NOTE_REASON_MAX;

  const resetForm = () => {
    setAmountHt("");
    setReason("");
    setRequestKey(newRequestKey());
  };

  const mutation = useMutation({
    mutationFn: async (vars: { invoiceId: number; amountHt: string; reason: string; requestKey: string }) => {
      const res = await apiRequest("POST", creditNotesKeyOf(vars.invoiceId), {
        amountHt: vars.amountHt,
        reason: vars.reason,
        requestKey: vars.requestKey,
      });
      return (await res.json()) as CreateClientCreditNoteResult;
    },
    onSuccess: (result, vars) => {
      applyCreditNoteToCache(result);
      invalidateAfterCreditNote(vars.invoiceId);
      setOpen(false);
      resetForm();
      toast({
        title: "Avoir émis",
        description: `${result.creditNote.creditNoteNumber} : solde restant ${formatPrice(result.newBalance)}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Avoir non émis",
        description: userMessageOf(error, "L'avoir n'a pas pu être émis."),
        variant: "destructive",
      });
    },
  });
  const submit = useSingleFlightMutate(mutation.mutate);

  const handleDownload = async (creditNote: ClientCreditNoteDto) => {
    try {
      await downloadCreditNotePdf(creditNote);
    } catch {
      toast({ title: "Erreur", description: "Impossible de télécharger le PDF de l'avoir.", variant: "destructive" });
    }
  };

  return (
    <>
      <PremiumTableShell
        className="xl:col-span-3"
        toolbar={
          <>
            <div className="inline-flex items-center gap-2">
              <FileMinus className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-semibold text-gray-800">Avoirs</span>
            </div>
            {canWrite && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-8"
                disabled={blocker !== null}
                title={blocker ?? undefined}
                onClick={() => setOpen(true)}
                data-testid="button-issue-credit-note"
              >
                <FileMinus className="h-4 w-4 mr-1.5" />
                Émettre un avoir
              </Button>
            )}
          </>
        }
        tableContainerClassName="max-h-none"
      >
        {isLoading ? (
          <div className="px-5 py-6 text-sm text-gray-500">Chargement des avoirs…</div>
        ) : creditNotes.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-gray-500" data-testid="no-credit-notes-message">
            Aucun avoir sur cette facture.
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="credit-notes-table">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-100">
                <th className={th}>Numéro</th>
                <th className={th}>Date</th>
                <th className={th}>Motif</th>
                <th className={`${th} text-right`}>Montant HT</th>
                <th className={`${th} text-right`}>Montant TTC</th>
                <th className={`${th} text-right`}>PDF</th>
              </tr>
            </thead>
            <tbody>
              {creditNotes.map((creditNote) => (
                <tr key={creditNote.id} className="border-b border-slate-100 last:border-0" data-testid={`credit-note-row-${creditNote.id}`}>
                  <td className="px-5 py-3.5 font-semibold text-slate-900">{creditNote.creditNoteNumber}</td>
                  <td className="px-5 py-3.5 text-slate-700">{formatDateTime(creditNote.createdAt)}</td>
                  <td className="px-5 py-3.5 text-slate-700">{creditNote.reason}</td>
                  <td className="px-5 py-3.5 text-right text-slate-700">{formatPrice(Number(creditNote.amountHT))}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-900">{formatPrice(Number(creditNote.amountTTC))}</td>
                  <td className="px-5 py-3.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      onClick={() => void handleDownload(creditNote)}
                      aria-label={`Télécharger l'avoir ${creditNote.creditNoteNumber}`}
                      data-testid={`button-download-credit-note-${creditNote.id}`}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PremiumTableShell>

      <Dialog
        open={open && canWrite}
        onOpenChange={(next) => {
          if (!next) resetForm();
          setOpen(canWrite ? next : false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Émettre un avoir</DialogTitle>
            <DialogDescription>
              L'avoir réduit le solde de la facture {invoice.invoiceNumber}. Il ne se modifie plus une fois émis : une
              erreur se corrige par un autre avoir.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="credit-note-amount">Montant HT (FCFA)</Label>
              <Input
                id="credit-note-amount"
                inputMode="decimal"
                value={amountHt}
                onChange={(e) => setAmountHt(e.target.value)}
                data-testid="input-credit-note-amount"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                <span>Maximum : {formatPrice(maxHt)} HT (solde {formatPrice(balance)} TTC)</span>
                <button
                  type="button"
                  className="font-medium text-primary-text hover:underline"
                  onClick={() => setAmountHt(maxHt.toFixed(2))}
                  data-testid="button-credit-note-max"
                >
                  Tout le solde
                </button>
              </div>
              {preview && (
                <p className={`mt-1 text-xs ${overBalance ? "text-destructive-text" : "text-gray-600"}`} data-testid="credit-note-preview">
                  TVA {invoice.vatRate}% : {formatPrice(preview.vatCents / 100)}, total TTC {formatPrice(preview.ttcCents / 100)}
                  {overBalance ? " : dépasse le solde restant." : ""}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="credit-note-reason">Motif</Label>
              <Textarea
                id="credit-note-reason"
                value={reason}
                maxLength={CREDIT_NOTE_REASON_MAX}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex. : remise commerciale, erreur de quantité facturée"
                data-testid="input-credit-note-reason"
              />
              <p className="mt-1 text-xs text-gray-500">
                {CREDIT_NOTE_REASON_MIN} à {CREDIT_NOTE_REASON_MAX} caractères, repris sur le PDF.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetForm();
              }}
            >
              Annuler
            </Button>
            <Button
              onClick={() =>
                submit({ invoiceId: invoice.id, amountHt: amountHt.trim().replace(",", "."), reason: reason.trim(), requestKey })
              }
              disabled={!amountValid || overBalance || !reasonValid || mutation.isPending}
              data-testid="button-confirm-credit-note"
            >
              {mutation.isPending ? "Émission…" : "Émettre l'avoir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
