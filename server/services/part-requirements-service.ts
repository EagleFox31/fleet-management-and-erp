import { db, type DbExecutor, type DbTransaction } from "../db";
import { partRequirements, parts, vehicles, users, partsStockMovements, purchaseOrderLines, purchaseOrders } from "@shared/schema";
import { eq, desc, and, ne, sql, inArray } from "drizzle-orm";
import type { PartRequirement, InsertPartRequirement } from "@shared/schema";
import { PartRequirementWorkflow, type PartRequirementStatus } from "./part-requirements-workflow";
import { moduleLogger } from "../lib/logger";

const log = moduleLogger("part-requirements");


export const STALE_STATUS_ERROR = "La demande a déjà changé de statut. Rechargez la page.";
/**
 * Une pièce commandée entre en stock une seule fois, à la réception de la commande fournisseur
 * (DÉCISION Q25). La réception directe reste permise pour une demande sans commande.
 */
export const ORDER_LINKED_RECEPTION_ERROR = "Réceptionnez cette pièce depuis la commande fournisseur.";
/** Le chef d'atelier dont l'administrateur a retiré le droit de sortie (`users.can_issue_stock`). */
export const STOCK_ISSUE_REVOKED_ERROR =
  "Votre droit de sortie de stock a été retiré par l'administrateur. Le magasinier sort la pièce.";

/** Annule la transaction quand une autre requête a déjà fait passer la demande. */
class StaleStatusError extends Error {}

/** Annule la réception directe d'une demande qu'une commande fournisseur porte. */
class OrderLinkedReceptionError extends Error {
  constructor(readonly purchaseOrderId: number) {
    super("demande rattachée à une commande");
  }
}

export class PartRequirementsService {
  private appendAuditNote(existing: string | null | undefined, note: string): string {
    const base = (existing || "").trim();
    return base ? `${base}\n${note}` : note;
  }

