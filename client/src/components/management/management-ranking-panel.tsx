import { CardShell, SectionLabel } from "@/components/design-system";
import { formatPrice } from "@/lib/utils";

type RankingItem = {
  label: string;
  primary: string;
  secondary?: string;
  amount?: number;
};

type ManagementRankingPanelProps = {
  title: string;
  emptyLabel: string;
  items: RankingItem[];
  amountLabel?: string;
};

export function ManagementRankingPanel({
  title,
  emptyLabel,
  items,
  amountLabel = "Montant",
}: ManagementRankingPanelProps) {
  const maxAmount = Math.max(...items.map((item) => item.amount ?? 0), 1);

  return (
    <CardShell>
      <div className="px-5 py-4 space-y-4">
        <SectionLabel>{title}</SectionLabel>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ol className="space-y-3">
            {items.map((item, index) => {
              const widthPercent =
                item.amount != null && item.amount > 0
                  ? Math.max((item.amount / maxAmount) * 100, 8)
                  : 0;

              return (
                <li key={`${item.label}-${index}`} className="space-y-1.5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        {index + 1}. {item.label}
                      </p>
                      {item.secondary ? (
                        <p className="text-xs text-muted-foreground">{item.secondary}</p>
                      ) : null}
                    </div>
                    {item.amount != null ? (
                      <span className="text-sm font-semibold text-emerald-700 whitespace-nowrap">
                        {formatPrice(item.amount)}
                      </span>
                    ) : (
                      <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                        {item.primary}
                      </span>
                    )}
                  </div>
                  {item.amount != null ? (
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-green-400"
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                  ) : null}
                  {item.amount != null && item.primary ? (
                    <p className="text-[11px] text-muted-foreground">
                      {amountLabel} : {item.primary}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </CardShell>
  );
}
