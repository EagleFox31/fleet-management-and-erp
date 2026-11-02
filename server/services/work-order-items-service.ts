import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { AppError } from "../lib/app-error";
import { isUniqueViolation } from "../lib/pg-errors";
import { laborCatalog, users, workOrderItems } from "@shared/schema";
import {
  computeWorkOrderItemTotals,
  parseHours,
  resolveWorkOrderItemLabel,
  validateWorkOrderItem,
  type WorkOrderItemStatus,
  type WorkOrderItemTotals,
} from "@shared/constants/work-order-items";

/**
 * Seul écrivain de `labor_catalog` et `work_order_items`.
 *
 * Aucune route ne doit écrire ces tables par `storage` : trois portes dérobées
 * de ce type ont été fermées en août 2026 (sortie de stock, statut véhicule,
 * `status_history`). Ne pas en rouvrir une quatrième.
 *
 * Ce service **ne touche jamais** à `workOrders.cost` : ce lot enregistre des
 * heures, il ne les valorise pas.
 */

export interface WorkOrderItemRow {
  id: number;
  workOrderId: number;
  laborCatalogId: number | null;
  laborCatalogCode: string | null;
  laborCatalogLabel: string | null;
  standardHours: number | null;
  customLabel: string | null;
  label: string;
  technicianId: number | null;
  technicianName: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  status: WorkOrderItemStatus;
  startedAt: Date | null;
  completedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkOrderItemsResult {
  items: WorkOrderItemRow[];
  totals: WorkOrderItemTotals;
}

export interface WorkOrderItemPayload {
  laborCatalogId?: number | null;
  customLabel?: string | null;
  technicianId?: number | null;
  estimatedHours?: number | string | null;
  actualHours?: number | string | null;
  status?: string | null;
  notes?: string | null;
}

export type ServiceResult<T> = { success: true; data: T } | { success: false; error: string };

/** `numeric` part et revient en chaîne côté pg. On centralise la conversion. */
function toNumericColumn(value: number | string | null | undefined): string | null {
  const heures = parseHours(value);
  return heures === null ? null : heures.toFixed(2);
}

/** Le champ n'est écrit que s'il est explicitement présent dans le payload. */
function estFourni(payload: WorkOrderItemPayload, champ: keyof WorkOrderItemPayload): boolean {
  return Object.prototype.hasOwnProperty.call(payload, champ);
}

export class WorkOrderItemsService {
  async getLaborCatalog(includeInactive = false) {
    const query = db
      .select({
        id: laborCatalog.id,
        code: laborCatalog.code,
        label: laborCatalog.label,
        standardHours: laborCatalog.standardHours,
        isActive: laborCatalog.isActive,
      })
      .from(laborCatalog);

    const rows = await (includeInactive ? query : query.where(eq(laborCatalog.isActive, true))).orderBy(
      asc(laborCatalog.label),
    );

    return rows.map((row) => ({
      ...row,
      standardHours: parseHours(row.standardHours),
    }));
  }

  async createLaborCatalogEntry(
    payload: { code?: string | null; label?: string | null; standardHours?: number | string | null },
    userId?: number,
  ): Promise<ServiceResult<{ id: number }>> {
    const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
    const label = typeof payload.label === "string" ? payload.label.trim() : "";

    if (code === "" || label === "") {
      return { success: false, error: "Le code et le libellé du poste sont obligatoires." };
    }

    const [existant] = await db
      .select({ id: laborCatalog.id })
      .from(laborCatalog)
      .where(eq(laborCatalog.code, code))
      .limit(1);

    if (existant) {
      return { success: false, error: `Le code ${code} existe déjà dans le catalogue.` };
    }

    let created: { id: number };
    try {
      [created] = await db
        .insert(laborCatalog)
        .values({
          code,
          label,
          standardHours: toNumericColumn(payload.standardHours),
          createdBy: userId ?? null,
          updatedBy: userId ?? null,
        })
        .returning({ id: laborCatalog.id });
    } catch (error) {
      // Deux créations simultanées : la contrainte UNIQUE tranche, la réponse reste un refus métier.
      if (isUniqueViolation(error)) {
        return { success: false, error: `Le code ${code} existe déjà dans le catalogue.` };
      }
      throw error;
    }

    return { success: true, data: { id: created.id } };
  }

