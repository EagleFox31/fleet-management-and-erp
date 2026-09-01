import { queryClient } from "@/lib/queryClient";

/** Même clé que le dashboard technicien — source unique côté session. */
export const TECHNICIAN_MY_WORK_ORDERS_KEY = ["/api/technician/my-work-orders"] as const;

export function technicianWorkOrdersByUserKey(userId: number) {
  return ["/api/technician/work-orders", userId] as const;
}

/** Invalide les deux caches technicien (my-work-orders + legacy par userId). */
export function invalidateTechnicianWorkOrderQueries(userId?: number) {
  queryClient.invalidateQueries({ queryKey: TECHNICIAN_MY_WORK_ORDERS_KEY });
  if (userId != null) {
    queryClient.invalidateQueries({ queryKey: technicianWorkOrdersByUserKey(userId) });
  }
}
