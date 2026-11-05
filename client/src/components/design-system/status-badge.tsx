import React from "react";
import { cn } from "@/lib/utils";

const STATUS_STYLE = {
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  draft: "bg-yellow-100 text-yellow-700 border-yellow-200",
  approved: "bg-blue-100 text-blue-700 border-blue-200",
  confirmed: "bg-blue-100 text-blue-700 border-blue-200",
  ordered: "bg-purple-100 text-purple-700 border-purple-200",
  sent: "bg-purple-100 text-purple-700 border-purple-200",
  received: "bg-sky-100 text-sky-700 border-sky-200",
  delivered: "bg-sky-100 text-sky-700 border-sky-200",
  issued: "bg-teal-100 text-teal-700 border-teal-200",
  fulfilled: "bg-teal-100 text-teal-700 border-teal-200",
  paid: "bg-success/15 text-success border-success/30",
  closed: "bg-success/15 text-success border-success/30",
  completed: "bg-success/15 text-success border-success/30",
  cancelled: "bg-destructive/10 text-destructive-text border-destructive/30",
  canceled: "bg-destructive/10 text-destructive-text border-destructive/30",
  rejected: "bg-destructive/10 text-destructive-text border-destructive/30",
  partial: "bg-orange-100 text-orange-700 border-orange-200",
  disputed: "bg-warning/15 text-warning-text border-warning/40",
} as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "En attente",
  draft: "Brouillon",
  approved: "Approuvee",
  confirmed: "Confirmee",
  ordered: "Commandee",
  sent: "Envoyee",
  received: "Recue",
  delivered: "Livree",
  issued: "Emise",
  fulfilled: "Traitee",
  paid: "Payee",
  closed: "Cloturee",
  completed: "Terminee",
  cancelled: "Annulee",
  canceled: "Annulee",
  rejected: "Rejetee",
  partial: "Partielle",
  disputed: "Contestee",
};

const STATUS_ALIAS: Record<string, keyof typeof STATUS_STYLE> = {
  awaiting_parts: "pending",
  in_progress: "confirmed",
  done: "completed",
};

const normalizeToken = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");

export function getStatusBadgeClass(status: string) {
  const normalized = normalizeToken(status);
  const mapped = STATUS_ALIAS[normalized] ?? normalized;

  if (mapped in STATUS_STYLE) {
    return STATUS_STYLE[mapped as keyof typeof STATUS_STYLE];
  }

  return "bg-gray-100 text-gray-600 border-gray-200";
}

interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: string;
  label?: string;
}

export function StatusBadge({ status, label, className, ...props }: StatusBadgeProps) {
  const normalized = normalizeToken(status);
  const mapped = STATUS_ALIAS[normalized] ?? normalized;
  const resolvedLabel = label ?? STATUS_LABEL[mapped] ?? status;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        getStatusBadgeClass(mapped),
        className,
      )}
      {...props}
    >
      {resolvedLabel}
    </span>
  );
}