  private async attachPurchaseOrderContext<T extends { id: number }>(
    requirements: T[]
  ): Promise<Array<T & { linkedPurchaseOrderId?: number | null; linkedPurchaseOrderStatus?: string | null }>> {
    if (requirements.length === 0) return requirements as Array<T & { linkedPurchaseOrderId?: number | null; linkedPurchaseOrderStatus?: string | null }>;

    const requirementIds = requirements.map((r) => r.id);

    const links = await db
      .select({
        requirementId: purchaseOrderLines.partRequirementId,
        purchaseOrderId: purchaseOrders.id,
        purchaseOrderStatus: purchaseOrders.status,
        purchaseOrderCreatedAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
      .where(
        and(
          inArray(purchaseOrderLines.partRequirementId, requirementIds),
          sql`${purchaseOrderLines.partRequirementId} IS NOT NULL`
        )
      )
      .orderBy(desc(purchaseOrders.createdAt));

    const latestLinkByRequirement = new Map<number, { purchaseOrderId: number; purchaseOrderStatus: string }>();

    for (const link of links) {
      if (typeof link.requirementId !== "number") continue;
      if (latestLinkByRequirement.has(link.requirementId)) continue;
      latestLinkByRequirement.set(link.requirementId, {
        purchaseOrderId: link.purchaseOrderId,
        purchaseOrderStatus: link.purchaseOrderStatus,
      });
    }

    return requirements.map((requirement) => {
      const link = latestLinkByRequirement.get(requirement.id);
      return {
        ...requirement,
        linkedPurchaseOrderId: link?.purchaseOrderId ?? null,
        linkedPurchaseOrderStatus: link?.purchaseOrderStatus ?? null,
      };
    });
  }

  private getTodayLocalDate(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async getPartRequirement(id: number): Promise<(PartRequirement & { requesterRole?: string | null }) | undefined> {
    try {
      const [requirement] = await db
        .select({
          id: partRequirements.id,
          partId: partRequirements.partId,
          vehicleId: partRequirements.vehicleId,
          workOrderId: partRequirements.workOrderId,
          variantId: partRequirements.variantId,
          quantityNeeded: partRequirements.quantityNeeded,
          reason: partRequirements.reason,
          urgency: partRequirements.urgency,
          status: partRequirements.status,
          requestedBy: partRequirements.requestedBy,
          receivedBy: partRequirements.receivedBy,
          estimatedCost: partRequirements.estimatedCost,
          supplierNotes: partRequirements.supplierNotes,
          expectedDeliveryDate: partRequirements.expectedDeliveryDate,
          actualDeliveryDate: partRequirements.actualDeliveryDate,
          notes: partRequirements.notes,
          createdAt: partRequirements.createdAt,
          updatedAt: partRequirements.updatedAt,
          partName: parts.name,
          partReference: parts.reference,
          partQuantity: parts.quantity,
          partMinQuantity: parts.minQuantity,
          partCategory: parts.category,
          partSupplier: parts.supplier,
          partUnitPrice: parts.unitPrice,
          vehicleRegistration: vehicles.registrationNumber,
          requesterName: users.name,
          requesterRole: users.role,
        })
        .from(partRequirements)
        .leftJoin(parts, eq(partRequirements.partId, parts.id))
        .leftJoin(vehicles, eq(partRequirements.vehicleId, vehicles.id))
        .leftJoin(users, eq(partRequirements.requestedBy, users.id))
        .where(eq(partRequirements.id, id));
      if (!requirement) return undefined;
      const [enrichedRequirement] = await this.attachPurchaseOrderContext([requirement]);
      return enrichedRequirement as (PartRequirement & { requesterRole?: string | null }) | undefined;
    } catch (error) {
      log.error({ err: error }, 'Error getting part requirement');
      return undefined;
    }
  }

  async getPartRequirements(status?: string): Promise<PartRequirement[]> {
    try {
      const selectFields = {
        id: partRequirements.id,
        partId: partRequirements.partId,
        vehicleId: partRequirements.vehicleId,
        workOrderId: partRequirements.workOrderId,
        variantId: partRequirements.variantId,
        quantityNeeded: partRequirements.quantityNeeded,
        reason: partRequirements.reason,
        urgency: partRequirements.urgency,
        status: partRequirements.status,
        requestedBy: partRequirements.requestedBy,
        receivedBy: partRequirements.receivedBy,
        estimatedCost: partRequirements.estimatedCost,
        supplierNotes: partRequirements.supplierNotes,
        expectedDeliveryDate: partRequirements.expectedDeliveryDate,
        actualDeliveryDate: partRequirements.actualDeliveryDate,
        notes: partRequirements.notes,
        createdAt: partRequirements.createdAt,
        updatedAt: partRequirements.updatedAt,
        partName: parts.name,
        partReference: parts.reference,
        partQuantity: parts.quantity,
        partMinQuantity: parts.minQuantity,
        partCategory: parts.category,
        partSupplier: parts.supplier,
        partUnitPrice: parts.unitPrice,
        vehicleRegistration: vehicles.registrationNumber,
        requesterName: users.name,
        requesterRole: users.role,
      };

      const baseQuery = db
        .select(selectFields)
        .from(partRequirements)
        .leftJoin(parts, eq(partRequirements.partId, parts.id))
        .leftJoin(vehicles, eq(partRequirements.vehicleId, vehicles.id))
        .leftJoin(users, eq(partRequirements.requestedBy, users.id));

      let requirements;
      if (status && status !== 'all') {
        requirements = await baseQuery
          .where(eq(partRequirements.status, status as any))
          .orderBy(desc(partRequirements.createdAt));
      } else {
        requirements = await baseQuery.orderBy(desc(partRequirements.createdAt));
      }

      const enrichedRequirements = await this.attachPurchaseOrderContext(requirements as any[]);

      log.debug(`Found ${enrichedRequirements.length} part requirements`);
      return enrichedRequirements as any;
    } catch (error) {
      log.error({ err: error }, 'Error getting part requirements');
      return [];
    }
  }

  async createPartRequirement(requirement: InsertPartRequirement): Promise<PartRequirement> {
    try {
      // Calculer automatiquement le coût estimé si pas fourni
      let estimatedCost = requirement.estimatedCost;
      
      if (!estimatedCost && requirement.partId && requirement.quantityNeeded) {
        // Récupérer le prix unitaire de la pièce
        const [part] = await db
          .select({ unitPrice: parts.unitPrice })
          .from(parts)
          .where(eq(parts.id, requirement.partId));
          
        if (part && part.unitPrice) {
          const unitPrice = parseFloat(part.unitPrice);
          estimatedCost = (unitPrice * requirement.quantityNeeded).toString();
          log.debug({ partId: requirement.partId, quantityNeeded: requirement.quantityNeeded }, "coût estimé calculé depuis le prix unitaire");
        }
      }

      const [newRequirement] = await db
        .insert(partRequirements)
        .values({
          ...requirement,
          estimatedCost
        })
        .returning();
      return newRequirement;
    } catch (error) {
      log.error({ err: error }, 'Error creating part requirement');
      throw new Error('Erreur lors de la création de la demande');
    }
  }

  async updatePartRequirement(
    id: number, 
    requirement: Partial<InsertPartRequirement>, 
    userRole: string = 'technician',
    currentUserId?: number,
    options?: {
      emergencyOverrideReason?: string;
      /** Motif de sortie exceptionnelle (chef d'atelier, magasin fermé). */
      overrideIssueReason?: string;
      /**
       * Effet métier de la transition (ex. sortie de stock vers l'OT), exécuté
       * dans la même transaction : il ne tourne qu'une fois, et son échec
       * annule le changement de statut.
       */
      onTransition?: (tx: DbTransaction, updated: PartRequirement) => Promise<void>;
    }
  ): Promise<{
    success: boolean;
    data?: PartRequirement;
    error?: string;
    /** Code HTTP du refus, quand il n'est pas 400. */
    status?: number;
    /** Vrai si la sortie s'est faite en dérogation (à notifier au magasin). */
    overrideApplied?: boolean;
  }> {
    let overrideApplied = false;
    try {
      // Récupérer les données actuelles de la demande
      const current = await this.getPartRequirement(id);
      if (!current) {
        return { success: false, error: 'Demande de pièce non trouvée' };
      }

      // Valider la transition de statut si elle est demandée
      if (requirement.status && requirement.status !== current.status) {
        // `issued` = la pièce a quitté le stock : la transition n'existe qu'avec
        // son effet (déduction + rattachement à l'OT), porté par `onTransition`.
        // Sans lui, le PATCH générique affichait « Sortie du stock » sans rien déduire.
        if (requirement.status === 'issued' && !options?.onTransition) {
          return {
            success: false,
            error: "La sortie du stock se fait depuis l'ordre de travail, qui déduit la pièce du stock.",
          };
        }

        // Transitions sensibles nécessitant une vérification d'identité stricte
        // Inclut les décisions d'annulation (cancel_requested -> approved/cancelled)
        // Note: fulfilled retiré car issued est maintenant l'état final
        const sensibleTransitions = ['approved', 'rejected', 'issued', 'received', 'cancelled'];
        
        // Pour les transitions sensibles, exiger un currentUserId valide
        if (sensibleTransitions.includes(requirement.status) && !currentUserId) {
          return { 
            success: false, 
            error: 'Identifiant utilisateur requis pour cette transition (sécurité)' 
          };
        }
        
        // Appliquer les contrôles de séparation des tâches
        const validation = PartRequirementWorkflow.validateTransition(
          current.status as PartRequirementStatus,
          requirement.status as PartRequirementStatus,
          userRole,
          {
            requesterId: current.requestedBy ?? undefined,
            currentUserId: currentUserId,
            requesterRole: current.requesterRole ?? undefined,
          }
        );

        if (!validation.valid) {
          // Dérogation de sortie: uniquement en REPLI du chemin normal, jamais
          // à sa place. Le magasin et l'admin passent par la validation
          // ordinaire et n'atteignent jamais cette branche.
          const tenteDerogationSortie =
            current.status === 'received' &&
            requirement.status === 'issued' &&
            Boolean(options?.overrideIssueReason);

          if (!tenteDerogationSortie) {
            return { success: false, error: validation.error };
          }

          const derogation = PartRequirementWorkflow.validateOverrideIssue(
            userRole,
            options?.overrideIssueReason,
          );
          if (!derogation.valid) {
            return { success: false, error: derogation.error };
          }

          // Droit retirable par l'administrateur : vérifié en base à chaque sortie,
          // pour qu'un retrait prenne effet sans attendre une nouvelle connexion.
          if (userRole === 'workshop_manager') {
            const [actor] = currentUserId
              ? await db.select({ canIssueStock: users.canIssueStock }).from(users).where(eq(users.id, currentUserId))
              : [];
            if (!actor?.canIssueStock) {
              return { success: false, error: STOCK_ISSUE_REVOKED_ERROR };
            }
          }

          overrideApplied = true;
          const motif = (options?.overrideIssueReason || '').trim();
          const acteur = currentUserId ? `utilisateur #${currentUserId}` : `rôle ${userRole}`;
          requirement.notes = this.appendAuditNote(
            (requirement.notes as string | undefined) ?? (current.notes as string | undefined),
            `[SORTIE EXCEPTIONNELLE ${new Date().toISOString()}] ${motif} (${acteur})`,
          );
        }
      }

      // Recalculer le coût estimé si la quantité ou la pièce change
      let updateData: Partial<InsertPartRequirement> & Pick<Partial<PartRequirement>, 'receivedBy'> = { ...requirement };

      // Règle métier: le flux standard passe par Procurement pour approved -> ordered.
      // Une commande directe depuis les demandes n'est autorisée qu'en mode urgence
      // avec motif obligatoire (audit).
      if (requirement.status === 'ordered' && current.status === 'approved') {
        const emergencyReason = (options?.emergencyOverrideReason || '').trim();
        if (!emergencyReason) {
          return {
            success: false,
            error:
              "Flux standard: convertir la demande en commande fournisseur via Achats. Pour une commande directe urgente, motif obligatoire.",
          };
        }

        const actorLabel = currentUserId ? `utilisateur #${currentUserId}` : `rôle ${userRole}`;
        const auditNote = `[OVERRIDE URGENCE ${new Date().toISOString()}] ${emergencyReason} (${actorLabel})`;
        updateData.notes = this.appendAuditNote(
          (updateData.notes as string | undefined) ?? (current.notes as string | undefined),
          auditNote
        );
      }
      
      if ((requirement.partId || requirement.quantityNeeded) && !requirement.estimatedCost) {
        const partId = requirement.partId || current.partId;
        const quantityNeeded = requirement.quantityNeeded || current.quantityNeeded;
        
        if (partId && quantityNeeded) {
          // Récupérer le prix unitaire de la pièce
          const [part] = await db
            .select({ unitPrice: parts.unitPrice })
            .from(parts)
            .where(eq(parts.id, partId));
            
          if (part && part.unitPrice) {
            const unitPrice = parseFloat(part.unitPrice);
            updateData.estimatedCost = (unitPrice * quantityNeeded).toString();
            log.debug({ requirementId: id, partId, quantityNeeded }, "coût estimé recalculé depuis le prix unitaire");
          }
        }
      }

      const statusChanges = Boolean(requirement.status && requirement.status !== current.status);

      if (requirement.status === 'received' && statusChanges && !updateData.actualDeliveryDate) {
        updateData.actualDeliveryDate = this.getTodayLocalDate();
      }

      // L'entrée en stock est attribuée à qui la saisit, jamais au demandeur.
      if (statusChanges && (requirement.status === 'received' || requirement.status === 'partially_received')) {
        updateData.receivedBy = currentUserId ?? null;
      }

      if (!statusChanges) {
        const [updatedRequirement] = await db
          .update(partRequirements)
          .set({ ...updateData, updatedAt: new Date() })
          .where(eq(partRequirements.id, id))
          .returning();
        return { success: true, data: updatedRequirement, overrideApplied };
      }

      // Compare-and-set : la transition ne s'applique que si le statut lu est
      // toujours celui en base. Deux requêtes simultanées ne peuvent donc pas
      // appliquer deux fois l'effet de stock.
      const updatedRequirement = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(partRequirements)
          .set({ ...updateData, updatedAt: new Date() })
          .where(and(eq(partRequirements.id, id), eq(partRequirements.status, current.status)))
          .returning();
        if (!updated) throw new StaleStatusError();

        // Rattachée à une commande non annulée : le stock est crédité par la commande, pas ici.
        // Lu après le CAS, demande verrouillée : une commande créée entre-temps est vue ici.
        if (requirement.status === 'received' || requirement.status === 'partially_received') {
          const [orderLink] = await tx
            .select({ purchaseOrderId: purchaseOrderLines.purchaseOrderId })
            .from(purchaseOrderLines)
            .innerJoin(purchaseOrders, eq(purchaseOrderLines.purchaseOrderId, purchaseOrders.id))
            .where(and(eq(purchaseOrderLines.partRequirementId, id), ne(purchaseOrders.status, 'cancelled')))
            .limit(1);
          if (orderLink) throw new OrderLinkedReceptionError(orderLink.purchaseOrderId);
        }

        const actorId = currentUserId ?? current.requestedBy;
        if (requirement.status === 'received') {
          await this.handlePartDelivery(tx, current, actorId);
        }
        if (requirement.status === 'partially_received') {
          await this.handlePartialDelivery(tx, current, actorId, requirement.quantityNeeded);
        }
        if (options?.onTransition) {
          await options.onTransition(tx, updated);
        }
        return updated;
      });

      return { success: true, data: updatedRequirement, overrideApplied };
    } catch (error) {
      if (error instanceof OrderLinkedReceptionError) {
        log.info({ requirementId: id, purchaseOrderId: error.purchaseOrderId, userId: currentUserId }, 'réception directe refusée : demande rattachée à une commande');
        return { success: false, error: ORDER_LINKED_RECEPTION_ERROR, status: 409 };
      }
      if (error instanceof StaleStatusError) {
        log.info({ requirementId: id, targetStatus: requirement.status, userId: currentUserId }, 'transition ignorée : statut déjà modifié par une autre requête');
        return { success: false, error: STALE_STATUS_ERROR };
      }
      // Le détail technique reste dans les logs ; l'écran reçoit une phrase.
      log.error({ err: error, requirementId: id, targetStatus: requirement.status, userId: currentUserId }, 'mise à jour de la demande de pièce en échec');
      return { success: false, error: "La demande n'a pas pu être mise à jour. Réessayez dans un instant." };
    }
  }

  /** Incrémente le stock et retourne [avant, après], lus atomiquement. */
  private async incrementStock(executor: DbExecutor, partId: number, quantity: number): Promise<[number, number]> {
    const [row] = await executor
      .update(parts)
      .set({ quantity: sql`${parts.quantity} + ${quantity}`, updatedAt: new Date() })
      .where(eq(parts.id, partId))
      .returning({ quantity: parts.quantity });
    const newStock = row?.quantity ?? quantity;
    return [newStock - quantity, newStock];
  }

  private async handlePartDelivery(
    executor: DbExecutor,
    requirement: PartRequirement,
    actorId: number | null,
  ): Promise<void> {
    try {
      if (!requirement.partId || !requirement.quantityNeeded) {
        log.warn({ requirementId: requirement.id }, 'Missing partId or quantityNeeded for delivery handling');
        return;
      }

      const [previousStock, newStock] = await this.incrementStock(
        executor,
        requirement.partId,
        requirement.quantityNeeded,
      );

      // Créer un mouvement de stock pour tracer l'entrée
      await executor.insert(partsStockMovements).values({
        partId: requirement.partId,
        movementType: 'in',
        quantity: requirement.quantityNeeded,
        previousStock,
        newStock,
        reason: `Réception demande #${requirement.id}`,
        notes: `Réception complète pour la demande de pièce #${requirement.id}`,
        // L'acteur qui réceptionne, pas le demandeur (AGENTS.md §9).
        createdBy: actorId
      });
      log.info(
        { requirementId: requirement.id, partId: requirement.partId, quantity: requirement.quantityNeeded, previousStock, newStock, actorId },
        'entrée en stock',
      );
    } catch (error) {
      log.error({ err: error }, 'Error handling part delivery');
      throw error;
    }
  }

  private async handlePartialDelivery(
    executor: DbExecutor,
    requirement: PartRequirement,
    actorId: number | null,
    receivedQuantity?: number,
  ): Promise<void> {
    try {
      if (!requirement.partId) {
        log.warn({ requirementId: requirement.id }, 'Missing partId for partial delivery handling');
        return;
      }

      const quantity = receivedQuantity || Math.floor((requirement.quantityNeeded || 0) / 2);
      const [previousStock, newStock] = await this.incrementStock(executor, requirement.partId, quantity);

      // Créer un mouvement de stock pour tracer l'entrée partielle
      await executor.insert(partsStockMovements).values({
        partId: requirement.partId,
        movementType: 'in',
        quantity: quantity,
        previousStock,
        newStock,
        reason: `Réception partielle demande #${requirement.id}`,
        notes: `Réception partielle: ${quantity} sur ${requirement.quantityNeeded} demandées`,
        createdBy: actorId
      });
      log.info(
        { requirementId: requirement.id, partId: requirement.partId, quantity, previousStock, newStock, actorId },
        'entrée en stock partielle',
      );
    } catch (error) {
      log.error({ err: error }, 'Error handling partial delivery');
      throw error;
    }
  }

  async deletePartRequirement(id: number): Promise<boolean> {
    try {
      await db.delete(partRequirements).where(eq(partRequirements.id, id));
      return true;
    } catch (error) {
      log.error({ err: error }, 'Error deleting part requirement');
      return false;
    }
  }

  async getRequirementsByPartId(partId: number): Promise<PartRequirement[]> {
    try {
      const requirements = await db
        .select({
          id: partRequirements.id,
          partId: partRequirements.partId,
          vehicleId: partRequirements.vehicleId,
          workOrderId: partRequirements.workOrderId,
          variantId: partRequirements.variantId,
          quantityNeeded: partRequirements.quantityNeeded,
          reason: partRequirements.reason,
          urgency: partRequirements.urgency,
          status: partRequirements.status,
          requestedBy: partRequirements.requestedBy,
          receivedBy: partRequirements.receivedBy,
          estimatedCost: partRequirements.estimatedCost,
          supplierNotes: partRequirements.supplierNotes,
          expectedDeliveryDate: partRequirements.expectedDeliveryDate,
          actualDeliveryDate: partRequirements.actualDeliveryDate,
          notes: partRequirements.notes,
          createdAt: partRequirements.createdAt,
          updatedAt: partRequirements.updatedAt,
          partName: parts.name,
          partReference: parts.reference,
          partQuantity: parts.quantity,
          partMinQuantity: parts.minQuantity,
          partCategory: parts.category,
          partSupplier: parts.supplier,
          partUnitPrice: parts.unitPrice,
          vehicleRegistration: vehicles.registrationNumber,
          requesterName: users.name,
          requesterRole: users.role,
        })
        .from(partRequirements)
        .leftJoin(parts, eq(partRequirements.partId, parts.id))
        .leftJoin(vehicles, eq(partRequirements.vehicleId, vehicles.id))
        .leftJoin(users, eq(partRequirements.requestedBy, users.id))
        .where(
          and(
            eq(partRequirements.partId, partId),
            sql`${partRequirements.status} IN ('pending', 'approved', 'ordered', 'partially_received', 'received', 'cancel_requested', 'partial')`
          )
        )
        .orderBy(desc(partRequirements.createdAt));

      return (await this.attachPurchaseOrderContext(requirements as any[])) as any;
    } catch (error) {
      log.error({ err: error }, 'Error getting requirements by part');
      return [];
    }
  }

  async getActiveRequirementsByPart(): Promise<Map<number, { status: string; urgency: string; count: number }>> {
    try {
      const requirements = await db
        .select({
          partId: partRequirements.partId,
          status: partRequirements.status,
          urgency: partRequirements.urgency,
        })
        .from(partRequirements)
        .where(
          sql`${partRequirements.status} IN ('pending', 'approved', 'ordered', 'partially_received', 'received', 'issued', 'partial')`
        );

      const partRequestMap = new Map<number, { status: string; urgency: string; count: number }>();
      
      for (const req of requirements) {
        if (!req.partId) continue;
        
        const existing = partRequestMap.get(req.partId);
        if (!existing) {
          partRequestMap.set(req.partId, { 
            status: req.status, 
            urgency: req.urgency,
            count: 1 
          });
        } else {
          existing.count++;
          // Priorité des statuts : le plus avancé s'affiche
          const statusPriority = ['issued', 'received', 'partially_received', 'partial', 'ordered', 'approved', 'pending'];
          if (statusPriority.indexOf(req.status) < statusPriority.indexOf(existing.status)) {
            existing.status = req.status;
          }
          // Priorité des urgences : la plus haute s'affiche
          const urgencyPriority = ['critical', 'high', 'medium', 'low'];
          if (urgencyPriority.indexOf(req.urgency) < urgencyPriority.indexOf(existing.urgency)) {
            existing.urgency = req.urgency;
          }
        }
      }
      
      return partRequestMap;
    } catch (error) {
      log.error({ err: error }, 'Error getting active requirements by part');
      return new Map();
    }
  }
}

export const partRequirementsService = new PartRequirementsService();
