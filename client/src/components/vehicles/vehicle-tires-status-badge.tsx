import { Badge } from "@/components/ui/badge";
import { CircleDot } from "lucide-react";
import { VEHICLE_TIRES_UNREGISTERED_LABEL } from "@/lib/vehicle-tires-status";
import { cn } from "@/lib/utils";

interface VehicleTiresStatusBadgeProps {
  className?: string;
  compact?: boolean;
}

export function VehicleTiresUnregisteredBadge({ className, compact }: VehicleTiresStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-amber-200 bg-amber-50 text-amber-800 font-medium whitespace-nowrap",
        compact ? "text-[10px] px-1.5 py-0" : "text-[11px]",
        className,
      )}
      title="Aucun montage de pneu enregistré par l'atelier"
    >
      {!compact && <CircleDot className="h-3 w-3 mr-1 shrink-0" />}
      {VEHICLE_TIRES_UNREGISTERED_LABEL}
    </Badge>
  );
}
