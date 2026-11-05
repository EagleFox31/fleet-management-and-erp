import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarCheck, Wallet } from "lucide-react";
import { HeaderCard, PremiumDataTable, UrgencyBadge, type PremiumDataTableColumn } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { LoadingError } from "@/components/ui/loading-error";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useToast } from "@/hooks/use-toast";
import { userMessageOf } from "@/lib/api-error";
import { useContractQuery } from "@/lib/contract-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { satelliteTargetsOf } from "@/lib/realtime-satellites";
import { formatDate, formatPrice } from "@/lib/utils";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import { REALTIME_EVENTS } from "@shared/contracts/realtime-events";
import {
  INVOICES_AWAITING_PAYMENT_PATH,
  invoiceAwaitingPaymentSchema,
  invoicesAwaitingPaymentResponseSchema,
  type InvoiceAwaitingPayment,
  type InvoicesAwaitingPaymentResponse,
} from "@shared/contracts/invoices-awaiting-payment";

/** Seuils du compteur de jours depuis le dépôt (badge d'urgence). */
export const DEPOSIT_AGE_MEDIUM_DAYS = 30;
export const DEPOSIT_AGE_CRITICAL_DAYS = 60;

export function depositUrgency(days: number): "low" | "medium" | "critical" {
  if (days > DEPOSIT_AGE_CRITICAL_DAYS) return "critical";
  if (days > DEPOSIT_AGE_MEDIUM_DAYS) return "medium";
  return "low";
}

export const IS_BASE_LABELS: Record<InvoiceAwaitingPayment["withholdingIsBase"], string> = {
  ht: "IS sur HT",
  ttc: "IS sur TTC",
};

/** Couche 1 : remplace la ligne déposée dans la liste en cache et recalcule les totaux. */
export function withDepositedItem(
  data: InvoicesAwaitingPaymentResponse | undefined,
  item: InvoiceAwaitingPayment,
): InvoicesAwaitingPaymentResponse | undefined {
  if (!data) return data;
  const items = data.items.map((i) => (i.invoiceId === item.invoiceId ? item : i));
  const sum = (key: "amountHt" | "amountTtc" | "withholdingVatAmount" | "withholdingIsAmount" | "netPayable") =>
    items.reduce((total, i) => total + i[key], 0);
  return {
    items,
    totals: {
      count: items.length,
      amountHt: sum("amountHt"),
      amountTtc: sum("amountTtc"),
      withholdingVatAmount: sum("withholdingVatAmount"),
      withholdingIsAmount: sum("withholdingIsAmount"),
      netPayable: sum("netPayable"),
    },
  };
}

/** Couche 3 : mêmes cibles que l'événement temps réel (liste, factures client, satellites). */
export const DEPOSIT_INVALIDATED_KEYS: readonly string[] = Array.from(
  new Set([
    ...REALTIME_EVENTS.client_invoice_deposited.invalidates,
    ...satelliteTargetsOf("client_invoice_deposited").keys,
  ]),
);

/**
 * Factures en attente de paiement (F1c) : retenues à la source, net à payer, jours depuis le dépôt.
 * `readOnly` pour la direction (hors `FINANCE_RECEIVABLE_WRITE_ROLES`) : pas de colonne de dépôt.
 */
