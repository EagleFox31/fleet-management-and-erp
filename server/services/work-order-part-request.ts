import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  partRequirements,
  parts,
  workOrders,
  type PartRequirement,
  type PartUsed,
} from "@shared/schema";
import { storage } from "../storage";
import { AppError } from "../lib/app-error";
import { describePartRequest, splitPartRequest } from "../lib/part-request";

/** Demande encore en cours : une nouvelle demande sur la même pièce la réutilise. */
export const OPEN_REQUIREMENT_STATUSES: Array<
  "pending" | "approved" | "ordered" | "partially_received" | "received" | "partial" | "delivered"
> = ["pending", "approved", "ordered", "partially_received", "received", "partial", "delivered"];

/** Demandes qui attendent leur sortie : leur quantité est promise, plus disponible. */
const RESERVING_STATUSES: Array<"received" | "delivered"> = ["received", "delivered"];

const URGENCIES = ["low", "medium", "high", "critical"] as const;
type Urgency = (typeof URGENCIES)[number];

export type PartRequestInput = {
  workOrderId: number;
  partId: number;
  quantity: number;
  actor: { id: number; role: string };
  urgency?: unknown;
  reason?: unknown;
};

export type PartRequestResult = {
  workOrder: Awaited<ReturnType<typeof storage.getWorkOrder>>;
  part: { id: number; name: string; reference: string | null };
  quantity: number;
  issuedQuantity: number;
  missingQuantity: number;
  /** Toujours nul : la pièce sort par le magasinier (`/issue`), jamais au clic. */
  partUsed: PartUsed | null;
  /** Demande « Entrée en stock » créée pour la quantité en rayon, à sortir par le magasin. */
  stockRequirement: PartRequirement | null;
  toIssueQuantity: number;
  /** Demande « En attente » créée pour le manquant (ou demande en cours réutilisée). */
  requirement: PartRequirement | null;
  usedExistingRequirement: boolean;
  workOrderStatusChanged: boolean;
  message: string;
};

/**
 * Un seul geste pour l'atelier : « Demander la pièce ». Rien ne sort du stock
 * ici : toute sortie passe par le magasinier (`/issue`), même pièce en rayon.
 * La quantité en rayon devient une demande « Entrée en stock », à sortir par le
 * magasin sans approbation ni commande ; le manquant devient une demande « En
 * attente » et l'OT passe en attente de pièces. Tout se joue dans une
 * transaction qui verrouille l'OT puis la pièce : deux demandes simultanées ne
 * promettent pas deux fois la même unité, ni ne créent deux demandes.
 */
