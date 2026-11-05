/**
 * Contrôles inopinés QHSE (lot Q1, drapeau `qhse`).
 *
 * - critères : référentiel configurable (code stable, libellé, nature cabine ou arrêt, actif) ;
 * - contrôle : fiche saisie par le personnel autorisé ; chaque ligne garde le code et le libellé du
 *   critère tels qu'ils étaient à la saisie ;
 * - cloison : un chauffeur ne lit que les contrôles de ses fiches (`driverScopeOf`, pendant de
 *   `client-scope.ts`) ; hors périmètre, la même réponse sert à l'absent et à l'interdit.
 */
import { and, asc, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import {
  drivers,
  qhseInspectionCriteria,
  qhseInspections,
  vehicles,
  type QhseInspectionCriterionRow,
  type QhseInspectionRow,
} from "@shared/schema";
import type {
  CreateQhseCriterionRequest,
  CreateQhseInspectionRequest,
  QhseCriterion,
  QhseInspection,
  QhseInspectionItem,
  QhseInspectionsQuery,
  UpdateQhseCriterionRequest,
} from "@shared/contracts/qhse-inspections";
import { QHSE_INSPECTION_KIND_LABELS } from "@shared/contracts/qhse-inspections";
import { KPI_TIME_ZONE } from "@shared/contracts/kpi-period";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { driverScopeOf } from "../lib/driver-scope";
import { moduleLogger } from "../lib/logger";
import { isCheckViolation, isForeignKeyViolation, isUniqueViolation } from "../lib/pg-errors";

const log = moduleLogger("qhse-inspections");

export type QhseActor = { id: number; role: string };

export const QHSE_OUT_OF_SCOPE_MESSAGE = "Accès refusé : ce contrôle ne concerne pas votre fiche chauffeur.";

/** Minuit du jour `day` (expression SQL de type date) en Africa/Douala, exprimé en heure UTC sans fuseau. */
function localMidnightUtc(day: SQL): SQL {
  return sql`((${day})::timestamp AT TIME ZONE ${KPI_TIME_ZONE}) AT TIME ZONE 'UTC'`;
}

function toCriterion(row: QhseInspectionCriterionRow): QhseCriterion {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    category: row.category,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

function toInspection(row: QhseInspectionRow): QhseInspection {
  const items: QhseInspectionItem[] = row.items ?? [];
  return {
    id: row.id,
    kind: row.kind,
    inspectedAt: row.inspectedAt.toISOString(),
    location: row.location,
    vehicleId: row.vehicleId,
    driverId: row.driverId,
    inspectorId: row.inspectorId,
    items,
    generalObservation: row.generalObservation,
    nonConformCount: items.filter((i) => !i.conform).length,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCriteria(query: { category?: "cabin" | "stop"; active?: boolean }): Promise<QhseCriterion[]> {
  const conditions: SQL[] = [];
  if (query.category) conditions.push(eq(qhseInspectionCriteria.category, query.category));
  if (query.active !== undefined) conditions.push(eq(qhseInspectionCriteria.active, query.active));
  const rows = await db
    .select()
    .from(qhseInspectionCriteria)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(qhseInspectionCriteria.category), asc(qhseInspectionCriteria.sortOrder), asc(qhseInspectionCriteria.id));
  return rows.map(toCriterion);
}

export async function createCriterion(actor: QhseActor, input: CreateQhseCriterionRequest): Promise<QhseCriterion> {
  try {
    const [row] = await db
      .insert(qhseInspectionCriteria)
      .values({
        code: input.code,
        label: input.label,
        category: input.category,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning();
    log.info({ criterionId: row.id, code: row.code, userId: actor.id }, "critère QHSE créé");
    return toCriterion(row);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, "Un critère porte déjà ce code.", { cause: error });
    }
    throw error;
  }
}

export async function updateCriterion(
  actor: QhseActor,
  id: number,
  input: UpdateQhseCriterionRequest,
): Promise<QhseCriterion> {
  const [row] = await db
    .update(qhseInspectionCriteria)
    .set({ ...input, updatedBy: actor.id, updatedAt: new Date() })
    .where(eq(qhseInspectionCriteria.id, id))
    .returning();
  if (!row) throw new AppError(404, "Critère introuvable.");
  log.info({ criterionId: id, userId: actor.id, fields: Object.keys(input) }, "critère QHSE modifié");
  return toCriterion(row);
}

export async function createInspection(
  actor: QhseActor,
  input: CreateQhseInspectionRequest,
): Promise<QhseInspection> {
  const criterionIds = input.items.map((i) => i.criterionId);
  if (new Set(criterionIds).size !== criterionIds.length) {
    throw new AppError(400, "Un même critère ne peut être noté qu'une fois dans une fiche.");
  }
  const criteria = await db.select().from(qhseInspectionCriteria).where(inArray(qhseInspectionCriteria.id, criterionIds));
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const items: QhseInspectionItem[] = input.items.map((item) => {
    const criterion = byId.get(item.criterionId);
    if (!criterion) throw new AppError(400, "Un des critères notés n'existe pas.");
    if (!criterion.active) throw new AppError(400, `Le critère « ${criterion.label} » n'est plus utilisé.`);
    if (criterion.category !== input.kind) {
      throw new AppError(
        400,
        `Le critère « ${criterion.label} » n'appartient pas à la grille « ${QHSE_INSPECTION_KIND_LABELS[input.kind]} ».`,
      );
    }
    return {
      criterionId: criterion.id,
      code: criterion.code,
      label: criterion.label,
      conform: item.conform,
      ...(item.observation ? { observation: item.observation } : {}),
    };
  });

  const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles).where(eq(vehicles.id, input.vehicleId)).limit(1);
  if (!vehicle) throw new AppError(404, "Véhicule introuvable.");
  const [driver] = await db.select({ id: drivers.id }).from(drivers).where(eq(drivers.id, input.driverId)).limit(1);
  if (!driver) throw new AppError(404, "Chauffeur introuvable.");

  try {
    const [row] = await db
      .insert(qhseInspections)
      .values({
        kind: input.kind,
        inspectedAt: input.inspectedAt ? new Date(input.inspectedAt) : new Date(),
        location: input.location,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        inspectorId: actor.id,
        items,
        generalObservation: input.generalObservation || null,
        createdBy: actor.id,
        updatedBy: actor.id,
      })
      .returning();
    const inspection = toInspection(row);
    log.info(
      { inspectionId: row.id, kind: row.kind, driverId: row.driverId, nonConformCount: inspection.nonConformCount, userId: actor.id },
      "contrôle inopiné QHSE enregistré",
    );
    return inspection;
  } catch (error) {
    if (isForeignKeyViolation(error) || isCheckViolation(error)) {
      throw new AppError(400, "La fiche référence un élément qui n'existe plus ou contient une valeur refusée.", { cause: error });
    }
    throw error;
  }
}

export async function listInspections(
  actor: QhseActor,
  query: QhseInspectionsQuery,
): Promise<{ items: QhseInspection[]; total: number; page: number; pageSize: number }> {
  const scope = await driverScopeOf(actor);
  const conditions: SQL[] = [];
  if (scope !== undefined) {
    // Compte chauffeur sans fiche liée : liste vide, jamais l'ensemble.
    if (scope.length === 0) return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
    conditions.push(inArray(qhseInspections.driverId, scope));
  }
  if (query.kind) conditions.push(eq(qhseInspections.kind, query.kind));
  if (query.driverId) conditions.push(eq(qhseInspections.driverId, query.driverId));
  if (query.vehicleId) conditions.push(eq(qhseInspections.vehicleId, query.vehicleId));
  // Jours `from` / `to` lus en Africa/Douala, pas en UTC : un contrôle à 00 h 30 heure locale appartient à
  // ce jour-là. inspected_at stocke l'heure UTC (Drizzle écrit toISOString) : minuit local ramené en UTC.
  if (query.from) conditions.push(gte(qhseInspections.inspectedAt, localMidnightUtc(sql`${query.from}::date`)));
  if (query.to) conditions.push(lt(qhseInspections.inspectedAt, localMidnightUtc(sql`${query.to}::date + 1`)));
  const where = conditions.length ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(qhseInspections).where(where);
  const rows = await db
    .select()
    .from(qhseInspections)
    .where(where)
    .orderBy(desc(qhseInspections.inspectedAt), desc(qhseInspections.id))
    .limit(query.pageSize)
    .offset((query.page - 1) * query.pageSize);
  return { items: rows.map(toInspection), total, page: query.page, pageSize: query.pageSize };
}

export async function getInspection(actor: QhseActor, id: number): Promise<QhseInspection> {
  const scope = await driverScopeOf(actor);
  // Chauffeur : la portée est dans le WHERE, aucune ligne hors fiche n'est lue. L'identifiant absent et le
  // contrôle d'un autre reçoivent la même réponse (403).
  if (scope !== undefined && scope.length === 0) throw new AppError(403, QHSE_OUT_OF_SCOPE_MESSAGE);
  const [row] = await db
    .select()
    .from(qhseInspections)
    .where(and(eq(qhseInspections.id, id), scope !== undefined ? inArray(qhseInspections.driverId, scope) : undefined))
    .limit(1);
  if (!row) {
    if (scope !== undefined) throw new AppError(403, QHSE_OUT_OF_SCOPE_MESSAGE);
    throw new AppError(404, "Contrôle introuvable.");
  }
  return toInspection(row);
}
