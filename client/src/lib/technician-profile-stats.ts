import { queryView, type QueryStatus, type QueryView } from "@/lib/query-view";

/** OT tel que renvoyé par `GET /api/technician/my-work-orders` (champs lus par le profil). */
export interface TechnicianProfileWorkOrder {
  status: string;
  cost?: unknown;
  baseCost?: unknown;
  partsCost?: unknown;
  tiresCost?: unknown;
  /** Le serveur n'a pas pu calculer le coût : `cost` vaut null, jamais 0. */
  costUnavailable?: boolean;
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
  /** Totaux sur les OT terminés ; `null` dès qu'un de ces OT est sans coût (« Indisponible »). */
  totalCost: number | null;
  averageCost: number | null;
  partsCost: number | null;
  tiresCost: number | null;
  maintenanceCost: number | null;
}

/** Coût inconnu : signalé par le serveur, ou absent. Ne se somme jamais comme un 0. */
export function isWorkOrderCostUnknown(wo: TechnicianProfileWorkOrder): boolean {
  return wo.costUnavailable === true || wo.cost === null || wo.cost === undefined;
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

  // Une somme partielle présentée comme juste est un coût faux : tout passe à « Indisponible ».
  if (completed.some(isWorkOrderCostUnknown)) {
    return {
      workOrders,
      completed,
      inProgress,
      pending,
      totalCost: null,
      averageCost: null,
      partsCost: null,
      tiresCost: null,
      maintenanceCost: null,
    };
  }

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
  const view = technicianWorkOrdersView(query);
  if (view.kind !== "ready") return view;
  return { kind: "ready", data: technicianProfileStats(view.data.workOrders) };
}

/**
 * Vue de `GET /api/technician/my-work-orders` pour le tableau de bord et « Mes OT ».
 * Une requête en échec sans données, ou une réponse sans liste d'OT, donne `error` :
 * l'écran affiche un message et « Réessayer », jamais « aucun OT ».
 */
export function technicianWorkOrdersView<T = TechnicianProfileWorkOrder>(
  query: QueryStatus<unknown>,
): QueryView<{ workOrders: T[]; stats?: Record<string, number | undefined> }> {
  const view = queryView(query);
  if (view.kind !== "ready") return view;
  const data = view.data as { workOrders?: unknown; stats?: Record<string, number | undefined> } | null;
  if (!Array.isArray(data?.workOrders)) return { kind: "error", error: null, isRetrying: query.isFetching };
  return { kind: "ready", data: { workOrders: data.workOrders as T[], stats: data.stats } };
}

/** Coût d'un OT pour l'affichage : « Indisponible » si le serveur n'a pas pu le calculer. */
export function workOrderCostLabel(wo: TechnicianProfileWorkOrder, format: (amount: number) => string): string {
  return isWorkOrderCostUnknown(wo) ? UNAVAILABLE_LABEL : format(Number(wo.cost) || 0);
}

const UNAVAILABLE_LABEL = "Indisponible";
