import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { KpiStatus } from "@/lib/kpi-status";

interface KPICardProps {
  title: string;
  value: string | number;
  subValue?: string;
  details?: string[];
  icon: string;
  trend?: {
    value: string;
    positive?: boolean;
  };
  iconColor?: string;
  status?: KpiStatus;
  statusLabel?: string;
  disableCriticalAnimation?: boolean;
  className?: string;
}

const STATUS_STYLES: Record<
  KpiStatus,
  {
    label: string;
    cardClass: string;
    chipClass: string;
    dotClass: string;
    iconBgClass: string;
  }
> = {
  success: {
    label: "OK",
    cardClass:
      "border-emerald-300/70 bg-emerald-50/50 dark:border-emerald-800/60 dark:bg-emerald-950/20",
    chipClass:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
    dotClass: "bg-emerald-500",
    iconBgClass: "bg-emerald-100 dark:bg-emerald-900/30",
  },
  warning: {
    label: "Vigilance",
    cardClass:
      "border-amber-300/80 bg-amber-50/50 dark:border-amber-800/60 dark:bg-amber-950/20",
    chipClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    dotClass: "bg-amber-500",
    iconBgClass: "bg-amber-100 dark:bg-amber-900/30",
  },
  critical: {
    label: "Urgent",
    cardClass: "border-red-300/80 bg-red-50/55 dark:border-red-800/70 dark:bg-red-950/30",
    chipClass: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200",
    dotClass: "bg-red-500",
    iconBgClass: "bg-red-100 dark:bg-red-900/40",
  },
  neutral: {
    label: "Info",
    cardClass: "",
    chipClass: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    dotClass: "bg-slate-400",
    iconBgClass: "bg-slate-100 dark:bg-slate-800/80",
  },
};

function parseDisplayNumber(value: string | number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  const sanitized = raw.replace(/[^\d,.\-]/g, "");
  if (!sanitized || sanitized === "-" || sanitized === "." || sanitized === ",") {
    return null;
  }

  const lastCommaIndex = sanitized.lastIndexOf(",");
  const lastDotIndex = sanitized.lastIndexOf(".");
  let normalized = sanitized;

  if (lastCommaIndex > lastDotIndex) {
    normalized = sanitized.replace(/\./g, "").replace(",", ".");
  } else if (lastDotIndex > lastCommaIndex) {
    normalized = sanitized.replace(/,/g, "");
  } else {
    normalized = sanitized.replace(/,/g, "");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function inferStatusFromIconColor(iconColor: string): KpiStatus {
  const normalized = iconColor.toLowerCase();

  if (normalized.includes("red") || normalized.includes("rose") || normalized.includes("destructive")) {
    return "critical";
  }

  if (
    normalized.includes("orange") ||
    normalized.includes("amber") ||
    normalized.includes("yellow") ||
    normalized.includes("warning")
  ) {
    return "warning";
  }

  if (normalized.includes("green") || normalized.includes("emerald")) {
    return "success";
  }

  return "neutral";
}

function inferStatus(title: string, subValue: string | undefined, value: string | number, iconColor: string): KpiStatus {
  const text = `${title} ${subValue ?? ""}`.toLowerCase();
  const numericValue = parseDisplayNumber(value);

  if (
    text.includes("alerte") ||
    text.includes("stock bas") ||
    text.includes("rupture") ||
    text.includes("hors service") ||
    text.includes("en retard") ||
    text.includes("non form") ||
    text.includes("à former") ||
    text.includes("a former")
  ) {
    if (typeof numericValue === "number") {
      return numericValue > 0 ? "critical" : "success";
    }
  }

  if (
    (text.includes("work order") || text.includes("ordre")) &&
    (text.includes("actif") || text.includes("en cours") || text.includes("assign"))
  ) {
    if (typeof numericValue === "number") {
      return numericValue > 0 ? "critical" : "success";
    }
  }

  if (text.includes("solde")) {
    if (typeof numericValue === "number") {
      if (numericValue <= 0) {
        return "critical";
      }
      if (numericValue < 50_000) {
        return "warning";
      }
      return "success";
    }
  }

  if (text.includes("disponibilit") || text.includes("conformit") || text.includes("marge")) {
    if (typeof numericValue === "number") {
      if (numericValue < 50) {
        return "critical";
      }
      if (numericValue < 75) {
        return "warning";
      }
      return "success";
    }
  }

  return inferStatusFromIconColor(iconColor);
}

export function KPICard({
  title,
  value,
  subValue,
  details,
  icon,
  trend,
  iconColor = "text-primary",
  status,
  statusLabel,
  disableCriticalAnimation = false,
  className,
}: KPICardProps) {
  const resolvedStatus = status ?? inferStatus(title, subValue, value, iconColor);
  const statusStyles = STATUS_STYLES[resolvedStatus];

  return (
    <Card
      className={cn(
        "border-l-4 transition-all duration-200",
        statusStyles.cardClass,
        resolvedStatus === "critical" && !disableCriticalAnimation && "kpi-critical-vibrate",
        className,
      )}
    >
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{title}</span>
          <div className="flex items-center gap-2">
            {trend && (
              <Badge variant={trend.positive ? "success" : "warning"} className="text-xs">
                {trend.value}
              </Badge>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wide",
                statusStyles.chipClass,
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", statusStyles.dotClass)} />
              {statusLabel ?? statusStyles.label}
            </span>
          </div>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <span className="text-2xl font-semibold text-foreground">{value}</span>
            {subValue && <span className="text-sm text-muted-foreground ml-2">{subValue}</span>}
          </div>
          <div className={cn("p-2 rounded-md", statusStyles.iconBgClass)}>
            <i className={cn(`fas fa-${icon}`, iconColor)}></i>
          </div>
        </div>
        {details && details.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {details.slice(0, 3).map((detail) => (
              <span
                key={detail}
                className="rounded-full border border-border/70 bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground"
              >
                {detail}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