export async function requestPartForWorkOrder(input: PartRequestInput): Promise<PartRequestResult> {
  const { workOrderId, partId, quantity, actor } = input;

  if (!Number.isInteger(workOrderId) || workOrderId <= 0) {
    throw new AppError(400, "ID d'ordre de travail invalide");
  }
  if (!Number.isInteger(partId) || partId <= 0) {
    throw new AppError(400, "Pièce invalide");
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AppError(400, "Quantité invalide : un nombre entier d'au moins 1 est attendu.");
  }

  const urgency: Urgency = URGENCIES.includes(input.urgency as Urgency) ? (input.urgency as Urgency) : "high";
  const reasonFromInput = typeof input.reason === "string" ? input.reason.trim() : "";

  const outcome = await db.transaction(async (tx) => {
    const [workOrder] = await tx.select().from(workOrders).where(eq(workOrders.id, workOrderId)).for("update");
    if (!workOrder) {
      throw new AppError(404, "Ordre de travail non trouvé");
    }
    if (actor.role === "technician" && workOrder.technicianId && workOrder.technicianId !== actor.id) {
      throw new AppError(403, "Accès refusé - OT assignée à un autre technicien");
    }
    if (workOrder.status === "completed" || workOrder.status === "cancelled") {
      throw new AppError(400, "Impossible d'ajouter des pièces à un ordre de travail terminé ou annulé");
    }

    const [part] = await tx.select().from(parts).where(eq(parts.id, partId)).for("update");
    if (!part) {
      throw new AppError(404, "Pièce non trouvée");
    }

    // Une demande déjà en cours sur cette pièce et cet OT est réutilisée : un
    // double clic ou un rejeu ne crée rien de neuf.
    const [existing] = await tx
      .select()
      .from(partRequirements)
      .where(
        and(
          eq(partRequirements.workOrderId, workOrderId),
          eq(partRequirements.partId, partId),
          inArray(partRequirements.status, OPEN_REQUIREMENT_STATUSES),
        ),
      )
      .orderBy(desc(partRequirements.updatedAt), desc(partRequirements.createdAt))
      .limit(1);

    if (existing) {
      return {
        part: { id: part.id, name: part.name, reference: part.reference ?? null },
        toIssue: 0,
        missing: 0,
        stockRequirement: null,
        requirement: existing,
        usedExistingRequirement: true,
        workOrderStatusChanged: false,
      };
    }

    // Le rayon est déjà promis aux demandes « Entrée en stock » qui attendent
    // leur sortie : seul le reste est disponible pour cette demande.
    const [{ reserved }] = await tx
      .select({ reserved: sql<number>`coalesce(sum(${partRequirements.quantityNeeded}), 0)::int` })
      .from(partRequirements)
      .where(and(eq(partRequirements.partId, partId), inArray(partRequirements.status, RESERVING_STATUSES)));
    const { inStock: toIssue, missing } = splitPartRequest(quantity, Number(part.quantity ?? 0) - Number(reserved));

    const workOrderLabel = workOrder.title ? `OT #${workOrderId} - ${workOrder.title}` : `OT #${workOrderId}`;
    const unitPrice = Number.parseFloat(part.unitPrice ?? "0");
    // Le prix vient du catalogue, jamais du client.
    const costOf = (count: number) => (unitPrice > 0 ? (unitPrice * count).toString() : undefined);
    const reason =
      reasonFromInput || `${workOrderLabel} • Besoin pièce: ${part.name} (${part.reference || "sans-référence"})`;

    // En rayon : la demande arrive directement « à sortir » dans la file du
    // magasinier, sans approbation ni commande. Le stock ne bouge qu'à la sortie.
    let stockRequirement: PartRequirement | null = null;
    if (toIssue > 0) {
      [stockRequirement] = await tx
        .insert(partRequirements)
        .values({
          partId,
          workOrderId,
          vehicleId: workOrder.vehicleId ?? null,
          quantityNeeded: toIssue,
          urgency,
          reason,
          status: "received",
          requestedBy: actor.id,
          estimatedCost: costOf(toIssue),
          notes: `Créée depuis l'OT #${workOrderId} : ${toIssue} en rayon, à sortir par le magasin.`,
        })
        .returning();
    }

    let requirement: PartRequirement | null = null;
    let workOrderStatusChanged = false;
    if (missing > 0) {
      [requirement] = await tx
        .insert(partRequirements)
        .values({
          partId,
          workOrderId,
          vehicleId: workOrder.vehicleId ?? null,
          quantityNeeded: missing,
          urgency,
          reason,
          status: "pending",
          requestedBy: actor.id,
          estimatedCost: costOf(missing),
          notes:
            `Créée depuis l'OT #${workOrderId} : ${quantity} demandée(s), ` +
            `${toIssue} en rayon, ${missing} manquante(s).`,
        })
        .returning();

      if (workOrder.status !== "awaiting_parts") {
        await tx.update(workOrders).set({ status: "awaiting_parts" }).where(eq(workOrders.id, workOrderId));
        workOrderStatusChanged = true;
      }
    }

    return {
      part: { id: part.id, name: part.name, reference: part.reference ?? null },
      toIssue,
      missing,
      stockRequirement,
      requirement,
      usedExistingRequirement: false,
      workOrderStatusChanged,
    };
  });

  return {
    workOrder: await storage.getWorkOrder(workOrderId),
    part: outcome.part,
    quantity,
    // Plus rien ne sort au clic : champ conservé pour les consommateurs existants.
    issuedQuantity: 0,
    toIssueQuantity: outcome.toIssue,
    missingQuantity: outcome.missing,
    partUsed: null,
    stockRequirement: outcome.stockRequirement,
    requirement: outcome.requirement,
    usedExistingRequirement: outcome.usedExistingRequirement,
    workOrderStatusChanged: outcome.workOrderStatusChanged,
    message: describePartRequest({
      toIssue: outcome.toIssue,
      missing: outcome.missing,
      existingStatus: outcome.usedExistingRequirement ? outcome.requirement?.status : null,
    }),
  };
}
