import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Percent } from "lucide-react";
import { HeaderCard, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingError } from "@/components/ui/loading-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContractQuery } from "@/lib/contract-query";
import { formatDate, formatPrice } from "@/lib/utils";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import {
  FINANCE_WITHHOLDINGS_PATH,
  financeWithholdingsResponseSchema,
  type FinanceWithholdingLine,
  type FinanceWithholdingsResponse,
} from "@shared/contracts/finance-withholdings";

const ALL_CLIENTS = "all";

/** Mois en cours, comme le serveur sans paramètre : du premier du mois à aujourd'hui (Africa/Douala). */
export function defaultWithholdingsPeriod(now: Date = new Date()): { from: string; to: string } {
  const to = isoDateInZone(now);
  return { from: `${to.slice(0, 8)}01`, to };
}

/** Une période est interrogeable quand les deux bornes sont saisies et ordonnées. */
export function isValidWithholdingsPeriod(from: string, to: string): boolean {
  return Boolean(from) && Boolean(to) && from <= to;
}

type ClientRow = FinanceWithholdingsResponse["byClient"][number];

const clientUnknown = () => <span className="text-muted-foreground">Client non renseigné</span>;

const lineColumns: PremiumDataTableColumn<FinanceWithholdingLine>[] = [
  { id: "number", header: "Facture", cell: (r) => r.invoiceNumber },
  { id: "client", header: "Client", cell: (r) => r.clientName ?? clientUnknown() },
  { id: "deposited", header: "Déposée le", cell: (r) => formatDate(r.depositedAt) },
  { id: "ht", header: "HT", align: "right", cell: (r) => formatPrice(r.amountHt) },
  { id: "ttc", header: "TTC", align: "right", cell: (r) => formatPrice(r.amountTtc) },
  { id: "vat", header: "TVA retenue", align: "right", cell: (r) => formatPrice(r.withholdingVatAmount) },
  { id: "is", header: "IS retenu", align: "right", cell: (r) => formatPrice(r.withholdingIsAmount) },
  { id: "net", header: "Net à payer", align: "right", cell: (r) => <span className="font-medium">{formatPrice(r.netPayable)}</span> },
];

const clientColumns: PremiumDataTableColumn<ClientRow>[] = [
  { id: "client", header: "Client", cell: (r) => r.clientName ?? clientUnknown() },
  { id: "count", header: "Factures", align: "right", cell: (r) => String(r.count) },
  { id: "ht", header: "HT", align: "right", cell: (r) => formatPrice(r.amountHt) },
  { id: "ttc", header: "TTC", align: "right", cell: (r) => formatPrice(r.amountTtc) },
  { id: "vat", header: "TVA retenue", align: "right", cell: (r) => formatPrice(r.withholdingVatAmount) },
  { id: "is", header: "IS retenu", align: "right", cell: (r) => formatPrice(r.withholdingIsAmount) },
  { id: "net", header: "Net à payer", align: "right", cell: (r) => <span className="font-medium">{formatPrice(r.netPayable)}</span> },
];

/**
 * Retenues à la source subies sur une période (lecture seule) : totaux, récapitulatif par client,
 * détail par facture. Montants figés au dépôt de la facture ; aucune action pour aucun rôle.
 */
export function WithholdingsSummary({ now }: { now?: Date }) {
  const initial = defaultWithholdingsPeriod(now);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [clientId, setClientId] = useState(ALL_CLIENTS);

  const periodOk = isValidWithholdingsPeriod(from, to);
  const clients = useQuery<{ id: number; name: string }[]>({ queryKey: ["/api/clients"] });
  const summary = useContractQuery(
    FINANCE_WITHHOLDINGS_PATH,
    financeWithholdingsResponseSchema,
    { from, to, clientId: clientId === ALL_CLIENTS ? undefined : clientId },
    { enabled: periodOk },
  );

  const totals = summary.data?.totals;

  return (
    <div className="space-y-4" data-testid="withholdings-summary">
      <HeaderCard moduleLabel="Finance" title="Retenues à la source" icon={<Percent className="h-5 w-5" />} />

      <div className="flex flex-wrap items-end gap-3" data-testid="withholdings-filters">
        <div className="space-y-1">
          <Label htmlFor="withholdings-from">Du</Label>
          <Input id="withholdings-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="withholdings-to">Au</Label>
          <Input id="withholdings-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="withholdings-client">Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="withholdings-client" className="w-56" data-testid="withholdings-client">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CLIENTS}>Tous les clients</SelectItem>
              {(clients.data ?? []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-sm text-muted-foreground" data-testid="withholdings-help">
        Factures retenues selon leur date de dépôt chez le client. Les totaux peuvent différer du rapport de facturation et du relevé client, qui suivent la date de facture.
      </p>

      {!periodOk ? (
        <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground" role="alert" data-testid="withholdings-period-error">
          Choisissez une période dont la date de début précède la date de fin.
        </p>
      ) : summary.isLoading || summary.isError ? (
        <LoadingError isLoading={summary.isLoading} error={summary.error} onRetry={() => summary.refetch()} />
      ) : (
        <>
          {totals && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="withholdings-totals">
              {[
                ["Factures", String(totals.count)],
                ["Total HT", formatPrice(totals.amountHt)],
                ["Total TTC", formatPrice(totals.amountTtc)],
                ["TVA retenue", formatPrice(totals.withholdingVatAmount)],
                ["IS retenu", formatPrice(totals.withholdingIsAmount)],
                ["Net à payer", formatPrice(totals.netPayable)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border bg-card p-3">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-lg font-semibold text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          )}

          <section className="space-y-2" aria-labelledby="withholdings-by-client">
            <h2 id="withholdings-by-client" className="text-sm font-semibold text-foreground">Par client</h2>
            <PremiumDataTable
              columns={clientColumns}
              rows={summary.data?.byClient ?? []}
              rowKey={(r) => r.clientId ?? "none"}
              emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucune retenue sur cette période.</p>}
            />
          </section>

          <section className="space-y-2" aria-labelledby="withholdings-detail">
            <h2 id="withholdings-detail" className="text-sm font-semibold text-foreground">Détail par facture</h2>
            <PremiumDataTable
              columns={lineColumns}
              rows={summary.data?.items ?? []}
              rowKey={(r) => r.invoiceId}
              emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucune facture déposée sur cette période.</p>}
            />
          </section>
        </>
      )}
    </div>
  );
}
