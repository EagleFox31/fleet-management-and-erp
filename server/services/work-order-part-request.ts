import { and, desc, eq, inArray } from "drizzle-orm";
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
  partUsed: PartUsed | null;
  requirement: PartRequirement | null;
  usedExistingRequirement: boolean;
  workOrderStatusChanged: boolean;
  message: string;
};

/**
 * Un seul geste pour l'atelier : « Demander la pièce ». Le stock disponible sort
 * vers l'OT, le manquant devient une demande et l'OT passe en attente de pièces.
 * Tout se joue dans une transaction qui verrouille l'OT puis la pièce : deux
 * demandes simultanées ne sortent pas deux fois la même unité, ni ne créent
 * deux demandes pour le même manque.
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

    const { issued, missing } = splitPartRequest(quantity, Number(part.quantity ?? 0));

    // Le prix vient du catalogue, jamais du client.
    const partUsed =
      issued > 0
        ? await storage.addPartToWorkOrder(
            { workOrderId, partId, quantity: issued, unitPrice: part.unitPrice ?? "0" },
            actor.id,
            { executor: tx, requireAvailable: true },
          )
        : null;

    let requirement: PartRequirement | null = null;
    let usedExistingRequirement = false;
    let workOrderStatusChanged = false;

    if (missing > 0) {
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
        requirement = existing;
        usedExistingRequirement = true;
      } else {
        const workOrderLabel = workOrder.title ? `OT #${workOrderId} - ${workOrder.title}` : `OT #${workOrderId}`;
        const unitPrice = Number.parseFloat(part.unitPrice ?? "0");
        [requirement] = await tx
          .insert(partRequirements)
          .values({
            partId,
            workOrderId,
            vehicleId: workOrder.vehicleId ?? null,
            quantityNeeded: missing,
            urgency,
            reason:
              reasonFromInput ||
              `${workOrderLabel} • Besoin pièce: ${part.name} (${part.reference || "sans-référence"})`,
            status: "pending",
            requestedBy: actor.id,
            estimatedCost: unitPrice > 0 ? (unitPrice * missing).toString() : undefined,
            notes:
              `Créée depuis l'OT #${workOrderId} : ${quantity} demandée(s), ` +
              `${issued} sortie(s) du stock, ${missing} manquante(s).`,
          })
          .returning();
      }

      if (workOrder.status !== "awaiting_parts") {
        await tx.update(workOrders).set({ status: "awaiting_parts" }).where(eq(workOrders.id, workOrderId));
        workOrderStatusChanged = true;
      }
    }

    return {
      part: { id: part.id, name: part.name, reference: part.reference ?? null },
      issued,
      missing,
      partUsed,
      requirement,
      usedExistingRequirement,
      workOrderStatusChanged,
    };
  });

  return {
    workOrder: await storage.getWorkOrder(workOrderId),
    part: outcome.part,
    quantity,
    issuedQuantity: outcome.issued,
    missingQuantity: outcome.missing,
    partUsed: outcome.partUsed,
    requirement: outcome.requirement,
    usedExistingRequirement: outcome.usedExistingRequirement,
    workOrderStatusChanged: outcome.workOrderStatusChanged,
    message: describePartRequest({
      issued: outcome.issued,
      missing: outcome.missing,
      existingStatus: outcome.usedExistingRequirement ? outcome.requirement?.status : null,
    }),
  };
}
