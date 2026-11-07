import type { QueryView } from "@/lib/query-view";

/**
 * Montage d'un pneu : on ne propose une position que si l'on sait lesquelles sont occupées.
 * Tant que `/api/vehicle-tires` n'a pas répondu (chargement ou erreur), les positions sont
 * inconnues et le montage est bloqué : une liste vide passerait pour « tout est libre ».
 */
export interface VehicleTirePositionRow {
  vehicleId: number;
  position: string;
  status?: string;
}

export function occupiedPositionsView(args: {
  /** Véhicule imposé par l'appelant, qui fournit lui-même les positions occupées. */
  locked: boolean;
  lockedOccupied: string[];
  vehicleId: number;
  vehicleTires: QueryView<VehicleTirePositionRow[]>;
}): QueryView<string[]> {
  if (args.locked) return { kind: "ready", data: args.lockedOccupied };
  if (args.vehicleTires.kind !== "ready") return args.vehicleTires;
  return {
    kind: "ready",
    data: args.vehicleTires.data
      .filter((row) => row.vehicleId === args.vehicleId && (row.status === undefined || row.status === "active"))
      .map((row) => row.position),
  };
}

export type MountBlock =
  | "pending"
  | "no-vehicle"
  | "positions-unknown"
  | "no-free-position"
  | "no-position"
  | "catalog-unknown"
  | "no-tire-in-stock"
  | "no-tire";

/** Raison pour laquelle « Valider le montage » est désactivé, ou `null` si le montage est possible. */
export function mountBlock(state: {
  isPending: boolean;
  vehicleId: number;
  position: string;
  tireId: string;
  occupied: QueryView<string[]>;
  freePositionsCount: number;
  catalog: QueryView<unknown>;
  availableTiresCount: number;
}): MountBlock | null {
  if (state.isPending) return "pending";
  if (!state.vehicleId) return "no-vehicle";
  if (state.occupied.kind !== "ready") return "positions-unknown";
  if (state.freePositionsCount === 0) return "no-free-position";
  if (!state.position) return "no-position";
  if (state.catalog.kind !== "ready") return "catalog-unknown";
  if (state.availableTiresCount === 0) return "no-tire-in-stock";
  if (!state.tireId) return "no-tire";
  return null;
}
