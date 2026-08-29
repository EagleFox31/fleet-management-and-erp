import { CardShell, SectionLabel } from "@/components/design-system";
import { formatPrice } from "@/lib/utils";
import { Award, Trophy } from "lucide-react";

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
  amountTone?: "profit" | "deficit";
};

export function ManagementRankingPanel({
  title,
  emptyLabel,
  items,
  amountLabel = "Montant",
  amountTone = "profit",
}: ManagementRankingPanelProps) {
  const maxAmount = Math.max(...items.map((item) => item.amount ?? 0), 1);

  return (
    <CardShell className="border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
          <SectionLabel>{title}</SectionLabel>
          <span className="text-[11px] font-semibold text-muted-foreground">
            Top {items.length}
          </span>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{emptyLabel}</p>
        ) : (
          <ol className="space-y-3">
            {items.map((item, index) => {
              const widthPercent =
                item.amount != null && item.amount > 0
                  ? Math.max((item.amount / maxAmount) * 100, 8)
                  : 0;

              const rankBadgeClass =
                index === 0
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                  : index === 1
                  ? "bg-slate-300/30 text-slate-700 dark:text-slate-300 border border-slate-400/30"
                  : index === 2
                  ? "bg-amber-700/15 text-amber-800 dark:text-amber-600 border border-amber-700/30"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

              return (
                <li
                  key={`${item.label}-${index}`}
                  className="space-y-1.5 p-2 rounded-lg transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-900/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 ${rankBadgeClass}`}
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {item.label}
                        </p>
                        {item.secondary ? (
                          <p className="text-xs text-muted-foreground truncate">{item.secondary}</p>
                        ) : null}
                      </div>
                    </div>

                    {item.amount != null ? (
                      <span
                        className={`text-sm font-bold tabular-nums shrink-0 ${
                          amountTone === "deficit"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-emerald-700 dark:text-emerald-400"
                        }`}
                      >
                        {formatPrice(item.amount)}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground shrink-0">
                        {item.primary}
                      </span>
                    )}
                  </div>

                  {item.amount != null ? (
                    <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          amountTone === "deficit"
                            ? "bg-gradient-to-r from-rose-500 to-amber-500"
                            : "bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-400"
                        }`}
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                  ) : null}

                  {item.amount != null && item.primary ? (
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                      <span>{amountLabel} : {item.primary}</span>
                      <span className="text-[10px] font-mono">{widthPercent.toFixed(0)}% du leader</span>
                    </div>
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
