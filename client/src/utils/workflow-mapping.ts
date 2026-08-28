// Utilitaires pour la correspondance entre les étapes du workflow et les données sauvegardées

/** Formate une date API (ISO ou YYYY-MM-DD) pour un input type="date". */
export function normalizeDateForInput(value?: string | null): string {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed.slice(0, 10);
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Complète les champs dérivés (ex. date maintenance workflow ← fiche véhicule). */
export function enrichWorkflowData(workflowData: any) {
  if (!workflowData || typeof workflowData !== 'object') return workflowData;
  const nextMaintenanceDate = normalizeDateForInput(workflowData.nextMaintenanceDate);
  const firstMaintenanceDate = normalizeDateForInput(
    workflowData.firstMaintenanceDate || workflowData.nextMaintenanceDate,
  );
  return {
    ...workflowData,
    nextMaintenanceDate,
    firstMaintenanceDate,
  };
}

export interface WorkflowStepMapping {
  stepNumber: number;
  stepName: string;
  requiredFields: string[];
  completionCriteria: (data: any) => boolean;
  description: string;
}

export const WORKFLOW_STEPS: WorkflowStepMapping[] = [
  {
    stepNumber: 1,
    stepName: "Informations Véhicule",
    requiredFields: ["registrationNumber", "brand", "model", "vin"],
    completionCriteria: (data) => 
      data.registrationNumber && 
      data.brand && 
      data.model && 
      data.vin,
    description: "Saisie des données de base du véhicule"
  },
  {
    stepNumber: 2,
    stepName: "Validation VIN",
    requiredFields: ["vinValidated"],
    completionCriteria: (data) => data.vinValidated === true,
    description: "Vérification et validation du numéro VIN"
  },
  {
    stepNumber: 3,
    stepName: "Upload Documents",
    requiredFields: ["documentsUploaded"],
    completionCriteria: (data) => data.documentsUploaded === true,
    description: "Téléchargement des documents obligatoires"
  },
  {
    stepNumber: 4,
    stepName: "Planification Maintenance",
    requiredFields: ["maintenanceScheduled", "firstMaintenanceDate"],
    completionCriteria: (data) => 
      data.maintenanceScheduled === true && 
      data.firstMaintenanceDate,
    description: "Configuration de la maintenance préventive"
  },
  {
    stepNumber: 5,
    stepName: "Activation",
    requiredFields: ["activated"],
    completionCriteria: (data) => data.activated === true,
    description: "Activation finale du véhicule dans la flotte"
  }
];

/**
 * Détermine l'étape actuelle du workflow basée sur les données sauvegardées
 */
export function determineCurrentStep(workflowData: any): number {
  if (!workflowData) return 1;

  // Parcourir les étapes dans l'ordre inverse pour trouver la dernière étape complétée
  for (let i = WORKFLOW_STEPS.length - 1; i >= 0; i--) {
    const step = WORKFLOW_STEPS[i];
    if (step.completionCriteria(workflowData)) {
      // Si cette étape est complétée, la prochaine étape est la suivante
      return Math.min(step.stepNumber + 1, WORKFLOW_STEPS.length);
    }
  }

  // Si aucune étape n'est complétée, commencer à l'étape 1
  return 1;
}

/**
 * Reconstruit l'état du workflow depuis les données de la base
 */
export function reconstructWorkflowState(dbWorkflow: any) {
  if (!dbWorkflow) return null;

  const { workflowData, currentStep: savedStep } = dbWorkflow;
  const enrichedData = enrichWorkflowData(workflowData);
  
  // Déterminer l'étape minimale atteinte via les données complétées
  const calculatedStep = determineCurrentStep(enrichedData);
  
  // Ne jamais régresser sous l'étape sauvegardée (position utilisateur)
  const actualStep = Math.max(savedStep || 1, calculatedStep);
  
  return {
    currentStep: actualStep,
    data: enrichedData,
    sessionId: dbWorkflow.sessionId,
    status: dbWorkflow.status,
    lastUpdated: dbWorkflow.updatedAt
  };
}