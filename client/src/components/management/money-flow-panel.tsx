import { ArrowDownCircle, ArrowUpCircle, MinusCircle } from "lucide-react";
import { CardShell, SectionLabel } from "@/components/design-system";
import { formatPrice } from "@/lib/utils";

type MoneyFlowPanelProps = {
  revenueTTC: number;
  collectedTTC: number;
  outstandingTTC: number;
  expensesTotal: number;
  grossHT: number;
  marginPercent: number;
  expenseBreakdown: {
    fuel: number;
    maintenance: number;
    suppliers: number;
  };
};

function BreakdownRow({ label, value, tone }: { label: string; value: number; tone?: "neutral" | "danger" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <span className={tone === "danger" ? "text-sm font-semibold text-red-600" : "text-sm font-semibold text-gray-900"}>
        {formatPrice(value)}
      </span>
    </div>
  );
}

export function MoneyFlowPanel({
  revenueTTC,
  collectedTTC,
  outstandingTTC,
  expensesTotal,
  grossHT,
  marginPercent,
  expenseBreakdown,
}: MoneyFlowPanelProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <CardShell>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <ArrowUpCircle className="h-4 w-4 text-emerald-600" />
            <SectionLabel>Argent entrant — CA facturé</SectionLabel>
          </div>
          <BreakdownRow label="Facturé (TTC)" value={revenueTTC} />
          <BreakdownRow label="Encaissé" value={collectedTTC} />
          <BreakdownRow label="Impayés" value={outstandingTTC} tone={outstandingTTC > 0 ? "danger" : "neutral"} />
        </div>
      </CardShell>

      <CardShell>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <ArrowDownCircle className="h-4 w-4 text-red-600" />
            <SectionLabel>Argent sortant — charges</SectionLabel>
          </div>
          <BreakdownRow label="Carburant" value={expenseBreakdown.fuel} tone="danger" />
          <BreakdownRow label="Maintenance atelier" value={expenseBreakdown.maintenance} tone="danger" />
          <BreakdownRow label="Achats fournisseurs" value={expenseBreakdown.suppliers} tone="danger" />
          <BreakdownRow label="Total charges" value={expensesTotal} tone="danger" />
        </div>
      </CardShell>

      <CardShell className="lg:col-span-2">
        <div className="px-5 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <MinusCircle className="h-4 w-4 text-blue-600" />
            <SectionLabel>Résultat brut après charges (HT)</SectionLabel>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-bold ${grossHT >= 0 ? "text-emerald-700" : "text-red-600"}`}>
              {formatPrice(grossHT)}
            </p>
            <p className="text-sm text-muted-foreground">
              Marge {marginPercent.toFixed(1)} % sur le CA HT facturé
            </p>
          </div>
        </div>
      </CardShell>
    </div>
  );
}
