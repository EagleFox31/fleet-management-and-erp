import { useState } from "react";
import { CircleDot } from "lucide-react";
import { HeaderCard, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { Input } from "@/components/ui/input";
import { useContractQuery } from "@/lib/contract-query";
import { formatDate } from "@/lib/utils";
import {
  TIRE_MOVEMENTS_PATH,
  tireMovementsResponseSchema,
  type TireMovement,
  type TireMovementKind,
} from "@shared/contracts/tire-movements";

export const TIRE_MOVEMENT_LABELS: Record<TireMovementKind, string> = {
  installed: "Montage",
  removed: "Démontage",
  rotated: "Rotation",
  inspected: "Inspection",
};

/** Journal des mouvements de pneus, lecture seule (T-52). */
export function TireMovementsTable() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const movements = useContractQuery(TIRE_MOVEMENTS_PATH, tireMovementsResponseSchema, {
    from: from || undefined,
    to: to || undefined,
  });

  const columns: PremiumDataTableColumn<TireMovement>[] = [
    { id: "at", header: "Date", cell: (m) => formatDate(m.at) },
    { id: "kind", header: "Mouvement", cell: (m) => TIRE_MOVEMENT_LABELS[m.kind] },
    { id: "tire", header: "Pneu", cell: (m) => m.tireLabel },
    { id: "vehicle", header: "Véhicule", cell: (m) => m.vehicleLabel ?? "—" },
    { id: "position", header: "Position", cell: (m) => m.position ?? "—" },
    { id: "mileage", header: "Kilométrage", align: "right", cell: (m) => (m.mileage == null ? "—" : `${m.mileage.toLocaleString("fr-FR")} km`) },
    { id: "by", header: "Par", cell: (m) => m.byUserName ?? "—" },
  ];

  return (
    <div className="space-y-4" data-testid="tire-movements">
      <HeaderCard moduleLabel="Stock" title="Mouvements de pneus" icon={<CircleDot className="h-5 w-5" />} />
      <PremiumDataTable
        columns={columns}
        rows={movements.data ?? []}
        rowKey={(m, index) => `${m.tireId}-${m.at}-${m.kind}-${index}`}
        toolbar={
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <label className="text-xs text-muted-foreground" htmlFor="tire-mv-from">Du</label>
            <Input id="tire-mv-from" type="date" className="h-8 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
            <label className="text-xs text-muted-foreground" htmlFor="tire-mv-to">Au</label>
            <Input id="tire-mv-to" type="date" className="h-8 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        }
        emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucun mouvement sur la période.</p>}
      />
    </div>
  );
}
