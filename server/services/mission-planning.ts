import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { assignments, missions } from "@shared/schema";
import { ACTIVE_ASSIGNMENT_STATUSES } from "@shared/constants/assignments";
import { AppError } from "../lib/app-error";
import type { db } from "../db";

/**
 * Conflit de planning : un chauffeur ou un véhicule ne peut pas porter deux missions actives qui se
 * chevauchent. Règle unique, partagée par la création, le PATCH, l'ajout d'affectation, launch-readiness
 * et la validation de lancement de PUT /:id/status (les trois copies d'origine).
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
 * Sérialise les contrôles de planning concurrents sur les mêmes chauffeurs ou véhicules : deux écritures
 * simultanées passeraient sinon toutes deux le contrôle avant que l'une n'ait inséré son affectation.
 * Verrou de transaction (libéré au commit/rollback). Ordre global trié et dédoublonné : tous les
 * véhicules par id croissant, puis tous les chauffeurs par id croissant, quel que soit l'appelant
 * (une mission à plusieurs affectations ne prend donc jamais ses verrous dans le désordre).
 * À appeler dans la transaction, AVANT findPlanningClash.
 */
export async function lockPlanningPairs(tx: Executor, pairs: Array<{ vehicleId: number; driverId: number }>): Promise<void> {
  const sorted = (values: number[]) => Array.from(new Set(values)).sort((a, b) => a - b);
  // Deux espaces de clés distincts (véhicule / chauffeur) : le premier entier du couple sert de namespace.
  for (const id of sorted(pairs.map((p) => p.vehicleId))) await tx.execute(sql`SELECT pg_advisory_xact_lock(1, ${id})`);
  for (const id of sorted(pairs.map((p) => p.driverId))) await tx.execute(sql`SELECT pg_advisory_xact_lock(2, ${id})`);
}

export function lockPlanningResources(tx: Executor, vehicleId: number, driverId: number): Promise<void> {
  return lockPlanningPairs(tx, [{ vehicleId, driverId }]);
}

/** Message commun quand l'état lu avant la transaction n'est plus celui de la base sous verrou. */
export const PLANNING_STALE_MESSAGE = "La mission vient d'être modifiée par un autre utilisateur : rechargez la page et recommencez.";

type PlanningStateRow = { id: number; status: string; vehicleId: number | null; driverId: number | null; trailerId: number | null };

/** Empreinte du créneau et des affectations retenues : sert à détecter une lecture périmée. */
export function planningStateKey(state: { pickupDate: DateLike; deliveryDate: DateLike; rows: PlanningStateRow[] }): string {
  const t = (d: DateLike) => (d ? new Date(d).getTime() : null);
  const rows = [...state.rows].sort((a, b) => a.id - b.id).map((r) => `${r.id}:${r.status}:${r.vehicleId}:${r.driverId}:${r.trailerId}`);
  return JSON.stringify([t(state.pickupDate), t(state.deliveryDate), rows]);
}

/**
 * À appeler dans la transaction, APRÈS le verrou de la ligne mission : relit le créneau et les
 * affectations retenues par `keep` et lève un 409 lisible si leur empreinte diffère de celle lue avant
 * la transaction (un PATCH ou un ajout concurrent est passé entre-temps).
 */
export async function assertPlanningStateUnchanged(
  tx: Executor,
  missionId: number,
  keep: (status: string) => boolean,
  expectedKey: string,
): Promise<void> {
  const [mission] = await tx.select({ pickupDate: missions.pickupDate, deliveryDate: missions.deliveryDate }).from(missions).where(eq(missions.id, missionId));
  const rows = await tx
    .select({ id: assignments.id, status: assignments.status, vehicleId: assignments.vehicleId, driverId: assignments.driverId, trailerId: assignments.trailerId })
    .from(assignments)
    .where(eq(assignments.missionId, missionId))
    .orderBy(asc(assignments.id));
  const key = planningStateKey({ pickupDate: mission?.pickupDate, deliveryDate: mission?.deliveryDate, rows: rows.filter((r) => keep(r.status)) });
  if (key !== expectedKey) throw new AppError(409, PLANNING_STALE_MESSAGE);
}

/** Taille maximale du message : le contrat d'erreur écarte tout message de plus de 300 caractères (looksTechnical). */
const LAUNCH_MESSAGE_BUDGET = 240;
const LAUNCH_HEAD = "Impossible de lancer la mission : ";
const URGENT_LAUNCH_MOTIF = /Conflit|Budget|Solde/;

/**
 * Message d'un lancement refusé : conflit et budget d'abord, motifs ajoutés tant qu'ils tiennent (un motif
 * trop long est sauté, il ne vide pas le message), les autres comptés. Un chauffeur ne peut pas corriger
 * un budget : on lui dit à qui s'adresser.
 */
export function launchRefusalMessage(motifs: string[], options: { forDriver: boolean }): string {
  const suffix = options.forDriver ? " Contactez l'exploitation." : "";
  const room = LAUNCH_MESSAGE_BUDGET - LAUNCH_HEAD.length - suffix.length;
  const ordered = [...motifs.filter((m) => URGENT_LAUNCH_MOTIF.test(m)), ...motifs.filter((m) => !URGENT_LAUNCH_MOTIF.test(m))];
  const kept: string[] = [];
  for (const motif of ordered) {
    if ([...kept, motif].join(" ").length > room) continue;
    kept.push(motif);
  }
  const hidden = motifs.length - kept.length;
  const more = hidden > 0 ? ` (et ${hidden} autre${hidden > 1 ? "s" : ""} point${hidden > 1 ? "s" : ""} à corriger)` : "";
  return `${LAUNCH_HEAD}${kept.join(" ")}${more}${suffix}`;
}
