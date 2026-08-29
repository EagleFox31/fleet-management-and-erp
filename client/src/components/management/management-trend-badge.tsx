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
  if (percent == null) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
        Nouveau
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