export function InvoicesAwaitingPaymentTable({ readOnly = false, now }: { readOnly?: boolean; now?: Date }) {
  const { toast } = useToast();
  const invoices = useContractQuery(INVOICES_AWAITING_PAYMENT_PATH, invoicesAwaitingPaymentResponseSchema);
  const today = isoDateInZone(now ?? new Date());
  const [depositing, setDepositing] = useState<InvoiceAwaitingPayment | null>(null);
  const [depositedAt, setDepositedAt] = useState(today);

  const mutation = useMutation({
    mutationFn: async ({ id, date }: { id: number; date: string }) =>
      invoiceAwaitingPaymentSchema.parse(
        await (await apiRequest("PATCH", `${INVOICES_AWAITING_PAYMENT_PATH}/${id}/deposit`, { depositedAt: date })).json(),
      ),
    onSuccess: (item) => {
      setDepositing(null);
      queryClient.setQueryData<InvoicesAwaitingPaymentResponse>([INVOICES_AWAITING_PAYMENT_PATH], (data) =>
        withDepositedItem(data, item),
      );
      for (const key of DEPOSIT_INVALIDATED_KEYS) void queryClient.invalidateQueries({ queryKey: [key] });
      toast({ title: "Dépôt enregistré", description: `Facture ${item.invoiceNumber}, retenues figées.` });
    },
    onError: (error) => toast({ title: "Dépôt non enregistré", description: userMessageOf(error), variant: "destructive" }),
  });
  const deposit = useSingleFlightMutate(mutation.mutate);

  const startDeposit = (row: InvoiceAwaitingPayment) => {
    setDepositing(row);
    setDepositedAt(today);
  };

  const columns: PremiumDataTableColumn<InvoiceAwaitingPayment>[] = [
    { id: "number", header: "Facture", cell: (r) => r.invoiceNumber },
    { id: "client", header: "Client", cell: (r) => r.clientName ?? <span className="text-muted-foreground">Client non renseigné</span> },
    { id: "ht", header: "HT", align: "right", cell: (r) => formatPrice(r.amountHt) },
    { id: "ttc", header: "TTC", align: "right", cell: (r) => formatPrice(r.amountTtc) },
    { id: "vat", header: "TVA retenue", align: "right", cell: (r) => formatPrice(r.withholdingVatAmount) },
    {
      id: "is",
      header: "IS retenu",
      align: "right",
      cell: (r) => (
        <div className="flex flex-col items-end gap-1">
          <span>{formatPrice(r.withholdingIsAmount)}</span>
          <span className="text-xs text-muted-foreground" data-testid={`is-base-${r.invoiceId}`}>{IS_BASE_LABELS[r.withholdingIsBase]}</span>
        </div>
      ),
    },
    {
      id: "net",
      header: "Net à payer",
      align: "right",
      cell: (r) => (
        <div className="flex flex-col items-end gap-1">
          <span className="font-medium">{formatPrice(r.netPayable)}</span>
          {!r.withholdingFrozen && <Badge variant="outline">Estimé</Badge>}
        </div>
      ),
    },
    { id: "deposited", header: "Déposée le", cell: (r) => (r.depositedAt ? formatDate(r.depositedAt) : "—") },
    {
      id: "days",
      header: "Jours",
      cell: (r) =>
        r.daysSinceDeposit === null ? (
          <span className="text-muted-foreground">Non déposée</span>
        ) : (
          <UrgencyBadge urgency={depositUrgency(r.daysSinceDeposit)} label={`${r.daysSinceDeposit} j`} />
        ),
    },
  ];
  if (!readOnly) {
    columns.push({
      id: "action",
      header: "",
      align: "right",
      cell: (r) =>
        r.depositedAt === null ? (
          <Button size="sm" variant="outline" onClick={() => startDeposit(r)} data-testid={`deposit-${r.invoiceId}`}>
            <CalendarCheck className="mr-1 h-4 w-4" aria-hidden="true" />
            Déposée le
          </Button>
        ) : null,
    });
  }

  const totals = invoices.data?.totals;

  return (
    <div className="space-y-4" data-testid="invoices-awaiting-payment">
      <HeaderCard moduleLabel="Finance" title="Factures en attente de paiement" icon={<Wallet className="h-5 w-5" />} />
      {invoices.isLoading || invoices.isError ? (
        <LoadingError isLoading={invoices.isLoading} error={invoices.error} onRetry={() => invoices.refetch()} />
      ) : (
        <>
          {totals && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="awaiting-payment-totals">
              {[
                ["Factures", String(totals.count)],
                ["Total TTC", formatPrice(totals.amountTtc)],
                ["Retenues", formatPrice(totals.withholdingVatAmount + totals.withholdingIsAmount)],
                ["Net à encaisser", formatPrice(totals.netPayable)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-card p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <PremiumDataTable
            columns={columns}
            rows={invoices.data?.items ?? []}
            rowKey={(r) => r.invoiceId}
            emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucune facture en attente de paiement.</p>}
          />
        </>
      )}

      <Dialog open={depositing !== null} onOpenChange={(isOpen) => !isOpen && setDepositing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dépôt de la facture {depositing?.invoiceNumber}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            À la date de dépôt, les retenues sont figées avec les taux actuels du client.
          </p>
          <Input
            type="date"
            value={depositedAt}
            max={today}
            onChange={(e) => setDepositedAt(e.target.value)}
            aria-label="Date de dépôt"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositing(null)}>Annuler</Button>
            <Button
              disabled={mutation.isPending || !depositedAt}
              onClick={() => depositing && deposit({ id: depositing.invoiceId, date: depositedAt })}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
