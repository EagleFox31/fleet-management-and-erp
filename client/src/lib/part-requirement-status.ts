import {
  AlertTriangle,
  CheckCircle,
  CheckSquare,
  Clock,
  LogOut,
  Package,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { getPartRequirementStatusLabel } from "@shared/constants/part-requirements";

export interface PartRequirementStatusConfig {
  label: string;
  color: string;
  icon: LucideIcon;
}

export function getPartRequirementStatusConfig(
  status: string,
): PartRequirementStatusConfig {
  const label = getPartRequirementStatusLabel(status);
  const configs: Record<string, Omit<PartRequirementStatusConfig, "label">> = {
    pending: { color: "bg-yellow-100 text-yellow-800", icon: Clock },
    approved: { color: "bg-blue-100 text-blue-800", icon: CheckCircle },
    rejected: { color: "bg-red-100 text-red-800", icon: XCircle },
    ordered: { color: "bg-purple-100 text-purple-800", icon: Package },
    partially_received: { color: "bg-orange-100 text-orange-800", icon: Truck },
    received: { color: "bg-sky-100 text-sky-800 ring-2 ring-sky-400", icon: CheckCircle },
    issued: { color: "bg-teal-100 text-teal-800", icon: LogOut },
    fulfilled: { color: "bg-slate-100 text-slate-700", icon: CheckSquare },
    cancel_requested: { color: "bg-amber-100 text-amber-800", icon: AlertTriangle },
    cancelled: { color: "bg-red-100 text-red-800", icon: XCircle },
    partial: { color: "bg-orange-100 text-orange-800 opacity-75", icon: Truck },
    delivered: { color: "bg-stone-100 text-stone-600 opacity-75 italic", icon: Package },
  };
  const config = configs[status] ?? { color: "bg-gray-100 text-gray-700", icon: Clock };
  return { label, ...config };
}

export function getRequirementUrgencyBorderColor(urgency: string) {
  switch (urgency) {
    case "critical":
      return "ring-red-400";
    case "high":
      return "ring-orange-400";
    case "medium":
      return "ring-yellow-400";
    default:
      return "ring-gray-200";
  }
}
