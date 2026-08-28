import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, Clock, AlertCircle, Truck, FileText, Settings, CheckSquare, Play } from 'lucide-react';
import { useLocation } from 'wouter';

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

interface WorkflowStep {
  id: number;
  title: string;
  description: string;
  icon: React.ComponentType<any>;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  estimatedTime: string;
  required: boolean;
}

interface VehicleAcquisitionWizardProps {
  onComplete?: (data: VehicleAcquisitionData) => void;
  embedded?: boolean;
}

export function VehicleAcquisitionWizard({ onComplete, embedded = false }: VehicleAcquisitionWizardProps) {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<VehicleAcquisitionData>({
    registrationNumber: '',
    brand: '',
    model: '',
    year: new Date().getFullYear(),
    vin: '',
    vehicleType: 'tracteur',
    tonnage: 0,
    axleCount: 2,
    engineSpec: '',
    purchaseDate: '',
    purchasePrice: 0,
    fuelType: 'diesel',
    
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
    firstMaintenanceDate: '',
    maintenanceType: 'preventive',
    
    activated: false,
  });

  const steps: WorkflowStep[] = [
    {
      id: 1,
      title: 'Informations du Véhicule',
      description: 'Saisie des données techniques et administratives',
      icon: Truck,
      status: currentStep === 0 ? 'in_progress' : currentStep > 0 ? 'completed' : 'pending',
      estimatedTime: '5 min',
      required: true,
    },
    {
      id: 2,
      title: 'Validation VIN',
      description: 'Vérification du numéro de châssis',
      icon: CheckSquare,
      status: currentStep === 1 ? 'in_progress' : currentStep > 1 ? 'completed' : 'pending',
      estimatedTime: '2 min',
      required: true,
    },
    {
      id: 3,
      title: 'Documents Obligatoires',
      description: 'Téléchargement carte grise, assurance, contrôle technique',
      icon: FileText,
      status: currentStep === 2 ? 'in_progress' : currentStep > 2 ? 'completed' : 'pending',
      estimatedTime: '5 min',
      required: true,
    },
    {
      id: 4,
      title: 'Planification Maintenance',
      description: 'Configuration du calendrier de maintenance préventive',
      icon: Settings,
      status: currentStep === 3 ? 'in_progress' : currentStep > 3 ? 'completed' : 'pending',
      estimatedTime: '3 min',
      required: true,
    },
    {
      id: 5,
      title: 'Activation du Véhicule',
      description: 'Mise en service et intégration dans la flotte',
      icon: Play,
      status: currentStep === 4 ? 'in_progress' : currentStep > 4 ? 'completed' : 'pending',
      estimatedTime: '1 min',
      required: true,
    },
  ];

  const getStepIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'in_progress':
        return <Clock className="h-5 w-5 text-blue-600" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
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

  const progress = ((currentStep) / (steps.length - 1)) * 100;

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // Workflow terminé
      if (onComplete) {
        onComplete(data);
      }
      if (!embedded) {
        setLocation('/vehicles');
      }
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0: // Informations véhicule
        return data.registrationNumber && data.brand && data.model && data.year;
      case 1: // Validation VIN
        return data.vinValidated;
      case 2: // Documents
        return data.documentsUploaded;
      case 3: // Maintenance
        return data.maintenanceScheduled;
      case 4: // Activation
        return true;
      default:
        return false;
    }
  };

  const handleSkipStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const startWorkflow = () => {
    setLocation('/workflows/vehicle-acquisition');
  };

  if (!embedded) {
    // Mode complet - affichage de la vue d'ensemble
    return (
      <div className="container mx-auto py-6 space-y-6">
        {/* En-tête du workflow */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-4">
            <Truck className="h-8 w-8 text-green-600" />
            <div>
              <h1 className="text-2xl font-bold text-green-800">
                Workflow d'Acquisition de Véhicule
              </h1>
              <p className="text-green-700">
                Processus guidé pour intégrer un nouveau véhicule dans votre flotte
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-4 text-sm text-green-700">
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Durée estimée: 15-20 minutes
            </span>
            <span>•</span>
            <span>5 étapes obligatoires</span>
          </div>
        </div>

        {/* Barre de progression */}
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Progression du workflow</h3>
                <span className="text-sm text-muted-foreground">
                  Étape {currentStep + 1} sur {steps.length}
                </span>
              </div>
              <Progress value={progress} className="h-2" />
            </div>
          </CardContent>
        </Card>

        {/* Liste des étapes */}
        <div className="grid gap-4">
          {steps.map((step, index) => {
            const StepIcon = step.icon;
            return (
              <Card 
                key={step.id} 
                className={`transition-all ${
                  step.status === 'in_progress' 
                    ? 'border-blue-200 bg-blue-50' 
                    : step.status === 'completed'
                    ? 'border-green-200 bg-green-50'
                    : ''
                }`}
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {getStepIcon(step.status)}
                        <StepIcon className="h-5 w-5 text-muted-foreground" />
                      </div>
                      
                      <div>
                        <h4 className="font-semibold">{step.title}</h4>
                        <p className="text-sm text-muted-foreground">{step.description}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Durée estimée: {step.estimatedTime}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {getStepBadge(step.status)}
                      {step.required && (
                        <Badge variant="outline" className="text-xs">
                          Obligatoire
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Actions */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold mb-2">Prêt à commencer ?</h3>
                <p className="text-sm text-muted-foreground">
                  Ce workflow vous guidera étape par étape pour l'intégration complète d'un nouveau véhicule.
                </p>
              </div>
              
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setLocation('/workflows')}>
                  Retour aux workflows
                </Button>
                <Button onClick={startWorkflow} className="bg-green-600 hover:bg-green-700">
                  Démarrer le workflow
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Mode intégré - affichage simplifié pour la page d'ajout de véhicule
  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-green-800">
          <Truck className="h-5 w-5" />
          Workflow d'Acquisition Guidé
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <h4 className="font-semibold text-green-800 mb-2">
            Processus d'intégration recommandé
          </h4>
          <p className="text-sm text-green-700 mb-3">
            Suivez notre workflow guidé pour une intégration complète et conforme de votre nouveau véhicule.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-3 w-3 text-green-600" />
              <span>Validation des informations techniques</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-3 w-3 text-green-600" />
              <span>Vérification VIN automatique</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-3 w-3 text-green-600" />
              <span>Gestion des documents obligatoires</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-3 w-3 text-green-600" />
              <span>Planification maintenance préventive</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            <Clock className="h-4 w-4 inline mr-1" />
            Durée estimée: 15-20 minutes
          </div>
          
          <Button 
            onClick={startWorkflow}
            className="bg-green-600 hover:bg-green-700"
            size="sm"
          >
            Démarrer le workflow guidé
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}