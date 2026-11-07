import { queryView, type QueryStatus, type QueryView } from "@/lib/query-view";

/** OT tel que renvoyé par `GET /api/technician/my-work-orders` (champs lus par le profil). */
export interface TechnicianProfileWorkOrder {
  status: string;
  cost?: unknown;
  baseCost?: unknown;
  partsCost?: unknown;
  tiresCost?: unknown;
  createdAt?: string | Date;
  updatedAt?: string | Date | null;
  endDate?: string | Date | null;
  [key: string]: unknown;
}

export interface TechnicianProfileStats {
  workOrders: TechnicianProfileWorkOrder[];
  completed: TechnicianProfileWorkOrder[];
  inProgress: TechnicianProfileWorkOrder[];
  pending: TechnicianProfileWorkOrder[];
  totalCost: number;
  averageCost: number;
  partsCost: number;
  tiresCost: number;
  maintenanceCost: number;
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const sumOf = (orders: TechnicianProfileWorkOrder[], field: keyof TechnicianProfileWorkOrder) =>
  orders.reduce((sum, wo) => sum + toNumber(wo[field]), 0);

/** Coûts du profil technicien, calculés sur les OT terminés. */
export function technicianProfileStats(workOrders: TechnicianProfileWorkOrder[]): TechnicianProfileStats {
  const completed = workOrders.filter((wo) => wo.status === "completed");
  const inProgress = workOrders.filter((wo) => wo.status === "in_progress");
  const pending = workOrders.filter((wo) => wo.status === "pending");

  const totalCost = sumOf(completed, "cost");
  const partsCost = sumOf(completed, "partsCost");
  const tiresCost = sumOf(completed, "tiresCost");
  let maintenanceCost = sumOf(completed, "baseCost");
  if (maintenanceCost + partsCost + tiresCost === 0 && totalCost > 0) {
    maintenanceCost = totalCost;
  }

  return {
    workOrders,
    completed,
    inProgress,
    pending,
    totalCost,
    averageCost: completed.length > 0 ? totalCost / completed.length : 0,
    partsCost,
    tiresCost,
    maintenanceCost,
  };
}

/**
 * Vue du profil technicien. Une requête en échec sans données, ou une réponse sans liste d'OT,
 * donne `error` : le profil affiche « Indisponible » et « Réessayer », jamais des coûts à 0
 * (le service lève une AppError 500 quand le calcul du coût échoue).
 */
export function technicianProfileView(
  query: QueryStatus<unknown>,
): QueryView<TechnicianProfileStats> {
  const view = queryView(query);
  if (view.kind !== "ready") return view;
  const workOrders = (view.data as { workOrders?: unknown } | null)?.workOrders;
  if (!Array.isArray(workOrders)) return { kind: "error", error: null, isRetrying: query.isFetching };
  return { kind: "ready", data: technicianProfileStats(workOrders as TechnicianProfileWorkOrder[]) };
}