  /**
   * Corrige ou désactive un poste. Le code est immuable (les lignes d'OT y
   * renvoient) ; un poste ne se supprime jamais, il se désactive.
   */
  async updateLaborCatalogEntry(
    id: number,
    payload: { label?: unknown; standardHours?: unknown; isActive?: unknown },
    userId?: number,
  ): Promise<ServiceResult<{ id: number }>> {
    const set: Partial<typeof laborCatalog.$inferInsert> = { updatedAt: new Date(), updatedBy: userId ?? null };
    const fourni = (champ: string) => Object.prototype.hasOwnProperty.call(payload, champ);

    if (fourni("label")) {
      const label = typeof payload.label === "string" ? payload.label.trim() : "";
      if (label === "") return { success: false, error: "Le libellé du poste ne peut pas être vide." };
      set.label = label;
    }
    if (fourni("standardHours")) {
      const brut = payload.standardHours;
      const vide = brut === null || (typeof brut === "string" && brut.trim() === "");
      if (!vide && parseHours(brut) === null) {
        return { success: false, error: "Les heures standard doivent être un nombre positif ou nul." };
      }
      set.standardHours = toNumericColumn(payload.standardHours as number | string | null);
    }
    if (fourni("isActive")) {
      if (typeof payload.isActive !== "boolean") {
        return { success: false, error: "L'état actif du poste doit être vrai ou faux." };
      }
      set.isActive = payload.isActive;
    }

    const [updated] = await db
      .update(laborCatalog)
      .set(set)
      .where(eq(laborCatalog.id, id))
      .returning({ id: laborCatalog.id });

    if (!updated) throw new AppError(404, "Poste introuvable.");
    return { success: true, data: { id: updated.id } };
  }

  /** Lignes d'un OT, enrichies du poste catalogue et du nom du technicien. */
  async getItemsForWorkOrder(workOrderId: number): Promise<WorkOrderItemsResult> {
    const rows = await db
      .select({
        id: workOrderItems.id,
        workOrderId: workOrderItems.workOrderId,
        laborCatalogId: workOrderItems.laborCatalogId,
        laborCatalogCode: laborCatalog.code,
        laborCatalogLabel: laborCatalog.label,
        standardHours: laborCatalog.standardHours,
        customLabel: workOrderItems.customLabel,
        technicianId: workOrderItems.technicianId,
        technicianName: users.name,
        estimatedHours: workOrderItems.estimatedHours,
        actualHours: workOrderItems.actualHours,
        status: workOrderItems.status,
        startedAt: workOrderItems.startedAt,
        completedAt: workOrderItems.completedAt,
        notes: workOrderItems.notes,
        createdAt: workOrderItems.createdAt,
        updatedAt: workOrderItems.updatedAt,
      })
      .from(workOrderItems)
      .leftJoin(laborCatalog, eq(workOrderItems.laborCatalogId, laborCatalog.id))
      .leftJoin(users, eq(workOrderItems.technicianId, users.id))
      .where(eq(workOrderItems.workOrderId, workOrderId))
      .orderBy(asc(workOrderItems.createdAt), asc(workOrderItems.id));

    const items: WorkOrderItemRow[] = rows.map((row) => ({
      ...row,
      standardHours: parseHours(row.standardHours),
      estimatedHours: parseHours(row.estimatedHours),
      actualHours: parseHours(row.actualHours),
      status: row.status as WorkOrderItemStatus,
      label: resolveWorkOrderItemLabel(row),
    }));

    return { items, totals: computeWorkOrderItemTotals(items) };
  }

  async getItem(itemId: number) {
    const [row] = await db
      .select()
      .from(workOrderItems)
      .where(eq(workOrderItems.id, itemId))
      .limit(1);

    return row ?? null;
  }

  async createItem(
    workOrderId: number,
    payload: WorkOrderItemPayload,
    userId?: number,
  ): Promise<ServiceResult<WorkOrderItemsResult>> {
    const verdict = validateWorkOrderItem(payload);
    if (!verdict.valid) {
      return { success: false, error: verdict.errors.join(" ") };
    }

    const laborCatalogId = Number(payload.laborCatalogId);
    const posteId = Number.isInteger(laborCatalogId) && laborCatalogId > 0 ? laborCatalogId : null;

    if (posteId !== null) {
      const [poste] = await db
        .select({ id: laborCatalog.id })
        .from(laborCatalog)
        .where(and(eq(laborCatalog.id, posteId), eq(laborCatalog.isActive, true)))
        .limit(1);

      if (!poste) {
        return { success: false, error: "Poste de main-d'œuvre introuvable ou désactivé." };
      }
    }

    const statut = (payload.status as WorkOrderItemStatus | undefined) ?? "pending";
    const heuresReelles = toNumericColumn(payload.actualHours);
    const technicianId = Number(payload.technicianId);

    const technicienInconnu = await this.refusTechnicien(payload.technicianId);
    if (technicienInconnu) return { success: false, error: technicienInconnu };

    await db.insert(workOrderItems).values({
      workOrderId,
      laborCatalogId: posteId,
      customLabel: posteId === null ? String(payload.customLabel ?? "").trim() : (payload.customLabel ?? null),
      technicianId: Number.isInteger(technicianId) && technicianId > 0 ? technicianId : null,
      estimatedHours: toNumericColumn(payload.estimatedHours),
      actualHours: heuresReelles,
      status: statut,
      startedAt: statut === "pending" ? null : new Date(),
      // Une ligne créée directement « terminée » (saisie a posteriori, le cas
      // courant à l'atelier) porte son horodatage de fin dès l'insertion.
      completedAt: statut === "done" ? new Date() : null,
      notes: typeof payload.notes === "string" && payload.notes.trim() !== "" ? payload.notes.trim() : null,
      createdBy: userId ?? null,
    });

    return { success: true, data: await this.getItemsForWorkOrder(workOrderId) };
  }

