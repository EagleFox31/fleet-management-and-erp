import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { assignments, missions } from "@shared/schema";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@shared/constants/assignments";
import type { db } from "../db";

/**
 * Conflit de planning : un chauffeur ou un véhicule ne peut pas porter deux missions actives qui se
 * chevauchent. Règle unique, partagée par la création, le PATCH, l'ajout d'affectation, le lancement
 * et l'import (elle existait en trois copies).
 */
export const ACTIVE_MISSION_STATUSES: string[] = ["planned", "assigned", "in_progress"];

type Executor = Pick<typeof db, "select" | "execute">;
type DateLike = Date | string | null | undefined;

/** Bornes incluses : deux missions qui se touchent (fin A = début B) sont en conflit. */
export function overlaps(startA: DateLike, endA: DateLike, startB: DateLike, endB: DateLike): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  const sA = new Date(startA).getTime();
  const eA = new Date(endA).getTime();
  const sB = new Date(startB).getTime();
  const eB = new Date(endB).getTime();
  if ([sA, eA, sB, eB].some((v) => Number.isNaN(v))) return false;
  return sA <= eB && eA >= sB;
}

export type PlanningClash = { orderNumber: string; kind: "driver" | "vehicle"; missionId: number };

export type PlanningClashQuery = {
  /** Mission examinée, exclue de la recherche (null à la création). */
  missionId: number | null;
  pickupDate: DateLike;
  deliveryDate: DateLike;
  vehicleId: number;
  driverId: number;
};

/** Première mission active qui chevauche le créneau sur ce chauffeur ou ce véhicule, sinon null. */
export async function findPlanningClash(executor: Executor, query: PlanningClashQuery): Promise<PlanningClash | null> {
  if (!query.pickupDate || !query.deliveryDate) return null;
  const candidates = await executor
    .select({
      missionId: missions.id,
      orderNumber: missions.orderNumber,
      pickupDate: missions.pickupDate,
      deliveryDate: missions.deliveryDate,
      vehicleId: assignments.vehicleId,
      driverId: assignments.driverId,
    })
    .from(assignments)
    .innerJoin(missions, eq(assignments.missionId, missions.id))
    .where(
      and(
        query.missionId === null ? undefined : ne(assignments.missionId, query.missionId),
        inArray(missions.status, ACTIVE_MISSION_STATUSES as any),
        inArray(assignments.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
        or(eq(assignments.vehicleId, query.vehicleId), eq(assignments.driverId, query.driverId)),
      ),
    );
  const clash = candidates.find((c) => overlaps(query.pickupDate, query.deliveryDate, c.pickupDate, c.deliveryDate));
  if (!clash) return null;
  return {
    orderNumber: clash.orderNumber,
    missionId: clash.missionId,
    kind: clash.driverId === query.driverId ? "driver" : "vehicle",
  };
}

export function planningClashMessage(clash: PlanningClash): string {
  const what = clash.kind === "driver" ? "Ce chauffeur" : "Ce véhicule";
  return `Conflit de planning : ${what} est déjà affecté à la mission ${clash.orderNumber} sur ce créneau.`;
}

/**
 * Sérialise les contrôles de planning concurrents sur un même chauffeur ou véhicule : deux créations
 * simultanées passeraient sinon toutes deux le contrôle avant que l'une n'ait inséré son affectation.
 * Verrou de transaction (libéré au commit/rollback), pris dans un ordre fixe pour éviter l'interblocage.
 * À appeler dans la transaction, AVANT findPlanningClash.
 */
export async function lockPlanningResources(tx: Executor, vehicleId: number, driverId: number): Promise<void> {
  // Deux espaces de clés distincts (véhicule / chauffeur) : le premier entier du couple sert de namespace.
  const keys: Array<[number, number]> = [
    [1, vehicleId],
    [2, driverId],
  ];
  for (const [ns, id] of keys) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${ns}, ${id})`);
  }
}
