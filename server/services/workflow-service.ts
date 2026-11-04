import { db } from "../db";
import { vehicleAcquisitionWorkflows, type VehicleAcquisitionWorkflow, type InsertVehicleAcquisitionWorkflow } from "@shared/schema";
import { eq, and } from "drizzle-orm";

/** Vrai si la session existe au nom de cet utilisateur, quel que soit son statut (rejouer une clôture reste un succès). */
export async function userOwnsWorkflowSession(userId: number, sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: vehicleAcquisitionWorkflows.id })
    .from(vehicleAcquisitionWorkflows)
    .where(and(eq(vehicleAcquisitionWorkflows.userId, userId), eq(vehicleAcquisitionWorkflows.sessionId, sessionId)))
    .limit(1);
  return Boolean(row);
}

export class WorkflowService {
  // Sauvegarder ou mettre à jour l'état du workflow
  async saveWorkflowState(data: InsertVehicleAcquisitionWorkflow): Promise<VehicleAcquisitionWorkflow> {
    // Vérifier s'il existe déjà un workflow pour cette session
    const existingWorkflow = await db
      .select()
      .from(vehicleAcquisitionWorkflows)
      .where(
        and(
          eq(vehicleAcquisitionWorkflows.userId, data.userId),
          eq(vehicleAcquisitionWorkflows.sessionId, data.sessionId),
          eq(vehicleAcquisitionWorkflows.status, 'in_progress')
        )
      );

    if (existingWorkflow.length > 0) {
      // Mettre à jour le workflow existant
      const [updated] = await db
        .update(vehicleAcquisitionWorkflows)
        .set({
          currentStep: data.currentStep,
          workflowData: data.workflowData,
          uploadedFiles: data.uploadedFiles,
          updatedAt: new Date(),
        })
        .where(eq(vehicleAcquisitionWorkflows.id, existingWorkflow[0].id))
        .returning();
      
      return updated;
    } else {
      // Créer un nouveau workflow
      const [created] = await db
        .insert(vehicleAcquisitionWorkflows)
        .values({
          userId: data.userId,
          sessionId: data.sessionId,
          currentStep: data.currentStep,
          workflowData: data.workflowData,
          uploadedFiles: data.uploadedFiles,
          // Un brouillon naît toujours en cours : la clôture passe par completeWorkflow.
          status: 'in_progress',
          updatedAt: new Date(),
        })
        .returning();
      
      return created;
    }
  }

  // Récupérer l'état du workflow pour une session donnée
  async getWorkflowState(userId: number, sessionId: string): Promise<VehicleAcquisitionWorkflow | null> {
    const workflows = await db
      .select()
      .from(vehicleAcquisitionWorkflows)
      .where(
        and(
          eq(vehicleAcquisitionWorkflows.userId, userId),
          eq(vehicleAcquisitionWorkflows.sessionId, sessionId),
          eq(vehicleAcquisitionWorkflows.status, 'in_progress')
        )
      )
      .orderBy(vehicleAcquisitionWorkflows.updatedAt);

    return workflows[0] || null;
  }

  // Marquer un workflow comme terminé
  /** Renvoie faux si la session n'est pas celle de cet utilisateur (404 côté route). */
  async completeWorkflow(userId: number, sessionId: string): Promise<boolean> {
    await db
      .update(vehicleAcquisitionWorkflows)
      .set({
        status: 'completed',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vehicleAcquisitionWorkflows.userId, userId),
          eq(vehicleAcquisitionWorkflows.sessionId, sessionId),
          eq(vehicleAcquisitionWorkflows.status, 'in_progress')
        )
      );
    return userOwnsWorkflowSession(userId, sessionId);
  }

  // Mettre à jour seulement les données du workflow (pour sauvegarde progressive)
  async updateWorkflowState(userId: number, sessionId: string, data: Partial<VehicleAcquisitionWorkflow>): Promise<VehicleAcquisitionWorkflow | null> {
    const [updated] = await db
      .update(vehicleAcquisitionWorkflows)
      .set({
        // Liste blanche : ni statut, ni propriétaire, ni session ne se réécrivent ici.
        ...(data.currentStep !== undefined && { currentStep: data.currentStep }),
        ...(data.workflowData !== undefined && { workflowData: data.workflowData }),
        ...(data.uploadedFiles !== undefined && { uploadedFiles: data.uploadedFiles }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vehicleAcquisitionWorkflows.userId, userId),
          eq(vehicleAcquisitionWorkflows.sessionId, sessionId),
          eq(vehicleAcquisitionWorkflows.status, 'in_progress')
        )
      )
      .returning();
    
    return updated || null;
  }

  // Abandonner un workflow
  /** Renvoie faux si la session n'est pas celle de cet utilisateur (404 côté route). */
  async abandonWorkflow(userId: number, sessionId: string): Promise<boolean> {
    await db
      .update(vehicleAcquisitionWorkflows)
      .set({
        status: 'abandoned',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vehicleAcquisitionWorkflows.userId, userId),
          eq(vehicleAcquisitionWorkflows.sessionId, sessionId),
          eq(vehicleAcquisitionWorkflows.status, 'in_progress')
        )
      );
    return userOwnsWorkflowSession(userId, sessionId);
  }

  // Nettoyer les anciens workflows abandonnés (plus de 7 jours)
  async cleanupOldWorkflows(): Promise<void> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    await db
      .delete(vehicleAcquisitionWorkflows)
      .where(
        and(
          eq(vehicleAcquisitionWorkflows.status, 'abandoned'),
          // updatedAt < sevenDaysAgo
        )
      );
  }
}

export const workflowService = new WorkflowService();