import React from "react";
import { cn } from "@/lib/utils";
import { CardShell } from "@/components/design-system/card-shell";

type StatusMetricTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_STYLES: Record<
  StatusMetricTone,
  { cell: string; accent: string; icon: string; value: string }
> = {
  neutral: {
    cell: "bg-slate-50/80",
    accent: "bg-slate-300",
    icon: "bg-white text-slate-500 ring-1 ring-slate-200",
    value: "text-slate-800",
  },
  info: {
    cell: "bg-blue-50/70",
    accent: "bg-blue-400",
    icon: "bg-white text-blue-600 ring-1 ring-blue-100",
    value: "text-blue-900",
  },
  success: {
    cell: "bg-emerald-50/70",
    accent: "bg-emerald-400",
    icon: "bg-white text-emerald-600 ring-1 ring-emerald-100",
    value: "text-emerald-900",
  },
  warning: {
    cell: "bg-amber-50/70",
    accent: "bg-amber-400",
    icon: "bg-white text-amber-600 ring-1 ring-amber-100",
    value: "text-amber-900",
  },
  danger: {
    cell: "bg-red-50/70",
    accent: "bg-red-500",
    icon: "bg-white text-red-600 ring-1 ring-red-100",
    value: "text-red-700",
  },
};

const GRID_COLUMNS_CLASS: Record<2 | 3 | 4, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
};

export interface StatusMetricItem {
  id: string;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  icon: React.ReactNode;
  tone?: StatusMetricTone;
  /** Conserve les data-testid historiques (ex. logistics-kpi-documents). */
  testId?: string;
}

interface StatusMetricStripProps {
  title?: string;
  subtitle?: string;
  items: StatusMetricItem[];
  /** Nombre de colonnes desktop — défaut : nombre d'items (max 4). */
  columns?: 2 | 3 | 4;
  className?: string;
}

export function StatusMetricStrip({
  title,
  subtitle,
  items,
  columns,
  className,
}: StatusMetricStripProps) {
  const columnCount = columns ?? (Math.min(items.length, 4) as 2 | 3 | 4);

  return (
    <CardShell topBar className={className}>
      {title ? (
        <div className="flex items-end justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{title}</p>
            {subtitle ? <p className="mt-0.5 text-[12px] text-gray-500">{subtitle}</p> : null}
          </div>
        </div>
      ) : null}

      <div className={cn("grid gap-px bg-gray-100/90", GRID_COLUMNS_CLASS[columnCount])}>
        {items.map((item) => {
          const tone = TONE_STYLES[item.tone ?? "neutral"];

          return (
            <div
              key={item.id}
              data-testid={item.testId ?? `status-metric-${item.id}`}
              className={cn("relative min-h-[108px] px-4 py-4 sm:px-5", tone.cell)}
            >
              <span
                aria-hidden
                className={cn("absolute left-0 top-4 bottom-4 w-1 rounded-r-full", tone.accent)}
              />

              <div className="flex items-start justify-between gap-3 pl-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    {item.label}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-[28px] font-black tabular-nums leading-none tracking-tight",
                      tone.value,
                    )}
                  >
                    {item.value}
                  </p>
                  {item.detail ? (
                    <div className="mt-2 text-[11px] leading-snug text-gray-600">{item.detail}</div>
                  ) : null}
                </div>

                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm",
                    tone.icon,
                  )}
                >
                  {item.icon}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}
