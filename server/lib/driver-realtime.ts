import { eq } from "drizzle-orm";
import { drivers } from "@shared/schema";
import { MISSION_EVENT_ROLES } from "@shared/constants/roles";
import { db } from "../db";
import { moduleLogger } from "./logger";

const log = moduleLogger("driver-realtime");

type DriverScope = { type: "roles"; roles: string[] } | { type: "user"; userIds: number[] };

/**
 * Portées d'une trame de fiche chauffeur : le personnel hors chauffeur (même modèle que les missions),
 * puis le chauffeur concerné seul par son compte. Jamais un client, jamais un autre chauffeur.
 */
export function driverEventScopes(driverUserId: number | null | undefined): DriverScope[] {
  const scopes: DriverScope[] = [{ type: "roles", roles: [...MISSION_EVENT_ROLES] }];
  if (typeof driverUserId === "number" && Number.isInteger(driverUserId) && driverUserId > 0) {
    scopes.push({ type: "user", userIds: [driverUserId] });
  }
  return scopes;
}

/** Compte lié à une fiche chauffeur (`drivers.user_id`), null si aucune ou en cas d'erreur de lecture. */
export async function driverUserIdOf(driverId: number): Promise<number | null> {
  try {
    const [row] = await db.select({ userId: drivers.userId }).from(drivers).where(eq(drivers.id, driverId)).limit(1);
    return row?.userId ?? null;
  } catch (err) {
    log.error({ err, driverId }, "compte du chauffeur illisible : trame limitée au personnel");
    return null;
  }
}
