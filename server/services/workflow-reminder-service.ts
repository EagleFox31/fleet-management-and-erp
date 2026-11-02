import { db } from '../db';
import { vehicleAcquisitionWorkflows } from '@shared/schema';
import { eq, and, ne, desc, count, gte } from 'drizzle-orm';

interface ActiveWorkflow {
  id: number;
  sessionId: string;
  currentStep: number;
  workflowData: any;
  vehicleInfo: {
    registrationNumber: string;
    brand: string;
    model: string;
    vin: string;
  };
  progress: number;
  timeInfo: {
    daysElapsed: number;
    isRecent: boolean;
    isStale: boolean;
    lastActivity: string;
  };
  createdAt: string;
  updatedAt: string;
}

interface WorkflowStats {
  total: number;
  inProgress: number;
  completed: number;
  abandoned: number;
  thisMonth: number;
}

class WorkflowReminderService {
  async getActiveWorkflowsForUser(userId: number): Promise<ActiveWorkflow[]> {
    try {
      // Récupérer tous les workflows actifs (non terminés et non abandonnés)
      const workflows = await db
        .select()
        .from(vehicleAcquisitionWorkflows)
        .where(
          and(
            eq(vehicleAcquisitionWorkflows.userId, userId),
            ne(vehicleAcquisitionWorkflows.status, 'completed'),
            ne(vehicleAcquisitionWorkflows.status, 'abandoned')
          )
        )
        .orderBy(desc(vehicleAcquisitionWorkflows.updatedAt));

      return workflows.map(workflow => this.transformWorkflowToActiveWorkflow(workflow));
    } catch (error) {
      console.error('Error fetching active workflows:', error);
      return [];
    }
  }

  async getWorkflowStatsForUser(userId: number): Promise<WorkflowStats> {
    try {
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Compter tous les workflows
      const [totalResult] = await db
        .select({ count: count() })
        .from(vehicleAcquisitionWorkflows)
        .where(eq(vehicleAcquisitionWorkflows.userId, userId));

      // Compter les workflows en cours
      const [inProgressResult] = await db
        .select({ count: count() })
        .from(vehicleAcquisitionWorkflows)
        .where(
          and(
            eq(vehicleAcquisitionWorkflows.userId, userId),
            eq(vehicleAcquisitionWorkflows.status, 'in_progress')
          )
        );

      // Compter les workflows terminés
      const [completedResult] = await db
        .select({ count: count() })
        .from(vehicleAcquisitionWorkflows)
        .where(
          and(
            eq(vehicleAcquisitionWorkflows.userId, userId),
            eq(vehicleAcquisitionWorkflows.status, 'completed')
          )
        );

      // Compter les workflows abandonnés
      const [abandonedResult] = await db
        .select({ count: count() })
        .from(vehicleAcquisitionWorkflows)
        .where(
          and(
            eq(vehicleAcquisitionWorkflows.userId, userId),
            eq(vehicleAcquisitionWorkflows.status, 'abandoned')
          )
        );

      // Compter les acquisitions terminées ce mois
      const [thisMonthResult] = await db
        .select({ count: count() })
        .from(vehicleAcquisitionWorkflows)
        .where(
          and(
            eq(vehicleAcquisitionWorkflows.userId, userId),
            eq(vehicleAcquisitionWorkflows.status, 'completed'),
            gte(vehicleAcquisitionWorkflows.completedAt, startOfMonth)
          )
        );

      return {
        total: totalResult?.count || 0,
        inProgress: inProgressResult?.count || 0,
        completed: completedResult?.count || 0,
        abandoned: abandonedResult?.count || 0,
        thisMonth: thisMonthResult?.count || 0,
      };
    } catch (error) {
      console.error('Error fetching workflow stats:', error);
      return {
        total: 0,
        inProgress: 0,
        completed: 0,
        abandoned: 0,
        thisMonth: 0,
      };
    }
  }

  async abandonWorkflow(userId: number, sessionId: string): Promise<boolean> {
    try {
      const result = await db
        .update(vehicleAcquisitionWorkflows)
        .set({
          status: 'abandoned',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(vehicleAcquisitionWorkflows.userId, userId),
            eq(vehicleAcquisitionWorkflows.sessionId, sessionId),
            // Un sessionId peut porter une ligne completed : on n'abandonne que le brouillon.
            eq(vehicleAcquisitionWorkflows.status, 'in_progress')
          )
        );

      return true;
    } catch (error) {
      console.error('Error abandoning workflow:', error);
      return false;
    }
  }

  private transformWorkflowToActiveWorkflow(workflow: any): ActiveWorkflow {
    const now = new Date();
    const updatedAt = new Date(workflow.updatedAt);
    const daysElapsed = Math.floor((now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24));
    
    // Calculer le progrès basé sur l'étape actuelle et les données complétées
    const progress = this.calculateProgress(workflow.currentStep, workflow.workflowData);
    
    // Extraire les informations du véhicule depuis workflowData
    const vehicleInfo = {
      registrationNumber: workflow.workflowData?.registrationNumber || 'Non défini',
      brand: workflow.workflowData?.brand || 'Non défini',
      model: workflow.workflowData?.model || 'Non défini',
      vin: workflow.workflowData?.vin || 'Non défini',
    };

    return {
      id: workflow.id,
      sessionId: workflow.sessionId,
      currentStep: workflow.currentStep,
      workflowData: workflow.workflowData,
      vehicleInfo,
      progress,
      timeInfo: {
        daysElapsed,
        isRecent: daysElapsed <= 1,
        isStale: daysElapsed >= 7,
        lastActivity: this.formatLastActivity(daysElapsed),
      },
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    };
  }

  private calculateProgress(currentStep: number, workflowData: any): number {
    // Calculer le progrès basé sur l'étape et les données complétées
    const totalSteps = 5;
    let baseProgress = ((currentStep - 1) / totalSteps) * 100;
    
    // Ajuster le progrès basé sur les données complétées dans l'étape actuelle
    if (workflowData) {
      switch (currentStep) {
        case 1: // Informations véhicule
          const step1Fields = ['registrationNumber', 'brand', 'model', 'year', 'vin'];
          const step1Completed = step1Fields.filter(field => workflowData[field]).length;
          baseProgress += (step1Completed / step1Fields.length) * (100 / totalSteps);
          break;
        case 2: // Validation VIN
          if (workflowData.vinValidated) {
            baseProgress += (100 / totalSteps);
          }
          break;
        case 3: // Documents
          if (workflowData.documentsUploaded) {
            baseProgress += (100 / totalSteps);
          }
          break;
        case 4: // Maintenance
          if (workflowData.maintenanceScheduled) {
            baseProgress += (100 / totalSteps);
          }
          break;
        case 5: // Activation
          if (workflowData.activated) {
            baseProgress += (100 / totalSteps);
          }
          break;
      }
    }
    
    return Math.min(Math.round(baseProgress), 100);
  }

  private formatLastActivity(daysElapsed: number): string {
    if (daysElapsed === 0) return "Aujourd'hui";
    if (daysElapsed === 1) return "Hier";
    if (daysElapsed < 7) return `Il y a ${daysElapsed} jours`;
    if (daysElapsed < 30) return `Il y a ${Math.floor(daysElapsed / 7)} semaine${Math.floor(daysElapsed / 7) > 1 ? 's' : ''}`;
    return `Il y a ${Math.floor(daysElapsed / 30)} mois`;
  }
}

export const workflowReminderService = new WorkflowReminderService();