  async updateItem(
    itemId: number,
    payload: WorkOrderItemPayload,
  ): Promise<ServiceResult<WorkOrderItemsResult & { workOrderId: number }>> {
    const existant = await this.getItem(itemId);
    if (!existant) {
      return { success: false, error: "Ligne de travail introuvable." };
    }

    const fusion = {
      laborCatalogId: estFourni(payload, "laborCatalogId") ? payload.laborCatalogId : existant.laborCatalogId,
      customLabel: estFourni(payload, "customLabel") ? payload.customLabel : existant.customLabel,
      estimatedHours: estFourni(payload, "estimatedHours") ? payload.estimatedHours : existant.estimatedHours,
      actualHours: estFourni(payload, "actualHours") ? payload.actualHours : existant.actualHours,
      status: estFourni(payload, "status") ? payload.status : existant.status,
    };

    const verdict = validateWorkOrderItem(fusion);
    if (!verdict.valid) {
      return { success: false, error: verdict.errors.join(" ") };
    }

    if (estFourni(payload, "technicianId")) {
      const technicienInconnu = await this.refusTechnicien(payload.technicianId);
      if (technicienInconnu) return { success: false, error: technicienInconnu };
    }
    if (estFourni(payload, "laborCatalogId") && Number(payload.laborCatalogId) !== existant.laborCatalogId) {
      const posteId = Number(payload.laborCatalogId);
      if (Number.isInteger(posteId) && posteId > 0) {
        const [poste] = await db
          .select({ id: laborCatalog.id })
          .from(laborCatalog)
          .where(and(eq(laborCatalog.id, posteId), eq(laborCatalog.isActive, true)))
          .limit(1);
        if (!poste) {
          return { success: false, error: "Poste de main-d'œuvre introuvable ou désactivé." };
        }
      }
    }

    const maj: Record<string, unknown> = { updatedAt: new Date() };

    if (estFourni(payload, "laborCatalogId")) {
      const id = Number(payload.laborCatalogId);
      maj.laborCatalogId = Number.isInteger(id) && id > 0 ? id : null;
    }
    if (estFourni(payload, "customLabel")) {
      const libelle = typeof payload.customLabel === "string" ? payload.customLabel.trim() : "";
      maj.customLabel = libelle === "" ? null : libelle;
    }
    if (estFourni(payload, "technicianId")) {
      const id = Number(payload.technicianId);
      maj.technicianId = Number.isInteger(id) && id > 0 ? id : null;
    }
    if (estFourni(payload, "estimatedHours")) {
      maj.estimatedHours = toNumericColumn(payload.estimatedHours);
    }
    if (estFourni(payload, "actualHours")) {
      maj.actualHours = toNumericColumn(payload.actualHours);
    }
    if (estFourni(payload, "notes")) {
      const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
      maj.notes = notes === "" ? null : notes;
    }

    if (estFourni(payload, "status") && payload.status !== existant.status) {
      const statut = payload.status as WorkOrderItemStatus;
      maj.status = statut;

      if (statut === "in_progress" && !existant.startedAt) {
        maj.startedAt = new Date();
      }
      if (statut === "done") {
        maj.completedAt = new Date();
        if (!existant.startedAt) maj.startedAt = new Date();
      }
      if (statut === "pending" || statut === "cancelled") {
        maj.completedAt = null;
      }
    }

    await db.update(workOrderItems).set(maj).where(eq(workOrderItems.id, itemId));

    const resultat = await this.getItemsForWorkOrder(existant.workOrderId);
    return { success: true, data: { ...resultat, workOrderId: existant.workOrderId } };
  }

  /** Message de refus si `technicianId` désigne un utilisateur inexistant ; vide ou absent : rien à vérifier. */
  private async refusTechnicien(value: unknown): Promise<string | null> {
    const id = Number(value);
    if (value === undefined || value === null || value === "" || !Number.isInteger(id) || id <= 0) return null;
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    return user ? null : "Technicien introuvable : choisissez un technicien de la liste.";
  }

  async deleteItem(itemId: number): Promise<ServiceResult<WorkOrderItemsResult & { workOrderId: number }>> {
    const existant = await this.getItem(itemId);
    if (!existant) {
      return { success: false, error: "Ligne de travail introuvable." };
    }

    await db.delete(workOrderItems).where(eq(workOrderItems.id, itemId));

    const resultat = await this.getItemsForWorkOrder(existant.workOrderId);
    return { success: true, data: { ...resultat, workOrderId: existant.workOrderId } };
  }
}

export const workOrderItemsService = new WorkOrderItemsService();
