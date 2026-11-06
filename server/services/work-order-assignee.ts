import { and, eq, isNull } from "drizzle-orm";
import { users } from "@shared/schema";
import { canReceiveWorkOrder } from "@shared/constants/roles";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { MAX_DB_INTEGER_ID } from "../lib/route-id";

export const WORK_ORDER_ASSIGNEE_ERROR = "Un ordre de travail s'affecte à un technicien ou à un chef d'atelier.";

/**
 * Refuse (400) une affectation d'OT à un utilisateur hors de l'atelier, supprimé ou inexistant
 * (mêmes critères que le sélecteur `GET /api/users/technicians`). `null` ou absent
 * (désaffectation, OT sans technicien) passe. Un id hors de la plage `integer` est refusé
 * avant la requête, qui échouerait en base.
 */
export async function assertWorkOrderAssignee(technicianId: unknown): Promise<void> {
  if (technicianId === undefined || technicianId === null || technicianId === "") return;
  const id = Number(technicianId);
  const [assignee] = Number.isInteger(id) && id > 0 && id <= MAX_DB_INTEGER_ID
    ? await db.select({ role: users.role }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt)))
    : [];
  if (!assignee || !canReceiveWorkOrder(assignee.role)) {
    throw new AppError(400, WORK_ORDER_ASSIGNEE_ERROR, {
      fieldErrors: [{ field: "technicianId", message: WORK_ORDER_ASSIGNEE_ERROR }],
      cause: `technicianId ${String(technicianId)} : ${assignee?.role ?? "introuvable"}`,
    });
  }
}
