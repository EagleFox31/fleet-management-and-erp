import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Clock, FileText, Settings, CheckSquare, Play, Upload, Calendar, ArrowRight, ArrowLeft } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useLocation } from 'wouter';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface VehicleData {
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
  mileage: number;
  status: string;
}

interface WorkflowStep {
  id: number;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  status: 'pending' | 'in_progress' | 'completed';
  estimatedTime: string;
}

interface VehicleAcquisitionWorkflowProps {
  vehicleData: VehicleData;
  onComplete: (vehicleId: number) => void;
  onCancel: () => void;
}

export function VehicleAcquisitionWorkflow({ vehicleData, onComplete, onCancel }: VehicleAcquisitionWorkflowProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1); // On commence à l'étape 2 car l'étape 1 (formulaire) est déjà terminée
  const [workflowData, setWorkflowData] = useState({
    // Étape 2: Validation VIN
    vinValidated: false,
    vinValidationResult: null,
    
    // Étape 3: Documents
    documents: {
      carteGrise: null as File | null,
      assurance: null as File | null,
      visiteTechnique: null as File | null,
      facturAchat: null as File | null,
    },
    documentsUploaded: false,
    
    // Étape 4: Maintenance
    maintenanceScheduled: false,
    firstMaintenanceDate: '',
    maintenanceType: 'preventive',
    
    // Étape 5: Activation
    activated: false,
  });

  const steps: WorkflowStep[] = [
    {
      id: 1,
      title: 'Informations du Véhicule',
      description: 'Données techniques et administratives saisies',
      icon: CheckCircle,
      status: 'completed', // Déjà terminé via le formulaire
      estimatedTime: '5 min',
    },
    {
      id: 2,
      title: 'Validation VIN',
      description: 'Vérification du numéro de châssis',
      icon: CheckSquare,
      status: currentStep === 1 ? 'in_progress' : currentStep > 1 ? 'completed' : 'pending',
      estimatedTime: '2 min',
    },
    {
      id: 3,
      title: 'Documents Obligatoires',
      description: 'Téléchargement carte grise, assurance, contrôle technique',
      icon: FileText,
      status: currentStep === 2 ? 'in_progress' : currentStep > 2 ? 'completed' : 'pending',
      estimatedTime: '5 min',
    },
    {
      id: 4,
      title: 'Planification Maintenance',
      description: 'Configuration du calendrier de maintenance préventive',
      icon: Settings,
      status: currentStep === 3 ? 'in_progress' : currentStep > 3 ? 'completed' : 'pending',
      estimatedTime: '3 min',
    },
    {
      id: 5,
      title: 'Activation du Véhicule',
      description: 'Mise en service et intégration dans la flotte',
      icon: Play,
      status: currentStep === 4 ? 'in_progress' : currentStep > 4 ? 'completed' : 'pending',
      estimatedTime: '1 min',
    },
  ];

  const getStepIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'in_progress':
        return <Clock className="h-5 w-5 text-blue-600" />;
      default:
        return <div className="h-5 w-5 rounded-full border-2 border-gray-300" />;
    }
  };

  const getStepBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-100 text-green-800 border-green-300">Terminé</Badge>;
      case 'in_progress':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-300">En cours</Badge>;
      case 'pending':
        return <Badge variant="secondary">En attente</Badge>;
      default:
        return null;
    }
  };

  const progress = ((currentStep + 1) / steps.length) * 100;

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Workflow terminé - créer le véhicule et rediriger
      await completeWorkflow();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const completeWorkflow = async () => {
    try {
      // Créer le véhicule avec les données du formulaire
      const response = await fetch('/api/vehicles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vehicleData),
      });

      if (!response.ok) {
        throw new Error('Erreur lors de la création du véhicule');
      }

      const createdVehicle = await response.json();
      
      toast({
        title: "Workflow d'acquisition terminé",
        description: "Le véhicule a été intégré avec succès dans votre flotte.",
      });
      
      onComplete(createdVehicle.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Erreur lors de la finalisation du workflow.",
      });
    }
  };

  const handleFileUpload = (documentType: keyof typeof workflowData.documents, file: File) => {
    setWorkflowData(prev => ({
      ...prev,
      documents: {
        ...prev.documents,
        [documentType]: file
      }
    }));
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1: // Validation VIN
        return workflowData.vinValidated;
      case 2: // Documents
        return Object.values(workflowData.documents).some(doc => doc !== null);
      case 3: // Maintenance
        return workflowData.maintenanceScheduled;
      case 4: // Activation
        return true;
      default:
        return false;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 1: // Validation VIN
        return (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-800 mb-2">Validation du numéro VIN</h4>
              <p className="text-sm text-blue-700 mb-3">
                VIN détecté: <span className="font-mono bg-white px-2 py-1 rounded">{vehicleData.vin || 'Non renseigné'}</span>
              </p>
            </div>
            
            <div className="space-y-3">
              <Button 
                onClick={() => setWorkflowData(prev => ({ ...prev, vinValidated: true }))}
                disabled={workflowData.vinValidated}
                className="w-full"
              >
                {workflowData.vinValidated ? 'VIN Validé ✓' : 'Valider le VIN'}
              </Button>
              
              {workflowData.vinValidated && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-sm text-green-700">✓ VIN validé avec succès</p>
                </div>
              )}
            </div>
          </div>
        );

      case 2: // Documents
        return (
          <div className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <h4 className="font-semibold text-yellow-800 mb-2">Documents obligatoires</h4>
              <p className="text-sm text-yellow-700">
                Téléchargez les documents nécessaires pour la mise en service du véhicule.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { key: 'carteGrise', label: 'Carte Grise', required: true },
                { key: 'assurance', label: 'Assurance', required: true },
                { key: 'visiteTechnique', label: 'Contrôle Technique', required: false },
                { key: 'facturAchat', label: 'Facture d\'Achat', required: false },
              ].map((doc) => (
                <div key={doc.key} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="font-medium">{doc.label}</Label>
                    {doc.required && <Badge variant="destructive" className="text-xs">Obligatoire</Badge>}
                  </div>
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(doc.key as keyof typeof workflowData.documents, file);
                    }}
                    className="text-sm"
                  />
                  {workflowData.documents[doc.key as keyof typeof workflowData.documents] && (
                    <p className="text-xs text-green-600 mt-1">✓ Fichier téléchargé</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        );

      case 3: // Maintenance
        return (
          <div className="space-y-4">
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
              <h4 className="font-semibold text-purple-800 mb-2">Planification de la maintenance</h4>
              <p className="text-sm text-purple-700">
                Configurez le calendrier de maintenance préventive pour ce véhicule.
              </p>
            </div>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="maintenanceDate">Date de première maintenance</Label>
                <Input
                  id="maintenanceDate"
                  type="date"
                  value={workflowData.firstMaintenanceDate}
                  onChange={(e) => setWorkflowData(prev => ({ 
                    ...prev, 
                    firstMaintenanceDate: e.target.value,
                    maintenanceScheduled: !!e.target.value
                  }))}
                />
              </div>
              
              {workflowData.maintenanceScheduled && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <p className="text-sm text-green-700">✓ Maintenance planifiée</p>
                </div>
              )}
            </div>
          </div>
        );

      case 4: // Activation
        return (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <h4 className="font-semibold text-green-800 mb-2">Activation du véhicule</h4>
              <p className="text-sm text-green-700">
                Votre véhicule est prêt à être intégré dans la flotte active.
              </p>
            </div>
            
            <div className="bg-gray-50 rounded-lg p-4">
              <h5 className="font-medium mb-2">Récapitulatif</h5>
              <div className="text-sm space-y-1">
                <p><span className="font-medium">Véhicule:</span> {vehicleData.brand} {vehicleData.model}</p>
                <p><span className="font-medium">Immatriculation:</span> {vehicleData.registrationNumber}</p>
                <p><span className="font-medium">VIN:</span> {workflowData.vinValidated ? 'Validé' : 'Non validé'}</p>
                <p><span className="font-medium">Documents:</span> {Object.values(workflowData.documents).filter(Boolean).length} fichier(s)</p>
                <p><span className="font-medium">Maintenance:</span> {workflowData.maintenanceScheduled ? 'Planifiée' : 'Non planifiée'}</p>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* En-tête du workflow */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h2 className="text-xl font-semibold text-green-800 mb-2">
          Workflow d'Acquisition en Cours
        </h2>
        <p className="text-green-700 text-sm">
          Continuez le processus d'intégration pour votre véhicule {vehicleData.brand} {vehicleData.model}
        </p>
      </div>

      {/* Barre de progression */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Progression</h3>
              <span className="text-sm text-muted-foreground">
                Étape {currentStep + 2} sur {steps.length}
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Liste des étapes */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Étapes du workflow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {steps.map((step, index) => {
              const StepIcon = step.icon;
              return (
                <div 
                  key={step.id} 
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    step.status === 'in_progress' 
                      ? 'border-blue-200 bg-blue-50' 
                      : step.status === 'completed'
                      ? 'border-green-200 bg-green-50'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {getStepIcon(step.status)}
                    <StepIcon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">{step.title}</p>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStepBadge(step.status)}
                    <span className="text-xs text-muted-foreground">{step.estimatedTime}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Contenu de l'étape actuelle */}
      <Card>
        <CardHeader>
          <CardTitle>{steps[currentStep + 1]?.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {renderStepContent()}
        </CardContent>
        
        {/* Actions */}
        <CardContent className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={onCancel}
                size="sm"
              >
                Annuler le workflow
              </Button>
              
              {currentStep > 0 && (
                <Button 
                  variant="outline" 
                  onClick={handlePrevious}
                  size="sm"
                >
                  <ArrowLeft className="h-4 w-4 mr-1" />
                  Précédent
                </Button>
              )}
            </div>
            
            <Button 
              onClick={handleNext}
              disabled={!canProceed()}
              size="sm"
              className="bg-green-600 hover:bg-green-700"
            >
              {currentStep === steps.length - 2 ? 'Terminer' : 'Suivant'}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}