import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { canReceiveWorkOrder } from "@shared/constants/roles";
import { db } from "../db";
import { AppError } from "../lib/app-error";

export const WORK_ORDER_ASSIGNEE_ERROR = "Un ordre de travail s'affecte à un technicien ou à un chef d'atelier.";

/**
 * Refuse (400) une affectation d'OT à un utilisateur hors de l'atelier ou inexistant.
 * `null` ou absent (désaffectation, OT sans technicien) passe.
 */
export async function assertWorkOrderAssignee(technicianId: unknown): Promise<void> {
  if (technicianId === undefined || technicianId === null || technicianId === "") return;
  const id = Number(technicianId);
  const [assignee] = Number.isInteger(id) && id > 0
    ? await db.select({ role: users.role }).from(users).where(eq(users.id, id))
    : [];
  if (!assignee || !canReceiveWorkOrder(assignee.role)) {
    throw new AppError(400, WORK_ORDER_ASSIGNEE_ERROR, {
      fieldErrors: [{ field: "technicianId", message: WORK_ORDER_ASSIGNEE_ERROR }],
      cause: `technicianId ${String(technicianId)} : ${assignee?.role ?? "introuvable"}`,
    });
  }
}
