import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useWorkflowPersistence } from '@/hooks/use-workflow-persistence';
import { apiRequest } from '@/lib/queryClient';
import { uploadFile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { normalizeDateForInput } from '@/utils/workflow-mapping';
import { CheckCircle, Circle, Upload, AlertCircle, Truck, FileText, Wrench, Play, Save, Loader2 } from 'lucide-react';

type DocumentKey = keyof VehicleAcquisitionData['documents'];
type DocumentUploadStatus = 'idle' | 'uploading' | 'success' | 'error';

const WORKFLOW_DOCUMENTS: Array<{
  key: DocumentKey;
  label: string;
  apiType: string;
  required: boolean;
}> = [
  { key: 'carteGrise', label: 'Carte Grise', apiType: 'carte_grise', required: true },
  { key: 'assurance', label: "Certificat d'Assurance", apiType: 'assurance', required: true },
  { key: 'visiteTechnique', label: 'Visite Technique', apiType: 'visite_technique', required: true },
  { key: 'facturAchat', label: "Facture d'Achat (optionnel)", apiType: 'factur_achat', required: false },
];

interface VehicleAcquisitionData {
  // Étape 1: Informations véhicule
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
  
  // Étape 2: Validation VIN
  vinValidated: boolean;
  vinValidationResult?: any;
  
  // Étape 3: Documents
  documents: {
    carteGrise: File | null;
    assurance: File | null;
    visiteTechnique: File | null;
    facturAchat: File | null;
  };
  documentsUploaded: boolean;
  
  // Étape 4: Maintenance
  maintenanceScheduled: boolean;
  firstMaintenanceDate: string;
  maintenanceType: string;
  
  // Étape 5: Activation
  activated: boolean;
}

export function VehicleAcquisitionWorkflow() {
  const [loading, setLoading] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState<DocumentKey | null>(null);
  const [docUploadStatus, setDocUploadStatus] = useState<Partial<Record<DocumentKey, DocumentUploadStatus>>>({});
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  // Récupérer les paramètres depuis l'URL
  const urlParams = new URLSearchParams(window.location.search);
  const resumeSessionId = urlParams.get('resumeSession');
  const vehicleId = urlParams.get('vehicleId');
  
  // Utiliser le hook de persistence des workflows avec possibilité de reprise
  const {
    data,
    currentStep,
    sessionId,
    isLoading,
    isSaving,
    updateData,
    updateStep,
    completeWorkflow,
    abandonWorkflow,
    setData,
    setCurrentStep,
    saveCurrentState,
  } = useWorkflowPersistence(resumeSessionId || undefined);

  // Charger les données du véhicule si un ID est fourni
  const { data: vehicleData } = useQuery<any>({
    queryKey: [`/api/vehicles/${vehicleId}`],
    enabled: !!vehicleId,
  });

  const { data: savedWorkflow } = useQuery<any>({
    queryKey: [`/api/workflows/vehicle-acquisition/${sessionId}`],
    enabled: !!sessionId,
    retry: false,
  });

  // Pré-remplir les données quand le véhicule est chargé
  useEffect(() => {
    if (vehicleData && typeof vehicleData === 'object' && 'registrationNumber' in vehicleData) {
      updateData(prev => ({
        ...prev,
        registrationNumber: (vehicleData as any).registrationNumber || '',
        brand: (vehicleData as any).brand || '',
        model: (vehicleData as any).model || '',
        year: (vehicleData as any).year || new Date().getFullYear(),
        vin: (vehicleData as any).vin || '',
        vehicleType: (vehicleData as any).vehicleType || 'tracteur',
        tonnage: (vehicleData as any).tonnage || 0,
        axleCount: (vehicleData as any).axleCount || 2,
        engineSpec: (vehicleData as any).engineSpec || '',
        purchaseDate: (vehicleData as any).purchaseDate || '',
        purchasePrice: (vehicleData as any).purchasePrice ? parseFloat((vehicleData as any).purchasePrice) : 0,
        fuelType: (vehicleData as any).fuelType || 'diesel',
        status: (vehicleData as any).status || 'operational',
        mileage: (vehicleData as any).mileage || 0,
        nextMaintenanceDate: normalizeDateForInput((vehicleData as any).nextMaintenanceDate),
        nextMaintenanceMileage: (vehicleData as any).nextMaintenanceMileage || 0,
        firstMaintenanceDate: normalizeDateForInput(
          (vehicleData as any).nextMaintenanceDate || prev.firstMaintenanceDate,
        ),
      }));
    }
  }, [vehicleData, updateData]);

  const { toast } = useToast();

  const steps = [
    { 
      id: 1, 
      title: 'Informations Véhicule', 
      icon: Truck,
      description: 'Récapitulatif des données saisies',
      completed: data.registrationNumber && data.brand && data.model && data.vin
    },
    { 
      id: 2, 
      title: 'Validation VIN', 
      icon: CheckCircle,
      description: 'Vérification et validation du numéro VIN',
      completed: data.vinValidated
    },
    { 
      id: 3, 
      title: 'Documents Obligatoires', 
      icon: FileText,
      description: 'Upload des documents nécessaires',
      completed: data.documentsUploaded
    },
    { 
      id: 4, 
      title: 'Planification Maintenance', 
      icon: Wrench,
      description: 'Programmation de la première maintenance',
      completed: data.maintenanceScheduled
    },
    { 
      id: 5, 
      title: 'Activation Flotte', 
      icon: Play,
      description: 'Mise en service du véhicule',
      completed: data.activated
    },
  ];

  const currentStepData = steps.find(step => step.id === currentStep);
  const completedSteps = steps.filter(step => step.completed).length;
  const progress = (completedSteps / steps.length) * 100;

  const normalizeVin = (value: string) =>
    value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '').slice(0, 17);

  const handleVinChange = (rawValue: string) => {
    const vin = normalizeVin(rawValue);
    updateData(prev => ({
      ...prev,
      vin,
      vinValidated: false,
      vinValidationResult: null,
    }));
  };

  const validateVIN = async () => {
    if (!data.vin || data.vin.length !== 17) {
      toast({
        title: "Erreur VIN",
        description: "Le VIN doit contenir exactement 17 caractères",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      // Validation basique du format VIN
      const vinRegex = /^[A-HJ-NPR-Z0-9]{17}$/;
      if (vinRegex.test(data.vin)) {
        if (vehicleId) {
          await apiRequest('PATCH', `/api/vehicles/${vehicleId}`, { vin: data.vin });
          await queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${vehicleId}`] });
        }

        const newVinData = {
          ...data,
          vinValidated: true,
          vinValidationResult: {
            valid: true,
            manufacturer: data.brand,
            year: data.year,
            checkDigit: true
          }
        };
        updateStep(3, newVinData);
        toast({
          title: "VIN Validé",
          description: "Le numéro VIN est valide et cohérent",
        });
      } else {
        toast({
          title: "VIN Invalide",
          description: "Le format du VIN n'est pas correct",
          variant: "destructive"
        });
      }
    } catch (error) {
      toast({
        title: "Erreur de validation",
        description: "Impossible de valider le VIN",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentSelect = async (documentKey: DocumentKey, file: File) => {
    const docConfig = WORKFLOW_DOCUMENTS.find((doc) => doc.key === documentKey);
    if (!docConfig) return;

    setUploadingDoc(documentKey);
    setDocUploadStatus((prev) => ({ ...prev, [documentKey]: 'uploading' }));
    updateData((prev) => ({
      ...prev,
      documents: { ...prev.documents, [documentKey]: file },
      documentsUploaded: false,
    }));

    try {
      if (vehicleId) {
        const formData = new FormData();
        formData.append('document', file);
        formData.append('name', docConfig.label);
        formData.append('type', docConfig.apiType);
        await uploadFile(`/api/vehicles/${vehicleId}/documents`, formData);
        await queryClient.invalidateQueries({ queryKey: [`/api/vehicles/${vehicleId}/documents`] });
      } else if (savedWorkflow?.id) {
        const formData = new FormData();
        formData.append('document', file);
        formData.append('documentType', docConfig.apiType);
        formData.append('workflowId', String(savedWorkflow.id));
        await uploadFile(`/api/workflows/${sessionId}/documents`, formData);
        await queryClient.invalidateQueries({ queryKey: [`/api/workflows/${sessionId}/documents`] });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      setDocUploadStatus((prev) => ({ ...prev, [documentKey]: 'success' }));
      toast({
        title: 'Document importé',
        description: `${docConfig.label} — ${file.name}`,
      });
    } catch {
      setDocUploadStatus((prev) => ({ ...prev, [documentKey]: 'error' }));
      updateData((prev) => ({
        ...prev,
        documents: { ...prev.documents, [documentKey]: null },
      }));
      toast({
        title: "Erreur d'import",
        description: `Impossible d'importer ${docConfig.label}. Réessayez.`,
        variant: 'destructive',
      });
    } finally {
      setUploadingDoc(null);
    }
  };

  const uploadDocuments = async () => {
    const requiredDocs = WORKFLOW_DOCUMENTS.filter((doc) => doc.required);
    const missingDocs = requiredDocs.filter(
      (doc) => docUploadStatus[doc.key] !== 'success' && !data.documents[doc.key],
    );
    const stillUploading = requiredDocs.some((doc) => docUploadStatus[doc.key] === 'uploading');

    if (stillUploading || uploadingDoc) {
      toast({
        title: 'Import en cours',
        description: 'Patientez pendant le téléchargement des documents.',
      });
      return;
    }

    if (missingDocs.length > 0) {
      toast({
        title: 'Documents manquants',
        description: `Veuillez fournir : ${missingDocs.map((doc) => doc.label).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    const failedDocs = requiredDocs.filter((doc) => docUploadStatus[doc.key] === 'error');
    if (failedDocs.length > 0) {
      toast({
        title: 'Import incomplet',
        description: `Réimportez : ${failedDocs.map((doc) => doc.label).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      updateStep(4, { ...data, documentsUploaded: true });
      toast({
        title: 'Documents enregistrés',
        description: 'Tous les documents obligatoires ont été importés.',
      });
    } finally {
      setLoading(false);
    }
  };

  const scheduleMaintenance = async () => {
    const maintenanceDate = normalizeDateForInput(
      data.firstMaintenanceDate || data.nextMaintenanceDate,
    );

    if (!maintenanceDate) {
      toast({
        title: "Date manquante",
        description: "Veuillez sélectionner une date de maintenance",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const updatedData = {
        ...data,
        firstMaintenanceDate: maintenanceDate,
        maintenanceScheduled: true,
        nextMaintenanceDate: maintenanceDate,
      };

      updateStep(5, updatedData);
      toast({
        title: "Maintenance programmée",
        description: `Première maintenance programmée le ${new Date(maintenanceDate).toLocaleDateString('fr-FR')}`,
      });
    } catch (error) {
      toast({
        title: "Erreur de planification",
        description: "Impossible de programmer la maintenance",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const activateVehicle = async () => {
    setLoading(true);
    try {
      // Créer le véhicule en base avec toutes les données complètes
      const vehicleData = {
        registrationNumber: data.registrationNumber,
        brand: data.brand,
        model: data.model,
        year: data.year,
        vin: data.vin,
        vehicleType: data.vehicleType,
        tonnage: data.tonnage,
        axleCount: data.axleCount,
        engineSpec: data.engineSpec,
        purchaseDate: data.purchaseDate,
        purchasePrice: data.purchasePrice,
        fuelType: data.fuelType,
        status: data.status || 'operational',
        mileage: data.mileage || 0,
        licensePlateExpiry: data.licensePlateExpiry,
        insuranceExpiry: data.insuranceExpiry,
        technicalInspectionDate: data.technicalInspectionDate,
        nextMaintenanceDate: data.firstMaintenanceDate || data.nextMaintenanceDate || '',
        nextMaintenanceMileage: data.nextMaintenanceMileage || undefined,
        notes: data.notes,
      };

      // Appel API pour créer le véhicule avec workflow complet
      const response = await fetch('/api/vehicles/activate-from-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleData,
          workflowData: {
            ...data,
            sessionId,
            documents: data.documents,
            maintenanceScheduled: data.maintenanceScheduled,
            firstMaintenanceDate: data.firstMaintenanceDate,
            maintenanceType: data.maintenanceType,
            nextMaintenanceDate: data.nextMaintenanceDate,
            nextMaintenanceMileage: data.nextMaintenanceMileage,
          }
        }),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la création du véhicule');
      }

      updateData(prev => ({ ...prev, activated: true }));
      
      // Invalider tous les caches nécessaires pour mise à jour temps réel
      await queryClient.invalidateQueries({ queryKey: ['/api/vehicles'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/workflows/active'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/workflows/stats'] });
      await queryClient.invalidateQueries({ queryKey: ['/api/statistics/fleet'] });
      
      // Marquer le workflow comme terminé
      await completeWorkflow();
      
      toast({
        title: "Véhicule activé",
        description: `${data.brand} ${data.model} (${data.registrationNumber}) est maintenant actif dans la flotte`,
      });

      // Redirection vers la fiche avec proposition pneus (choix C — « Plus tard » possible)
      setLocation(
        `/vehicles/${encodeURIComponent(data.registrationNumber)}?tiresPrompt=1`,
      );
      
    } catch (error) {
      toast({
        title: "Erreur d'activation",
        description: "Impossible d'activer le véhicule",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const nextStep = () => {
    if (currentStep < steps.length) {
      // Sauvegarder l'état actuel avant de passer à l'étape suivante
      saveCurrentState();
      updateStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      // Sauvegarder l'état actuel avant de revenir à l'étape précédente
      saveCurrentState();
      updateStep(currentStep - 1);
    }
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* En-tête du workflow */}
      <div className="text-center space-y-2 bg-green-50 border border-green-200 rounded-lg p-6">
        <h1 className="text-2xl font-bold text-green-800">Acquisition de Véhicule</h1>
        <p className="text-green-700">
          Processus guidé d'intégration d'un nouveau véhicule dans la flotte
        </p>
      </div>

      {/* Barre de progression */}
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span>Progression</span>
              <span>{completedSteps}/{steps.length} étapes complétées</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Navigation des étapes */}
      <div className="flex justify-center">
        <div className="flex space-x-4 overflow-x-auto pb-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.id === currentStep;
            const isCompleted = step.completed;
            
            return (
              <div
                key={step.id}
                className={`flex flex-col items-center space-y-2 p-3 rounded-lg min-w-[140px] cursor-pointer transition-colors ${
                  isActive 
                    ? 'bg-primary/10 border-2 border-primary' 
                    : isCompleted 
                    ? 'bg-green-50 border border-green-200' 
                    : 'bg-gray-50 border border-gray-200'
                }`}
                onClick={() => updateStep(step.id)}
              >
                <div className={`p-2 rounded-full ${
                  isActive 
                    ? 'bg-primary text-white' 
                    : isCompleted 
                    ? 'bg-green-500 text-white' 
                    : 'bg-gray-300 text-gray-600'
                }`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-center">
                  <div className="text-xs font-medium">{step.title}</div>
                  <div className="text-xs text-muted-foreground">{step.description}</div>
                </div>
                {isCompleted && (
                  <Badge variant="secondary" className="text-xs">
                    Terminé
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Contenu de l'étape actuelle */}
      <Card>
        <CardHeader className="bg-green-50 border-b border-green-200">
          <CardTitle className="flex items-center gap-2 text-green-800">
            {currentStepData && <currentStepData.icon className="h-5 w-5" />}
            Étape {currentStep}: {currentStepData?.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {/* Étape 1: Récapitulatif et démarrage du workflow */}
          {currentStep === 1 && (
            <div className="space-y-8">
              {/* Message d'accueil */}
              <div className="text-center space-y-4">
                <Truck className="h-16 w-16 text-green-600 mx-auto" />
                <h3 className="text-2xl font-bold text-green-800">Workflow d'Acquisition de Véhicule</h3>
                <p className="text-muted-foreground max-w-2xl mx-auto">
                  Les informations de base de votre véhicule ont été enregistrées. 
                  Nous allons maintenant procéder aux étapes de validation et d'intégration.
                </p>
              </div>

              {/* Récapitulatif des informations saisies */}
              <div className="bg-green-50 dark:bg-green-950/20 p-6 rounded-lg border border-green-100 dark:border-green-900/30">
                <h3 className="text-lg font-medium mb-4 text-green-800 dark:text-green-200">Récapitulatif des informations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">Immatriculation:</span>
                    <span>{data.registrationNumber || 'Non saisie'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Marque:</span>
                    <span>{data.brand || 'Non saisie'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Modèle:</span>
                    <span>{data.model || 'Non saisi'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Année:</span>
                    <span>{data.year || 'Non saisie'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Type:</span>
                    <span className="capitalize">{data.vehicleType || 'Non saisi'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Carburant:</span>
                    <span className="capitalize">{data.fuelType || 'Non saisi'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Statut initial:</span>
                    <span>
                      {data.status === 'maintenance'
                        ? 'En maintenance'
                        : data.status === 'out_of_service'
                          ? 'Hors service'
                          : 'Opérationnel'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Kilométrage:</span>
                    <span>{data.mileage || 0} km</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Prochaine maintenance (km):</span>
                    <span>{data.nextMaintenanceMileage || 'Non défini'}</span>
                  </div>
                  {data.vin && (
                    <div className="flex justify-between md:col-span-2">
                      <span className="font-medium">VIN:</span>
                      <span className="font-mono text-xs">{data.vin}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Étapes à suivre */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h4 className="font-semibold text-blue-800 mb-3">Prochaines étapes du workflow</h4>
                <ul className="text-sm text-blue-700 space-y-2">
                  <li className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-blue-600" />
                    Validation du numéro VIN
                  </li>
                  <li className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    Upload des documents obligatoires
                  </li>
                  <li className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-blue-600" />
                    Planification de la première maintenance
                  </li>
                  <li className="flex items-center gap-2">
                    <Play className="h-4 w-4 text-blue-600" />
                    Activation dans la flotte
                  </li>
                </ul>
              </div>

              {/* Bouton pour poursuivre */}
              <div className="text-center">
                <Button 
                  onClick={() => updateStep(2)}
                  size="lg"
                  className="px-8 py-3 text-lg bg-green-600 hover:bg-green-700"
                >
                  <Play className="h-5 w-5 mr-2" />
                  Poursuivre l'enregistrement
                </Button>
              </div>
            </div>
          )}

          {/* Étape 2: Validation VIN */}
          {currentStep === 2 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-medium">Validation du VIN</h3>
                <p className="text-muted-foreground">
                  Vérification de la validité et de la cohérence du numéro VIN
                </p>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="workflow-vin">VIN à valider</Label>
                    <Input
                      id="workflow-vin"
                      value={data.vin || ''}
                      onChange={(e) => handleVinChange(e.target.value)}
                      placeholder="17 caractères (sans I, O, Q)"
                      className="font-mono uppercase"
                      maxLength={17}
                      disabled={loading}
                    />
                    <p className="text-xs text-muted-foreground">
                      {data.vin?.length ?? 0}/17 caractères — modifiable ici avant validation
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Marque:</span>
                    <span>{data.brand || 'Non saisie'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Modèle:</span>
                    <span>{data.model || 'Non saisi'}</span>
                  </div>
                </div>

                {data.vinValidated && (
                  <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">VIN validé avec succès</span>
                    </div>
                  </div>
                )}

                <Button 
                  onClick={validateVIN} 
                  disabled={loading || !data.vin}
                  className="w-full"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Valider le VIN
                </Button>
              </div>
            </div>
          )}

          {/* Étape 3: Documents Obligatoires */}
          {currentStep === 3 && (
            <div className="space-y-6 w-full">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-medium">Documents Obligatoires</h3>
                <p className="text-muted-foreground">
                  Upload des documents nécessaires pour l'activation du véhicule
                </p>
              </div>

              <div className="space-y-4 w-full">
                <div className="grid grid-cols-2 gap-4 w-full">
                  {WORKFLOW_DOCUMENTS.map(({ key, label, required }) => {
                  const status = docUploadStatus[key] ?? (data.documents[key] ? 'success' : 'idle');
                  const file = data.documents[key];
                  const isUploading = status === 'uploading' || uploadingDoc === key;
                  const fileName = file instanceof File ? file.name : typeof file === 'object' && file && 'name' in file ? String((file as { name?: string }).name) : null;
                  const fileSizeKb = file instanceof File && file.size > 0 ? Math.max(1, Math.round(file.size / 1024)) : null;

                  return (
                    <div
                      key={key}
                      className={cn(
                        'relative border border-dashed rounded-lg p-4 transition-colors h-full min-h-[140px] flex flex-col',
                        status === 'success' && 'border-green-400 bg-green-50/50',
                        status === 'error' && 'border-red-400 bg-red-50/50',
                        isUploading && 'border-primary/50 bg-primary/5',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex flex-col gap-1 min-w-0">
                          <span className="font-medium text-sm leading-tight">{label}</span>
                          {required && (
                            <Badge variant="outline" className="text-xs w-fit">Obligatoire</Badge>
                          )}
                        </div>
                        <div className="shrink-0">
                        {status === 'success' && <CheckCircle className="h-5 w-5 text-green-500" />}
                        {status === 'error' && <AlertCircle className="h-5 w-5 text-red-500" />}
                        {isUploading && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
                        </div>
                      </div>

                      {fileName && status === 'success' && (
                        <p className="text-xs text-muted-foreground mb-2 truncate">
                          {fileName}{fileSizeKb ? ` (${fileSizeKb} Ko)` : ''}
                        </p>
                      )}

                      {status === 'error' && (
                        <p className="text-xs text-red-600 mb-2">Échec de l'import — sélectionnez à nouveau le fichier.</p>
                      )}

                      <Input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        disabled={isUploading}
                        className="mt-auto"
                        onChange={(e) => {
                          const selectedFile = e.target.files?.[0];
                          if (selectedFile) {
                            void handleDocumentSelect(key, selectedFile);
                          }
                          e.target.value = '';
                        }}
                      />

                      {isUploading && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-background/80 backdrop-blur-[1px]">
                          <Loader2 className="h-8 w-8 animate-spin text-primary mb-2" />
                          <p className="text-sm font-medium text-primary">Import en cours…</p>
                          <p className="text-xs text-muted-foreground mt-1">Ne fermez pas cette page</p>
                        </div>
                      )}
                    </div>
                  );
                  })}
                </div>

                {data.documentsUploaded && (
                  <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Documents importés avec succès</span>
                    </div>
                  </div>
                )}

                <Button
                  onClick={uploadDocuments}
                  disabled={loading || !!uploadingDoc}
                  className="w-full"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Continuer
                </Button>
              </div>
            </div>
          )}

          {/* Étape 4: Planification Maintenance */}
          {currentStep === 4 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-medium">Planification Maintenance</h3>
                <p className="text-muted-foreground">
                  Programmation de la première maintenance préventive
                </p>
              </div>

              <div className="space-y-4">
                {(data.nextMaintenanceDate || data.nextMaintenanceMileage > 0) && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                    <p className="font-medium mb-1">Déjà renseigné à la création du véhicule</p>
                    <ul className="text-blue-700 space-y-0.5 text-xs">
                      {data.nextMaintenanceDate && (
                        <li>Prochaine maintenance (date) : {new Date(data.nextMaintenanceDate).toLocaleDateString('fr-FR')}</li>
                      )}
                      {data.nextMaintenanceMileage > 0 && (
                        <li>Prochaine maintenance (km) : {data.nextMaintenanceMileage.toLocaleString('fr-FR')} km</li>
                      )}
                    </ul>
                    <p className="text-xs text-blue-600 mt-2">
                      Confirmez ou ajustez la date ci-dessous, puis choisissez le type d'intervention.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="firstMaintenanceDate">Date de première maintenance</Label>
                  <Input
                    id="firstMaintenanceDate"
                    type="date"
                    value={normalizeDateForInput(data.firstMaintenanceDate || data.nextMaintenanceDate)}
                    onChange={(e) => updateData(prev => ({
                      ...prev,
                      firstMaintenanceDate: e.target.value,
                      maintenanceScheduled: false,
                    }))}
                    min={new Date().toISOString().split('T')[0]}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="maintenanceType">Type de maintenance</Label>
                  <Select value={data.maintenanceType} onValueChange={(value) => updateData(prev => ({ ...prev, maintenanceType: value }))}>
                    <SelectTrigger>
                      <SelectValue placeholder="Sélectionner le type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="preventive">Préventive Standard</SelectItem>
                      <SelectItem value="complete">Révision Complète</SelectItem>
                      <SelectItem value="inspection">Inspection Technique</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {data.maintenanceScheduled && (
                  <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Maintenance programmée avec succès</span>
                    </div>
                  </div>
                )}

                <Button 
                  onClick={scheduleMaintenance} 
                  disabled={loading || !(data.firstMaintenanceDate || data.nextMaintenanceDate)}
                  className="w-full"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Programmer la maintenance
                </Button>
              </div>
            </div>
          )}

          {/* Étape 5: Activation Flotte */}
          {currentStep === 5 && (
            <div className="space-y-6 max-w-2xl mx-auto">
              <div className="text-center space-y-2">
                <h3 className="text-lg font-medium">Activation Flotte</h3>
                <p className="text-muted-foreground">
                  Finalisation et mise en service du véhicule
                </p>
              </div>

              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
                  <h4 className="font-semibold text-blue-800 mb-2">Récapitulatif final</h4>
                  <div className="text-sm text-blue-700 space-y-1">
                    <div>✓ Véhicule: {data.brand} {data.model} ({data.registrationNumber})</div>
                    <div>✓ VIN validé: {data.vin}</div>
                    <div>✓ Documents téléchargés</div>
                    <div>✓ Maintenance programmée le {data.firstMaintenanceDate && new Date(data.firstMaintenanceDate).toLocaleDateString('fr-FR')}</div>
                  </div>
                </div>

                {data.activated && (
                  <div className="bg-green-50 border border-green-200 p-4 rounded-lg">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle className="h-5 w-5" />
                      <span className="font-medium">Véhicule activé avec succès</span>
                    </div>
                  </div>
                )}

                <Button 
                  onClick={activateVehicle} 
                  disabled={loading}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Activer le véhicule dans la flotte
                </Button>
              </div>
            </div>
          )}

          {/* Navigation entre étapes */}
          <div className="flex justify-between mt-8">
            <Button 
              variant="outline" 
              onClick={prevStep}
              disabled={currentStep === 1 || loading}
            >
              Précédent
            </Button>
            
            <Button 
              onClick={nextStep} 
              disabled={currentStep === steps.length || !currentStepData?.completed || loading}
            >
              Suivant
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
