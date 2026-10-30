import { Receipt } from "lucide-react";
import { HeaderCard, PremiumDataTable, UrgencyBadge, type PremiumDataTableColumn } from "@/components/design-system";
import { useContractQuery } from "@/lib/contract-query";
import { formatDate, formatPrice } from "@/lib/utils";
import {
  PENDING_INVOICES_PATH,
  pendingInvoicesResponseSchema,
  type PendingInvoice,
} from "@shared/contracts/pending-invoices";

const DAY_MS = 86_400_000;

/** Âge en jours pleins de la plus ancienne opération, à une date de référence donnée. */
export function ageInDays(oldestOperationDate: string, now: Date = new Date()): number {
  const start = Date.parse(`${oldestOperationDate}T00:00:00Z`);
  return Math.max(0, Math.floor((now.getTime() - start) / DAY_MS));
}

/** `missions` ne porte aucun tarif : le serveur renvoie 0, l'écran affiche « À chiffrer ». */
export const TO_QUOTE_LABEL = "À chiffrer";
export function isToQuote(amount: number): boolean {
  return amount === 0;
}

export function sortByAgeDesc(rows: readonly PendingInvoice[]): PendingInvoice[] {
  return [...rows].sort((a, b) => a.oldestOperationDate.localeCompare(b.oldestOperationDate));
}

function urgencyOf(days: number): string {
  if (days > 30) return "critical";
  if (days > 15) return "medium";
  return "low";
}

/** Factures en attente, triées par âge (T-54a). */
export function PendingInvoicesTable({ now }: { now?: Date }) {
  const invoices = useContractQuery(PENDING_INVOICES_PATH, pendingInvoicesResponseSchema);

  const columns: PremiumDataTableColumn<PendingInvoice>[] = [
    { id: "client", header: "Client", cell: (r) => r.clientName },
    { id: "ops", header: "Opérations", align: "right", cell: (r) => r.operationCount },
    { id: "amount", header: "Montant", align: "right", cell: (r) =>
        isToQuote(r.amount) ? (
          <span className="text-muted-foreground" data-testid="amount-to-quote">{TO_QUOTE_LABEL}</span>
        ) : (
          formatPrice(r.amount)
        ),
    },
    { id: "oldest", header: "Plus ancienne", cell: (r) => formatDate(r.oldestOperationDate) },
    {
      id: "age",
      header: "Âge",
      cell: (r) => {
        const days = ageInDays(r.oldestOperationDate, now);
        return <UrgencyBadge urgency={urgencyOf(days)} label={`${days} j`} />;
      },
    },
  ];

  return (
    <div className="space-y-4" data-testid="pending-invoices">
      <HeaderCard moduleLabel="Facturation" title="Factures en attente" icon={<Receipt className="h-5 w-5" />} />
      <PremiumDataTable
        columns={columns}
        rows={sortByAgeDesc(invoices.data ?? [])}
        rowKey={(r) => r.clientId}
        emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucune facture en attente.</p>}
      />
    </div>
  );
}
