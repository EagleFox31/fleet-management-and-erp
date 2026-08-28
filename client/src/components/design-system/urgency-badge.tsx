import React from "react";
import { cn } from "@/lib/utils";

const URGENCY_STYLE = {
  critical: {
    badge: "bg-red-100 text-red-700 border-red-200",
    border: "border-l-red-500",
    label: "Critique",
  },
  high: {
    badge: "bg-orange-100 text-orange-700 border-orange-200",
    border: "border-l-orange-400",
    label: "Haute",
  },
  medium: {
    badge: "bg-yellow-100 text-yellow-700 border-yellow-200",
    border: "border-l-yellow-400",
    label: "Moyenne",
  },
  low: {
    badge: "bg-gray-100 text-gray-500 border-gray-200",
    border: "border-l-gray-200",
    label: "Faible",
  },
} as const;

const URGENCY_ALIAS: Record<string, keyof typeof URGENCY_STYLE> = {
  normal: "medium",
};

const normalizeToken = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");

function normalizeUrgency(urgency: string): keyof typeof URGENCY_STYLE {
  const normalized = normalizeToken(urgency);
  const mapped = URGENCY_ALIAS[normalized] ?? normalized;

  if (mapped in URGENCY_STYLE) {
    return mapped as keyof typeof URGENCY_STYLE;
  }

  return "low";
}

export function getUrgencyBadgeClass(urgency: string) {
  return URGENCY_STYLE[normalizeUrgency(urgency)].badge;
}

export function getUrgencyBorderClass(urgency: string) {
  return URGENCY_STYLE[normalizeUrgency(urgency)].border;
}

interface UrgencyBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  urgency: string;
  label?: string;
}

export function UrgencyBadge({ urgency, label, className, ...props }: UrgencyBadgeProps) {
  const normalized = normalizeUrgency(urgency);
  const resolvedLabel = label ?? URGENCY_STYLE[normalized].label;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        URGENCY_STYLE[normalized].badge,
        className,
      )}
      {...props}
    >
      {resolvedLabel}
    </span>
  );
}
