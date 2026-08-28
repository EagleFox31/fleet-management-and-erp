import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { reconstructWorkflowState, determineCurrentStep, enrichWorkflowData } from '@/utils/workflow-mapping';

interface VehicleAcquisitionData {
  registrationNumber: string;
  brand: string;
  model: string;
  year: number;
  vin: string;
  vehicleType: string;
  tonnage: number;
  axleCount: number;
  engineSpec: string;
  purchaseDate: string;
  purchasePrice: number;
  fuelType: string;
  status: string;
  mileage: number;
  nextMaintenanceDate: string;
  nextMaintenanceMileage: number;
  licensePlateExpiry: string;
  insuranceExpiry: string;
  technicalInspectionDate: string;
  notes: string;
  vinValidated: boolean;
  vinValidationResult?: any;
  documents: {
    carteGrise: File | null;
    assurance: File | null;
    visiteTechnique: File | null;
    facturAchat: File | null;
  };
  documentsUploaded: boolean;
  maintenanceScheduled: boolean;
  firstMaintenanceDate: string;
  maintenanceType: string;
  activated: boolean;
}

const defaultData: VehicleAcquisitionData = {
  registrationNumber: "",
  brand: "",
  model: "",
  year: new Date().getFullYear(),
  vin: "",
  vehicleType: "tracteur",
  tonnage: 0,
  axleCount: 2,
  engineSpec: "",
  purchaseDate: "",
  purchasePrice: 0,
  fuelType: "diesel",
  status: "operational",
  mileage: 0,
  nextMaintenanceDate: "",
  nextMaintenanceMileage: 0,
  licensePlateExpiry: "",
  insuranceExpiry: "",
  technicalInspectionDate: "",
  notes: "",
  vinValidated: false,
  vinValidationResult: null,
  documents: {
    carteGrise: null,
    assurance: null,
    visiteTechnique: null,
    facturAchat: null,
  },
  documentsUploaded: false,
  maintenanceScheduled: false,
  firstMaintenanceDate: "",
  maintenanceType: "preventive",
  activated: false,
};

export function useWorkflowPersistence(resumeSessionId?: string) {
  const [sessionId] = useState(() => 
    resumeSessionId || `acquisition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  );
  const [data, setData] = useState<VehicleAcquisitionData>(defaultData);
  const [currentStep, setCurrentStep] = useState(1);
  const hydratedFromServer = useRef(false);

  // Charger l'état sauvegardé au démarrage
  const { data: savedWorkflow, isLoading } = useQuery<any>({
    queryKey: [`/api/workflows/vehicle-acquisition/${sessionId}`],
    enabled: !!sessionId,
    retry: false,
  });

  // Mutation pour sauvegarder l'état avec PATCH
  const saveMutation = useMutation({
    mutationFn: async (workflowData: any) => {
      const response = await fetch(`/api/workflows/vehicle-acquisition/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify(workflowData),
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        // Si PATCH échoue, essayer POST pour créer
        const createResponse = await fetch('/api/workflows/vehicle-acquisition', {
          method: 'POST',
          body: JSON.stringify(workflowData),
          headers: {
            'Content-Type': 'application/json',
          },
        });
        if (!createResponse.ok) throw new Error('Erreur de sauvegarde');
        return createResponse.json();
      }
      return response.json();
    },
  });

  // Charger les données sauvegardées une seule fois (évite de régresser l'étape au refetch)
  useEffect(() => {
    if (!savedWorkflow || hydratedFromServer.current) return;
    if (typeof savedWorkflow !== 'object' || !('workflowData' in savedWorkflow)) return;

    hydratedFromServer.current = true;
    const reconstructedState = reconstructWorkflowState(savedWorkflow);

    if (reconstructedState) {
      setData(reconstructedState.data as VehicleAcquisitionData);
      setCurrentStep(reconstructedState.currentStep);
    } else {
      setData(enrichWorkflowData(savedWorkflow.workflowData) as VehicleAcquisitionData);
      setCurrentStep((savedWorkflow as any).currentStep || 1);
    }
  }, [savedWorkflow]);

  // Sauvegarder automatiquement à chaque changement
  const saveWorkflow = useCallback(
    (newData: VehicleAcquisitionData, step: number) => {
      const workflowToSave = {
        sessionId,
        currentStep: step,
        workflowData: newData,
        uploadedFiles: null, // TODO: gérer les fichiers uploadés
      };

      console.log('💾 Sauvegarde workflow:', { sessionId, step, hasData: !!newData });
      saveMutation.mutate(workflowToSave);
    },
    [sessionId, saveMutation]
  );

  // Fonction pour forcer la sauvegarde immédiate (pour les clics "Suivant")
  const saveCurrentState = useCallback(
    () => {
      console.log('🔄 Sauvegarde forcée avant changement d\'étape');
      saveWorkflow(data, currentStep);
    },
    [data, currentStep, saveWorkflow]
  );

  // Fonction pour mettre à jour les données avec sauvegarde automatique et auto-détection de l'étape
  const updateData = useCallback(
    (updater: (prev: VehicleAcquisitionData) => VehicleAcquisitionData) => {
      setData(prev => {
        const newData = updater(prev);
        
        // Auto-détection de l'étape basée sur les données complétées
        const detectedStep = determineCurrentStep(newData);
        const nextStep = Math.max(currentStep, detectedStep);

        if (nextStep !== currentStep) {
          setCurrentStep(nextStep);
        }

        setTimeout(() => saveWorkflow(newData, nextStep), 500);
        return newData;
      });
    },
    [saveWorkflow, currentStep]
  );

  // Fonction pour changer d'étape avec sauvegarde
  const updateStep = useCallback(
    (newStep: number, dataSnapshot?: VehicleAcquisitionData) => {
      setCurrentStep(newStep);
      if (dataSnapshot) {
        setData(dataSnapshot);
      }
      saveWorkflow(dataSnapshot ?? data, newStep);
    },
    [data, saveWorkflow]
  );

  // Fonction pour marquer le workflow comme terminé
  const completeWorkflow = useCallback(async () => {
    try {
      const response = await fetch(`/api/workflows/vehicle-acquisition/${sessionId}/complete`, {
        method: 'PATCH',
      });
      if (!response.ok) throw new Error('Erreur de finalisation');
    } catch (error) {
      console.error('Erreur lors de la finalisation du workflow:', error);
    }
  }, [sessionId]);

  // Fonction pour abandonner le workflow
  const abandonWorkflow = useCallback(async () => {
    try {
      const response = await fetch(`/api/workflows/vehicle-acquisition/${sessionId}/abandon`, {
        method: 'PATCH',
      });
      if (!response.ok) throw new Error('Erreur d\'abandon');
    } catch (error) {
      console.error('Erreur lors de l\'abandon du workflow:', error);
    }
  }, [sessionId]);

  return {
    data,
    currentStep,
    sessionId,
    isLoading,
    isSaving: saveMutation.isPending,
    updateData,
    updateStep,
    completeWorkflow,
    abandonWorkflow,
    setData, // Pour compatibilité avec le code existant
    setCurrentStep, // Pour compatibilité avec le code existant
    saveCurrentState
  };
}
