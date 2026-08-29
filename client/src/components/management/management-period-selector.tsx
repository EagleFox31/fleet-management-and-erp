import { cn } from "@/lib/utils";
import {
  MANAGEMENT_PERIOD_LABELS,
  MANAGEMENT_PERIODS,
  type ManagementPeriod,
} from "@shared/constants/management-dashboard";

type ManagementPeriodSelectorProps = {
  value: ManagementPeriod;
  onChange: (period: ManagementPeriod) => void;
  className?: string;
};

export function ManagementPeriodSelector({
  value,
  onChange,
  className,
}: ManagementPeriodSelectorProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {MANAGEMENT_PERIODS.map((period) => (
        <button
          key={period}
          type="button"
          onClick={() => onChange(period)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
            value === period
              ? "bg-emerald-700 text-white shadow-sm"
              : "bg-white/80 text-emerald-900 ring-1 ring-emerald-200 hover:bg-emerald-50",
          )}
        >
          {MANAGEMENT_PERIOD_LABELS[period]}
        </button>
      ))}
    </div>
  );
}
