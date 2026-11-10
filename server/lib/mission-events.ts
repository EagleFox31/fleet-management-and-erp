import { and, eq, notInArray } from "drizzle-orm";
import { assignments, drivers } from "@shared/schema";
import { VOID_ASSIGNMENT_STATUSES } from "@shared/constants/assignments";
import { MISSION_EVENT_ROLES } from "@shared/constants/roles";
import { db } from "../db";
import { moduleLogger } from "./logger";

const log = moduleLogger("missions");

/**
 * Comptes utilisateur des chauffeurs affectés à la mission (destinataires de la trame réduite).
 * Affectation annulée ou refusée exclue : le chauffeur retiré ne reçoit plus les trames de la mission
 * (son écran se resynchronise par polling sur des routes qui l'excluent déjà).
 */
async function assignedDriverUserIds(missionId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: drivers.userId })
    .from(assignments)
    .innerJoin(drivers, eq(assignments.driverId, drivers.id))
    .where(and(eq(assignments.missionId, missionId), notInArray(assignments.status, [...VOID_ASSIGNMENT_STATUSES])));
  return Array.from(new Set(rows.map((row) => row.userId).filter((id): id is number => typeof id === "number" && id > 0)));
}

/**
 * Cloison (AGENTS.md §11) : trame complète au personnel hors chauffeur, trame réduite à
 * l'identifiant de mission pour le chauffeur affecté (son écran se resynchronise par la route
 * qui le filtre déjà), rien pour un client. Diffusion au mieux : l'écriture est faite, un échec
 * d'envoi est journalisé sans faire échouer la requête.
 */
export async function emitMissionEvent(
  eventType: string,
  missionId: number | null,
  staffData: Record<string, unknown>,
  requestId?: string,
): Promise<void> {
  const broadcastUpdate = (global as any).broadcastUpdate;
  if (typeof broadcastUpdate !== "function") {
    return;
  }
  try {
    broadcastUpdate(eventType, { ...staffData, scope: { type: "roles", roles: [...MISSION_EVENT_ROLES] } });
    if (!missionId) return;
    const driverUserIds = await assignedDriverUserIds(missionId);
    if (driverUserIds.length === 0) return;
    broadcastUpdate(eventType, {
      entity: "mission",
      entityId: missionId,
      payload: { missionId },
      scope: { type: "user", userIds: driverUserIds },
    });
  } catch (error) {
    log.error({ err: error, requestId, eventType }, "diffusion temps réel d'un événement de mission");
  }
}
