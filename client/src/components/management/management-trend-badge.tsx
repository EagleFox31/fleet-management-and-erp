import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

type ManagementTrendBadgeProps = {
  percent: number | null;
  /** Pour les charges, une baisse est positive. */
  higherIsBetter?: boolean;
  className?: string;
};

export function ManagementTrendBadge({
  percent,
  higherIsBetter = true,
  className,
}: ManagementTrendBadgeProps) {
  // `percent` est null dans un seul cas: la période N-1 valait zéro, donc la
  // variation n'est pas calculable. Le dire tel quel — « Nouveau » laissait
  // croire que l'indicateur était récent, alors que c'est l'activité qui part
  // de zéro, ce qui est une information forte et pas un état d'attente.
  if (percent == null) {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums", className)}
        title="Période précédente à zéro : variation non calculable"
      >
        N-1 : 0
      </span>
    );
  }

  const absValue = Math.abs(percent);
  if (absValue < 0.05) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
        <Minus className="h-3 w-3" />
        Stable
      </span>
    );
  }

  const improved = higherIsBetter ? percent > 0 : percent < 0;
  const Icon = improved ? TrendingUp : TrendingDown;
  const tone = improved ? "text-emerald-700" : "text-red-600";

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", tone, className)}>
      <Icon className="h-3 w-3" />
      {percent > 0 ? "+" : ""}
      {percent.toFixed(1)} %
    </span>
  );
}
