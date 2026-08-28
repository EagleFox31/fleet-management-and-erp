import { db } from "../db";
import { partRequirements, parts, vehicles, users, partsStockMovements, purchaseOrderLines, purchaseOrders } from "@shared/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import type { PartRequirement, InsertPartRequirement } from "@shared/schema";
import { PartRequirementWorkflow, type PartRequirementStatus } from "./part-requirements-workflow";

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
      console.error('Error getting part requirement:', error);
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

      console.log(`Found ${enrichedRequirements.length} part requirements`);
      return enrichedRequirements as any;
    } catch (error) {
      console.error('Error getting part requirements:', error);
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
          console.log(`Auto-calculated estimated cost: ${unitPrice} x ${requirement.quantityNeeded} = ${estimatedCost} XAF`);
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
      console.error('Error creating part requirement:', error);
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
    }
  ): Promise<{
    success: boolean;
    data?: PartRequirement;
    error?: string;
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
      let updateData = { ...requirement };

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
            console.log(`Auto-recalculated estimated cost: ${unitPrice} x ${quantityNeeded} = ${updateData.estimatedCost} XAF`);
          }
        }
      }

      // Si le statut change vers "received", mettre à jour le stock
      if (requirement.status === 'received' && current.status !== 'received') {
        if (!updateData.actualDeliveryDate) {
          updateData.actualDeliveryDate = this.getTodayLocalDate();
        }
        await this.handlePartDelivery(current);
      }
      
      // Gestion de la réception partielle
      if (requirement.status === 'partially_received' && current.status !== 'partially_received') {
        await this.handlePartialDelivery(current, requirement.quantityNeeded);
      }

      const [updatedRequirement] = await db
        .update(partRequirements)
        .set({
          ...updateData,
          updatedAt: new Date()
        })
        .where(eq(partRequirements.id, id))
        .returning();
      
      return { success: true, data: updatedRequirement, overrideApplied };
    } catch (error) {
      console.error('Error updating part requirement:', error);
      return { success: false, error: 'Erreur lors de la mise à jour de la demande' };
    }
  }

  private async handlePartDelivery(requirement: PartRequirement): Promise<void> {
    try {
      if (!requirement.partId || !requirement.quantityNeeded) {
        console.error('Missing partId or quantityNeeded for delivery handling');
        return;
      }

      console.log(`Handling delivery for part ${requirement.partId}, quantity: ${requirement.quantityNeeded}`);

      // Récupérer le stock actuel avant mise à jour
      const [currentPart] = await db
        .select({ quantity: parts.quantity })
        .from(parts)
        .where(eq(parts.id, requirement.partId));
      
      const previousStock = currentPart?.quantity || 0;

      // Mettre à jour le stock de la pièce
      await db
        .update(parts)
        .set({
          quantity: sql`quantity + ${requirement.quantityNeeded}`
        })
        .where(eq(parts.id, requirement.partId));

      const newStock = previousStock + requirement.quantityNeeded;

      // Créer un mouvement de stock pour tracer l'entrée
      await db.insert(partsStockMovements).values({
        partId: requirement.partId,
        movementType: 'in',
        quantity: requirement.quantityNeeded,
        previousStock,
        newStock,
        reason: `Réception demande #${requirement.id}`,
        notes: `Réception complète pour la demande de pièce #${requirement.id}`,
        createdBy: requirement.requestedBy
      });

      console.log(`✅ Stock updated for part ${requirement.partId}: +${requirement.quantityNeeded} units`);

    } catch (error) {
      console.error('Error handling part delivery:', error);
      throw error;
    }
  }

  private async handlePartialDelivery(requirement: PartRequirement, receivedQuantity?: number): Promise<void> {
    try {
      if (!requirement.partId) {
        console.error('Missing partId for partial delivery handling');
        return;
      }

      const quantity = receivedQuantity || Math.floor((requirement.quantityNeeded || 0) / 2);
      
      console.log(`Handling partial delivery for part ${requirement.partId}, quantity: ${quantity}`);

      // Récupérer le stock actuel avant mise à jour
      const [currentPart] = await db
        .select({ quantity: parts.quantity })
        .from(parts)
        .where(eq(parts.id, requirement.partId));
      
      const previousStock = currentPart?.quantity || 0;

      // Mettre à jour le stock de la pièce
      await db
        .update(parts)
        .set({
          quantity: sql`quantity + ${quantity}`
        })
        .where(eq(parts.id, requirement.partId));

      const newStock = previousStock + quantity;

      // Créer un mouvement de stock pour tracer l'entrée partielle
      await db.insert(partsStockMovements).values({
        partId: requirement.partId,
        movementType: 'in',
        quantity: quantity,
        previousStock,
        newStock,
        reason: `Réception partielle demande #${requirement.id}`,
        notes: `Réception partielle: ${quantity} sur ${requirement.quantityNeeded} demandées`,
        createdBy: requirement.requestedBy
      });

      console.log(`✅ Partial stock updated for part ${requirement.partId}: +${quantity} units`);

    } catch (error) {
      console.error('Error handling partial delivery:', error);
      throw error;
    }
  }

  async deletePartRequirement(id: number): Promise<boolean> {
    try {
      await db.delete(partRequirements).where(eq(partRequirements.id, id));
      return true;
    } catch (error) {
      console.error('Error deleting part requirement:', error);
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
      console.error('Error getting requirements by part:', error);
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
      console.error('Error getting active requirements by part:', error);
      return new Map();
    }
  }
}

export const partRequirementsService = new PartRequirementsService();
