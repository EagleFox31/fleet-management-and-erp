import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useWorkflowPersistence } from "@/hooks/use-workflow-persistence";
import { useAuth } from "@/hooks/useAuth";
import { canWriteVehiclePurchasePrice } from "@shared/constants/roles";
import { CardShell, SectionLabel } from "@/components/design-system";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { vehicleDraft } from "@/lib/form-drafts";
import { Check, ClipboardList, FileText, Wrench, Play } from "lucide-react";

// Create schema for vehicle form validation
const vehicleFormSchema = z.object({
  registrationNumber: z.string().min(1, "Numéro d'immatriculation requis"),
  brand: z.string().min(1, "Marque requise"),
  model: z.string().min(1, "Modèle requis"),
  vehicleType: z.enum(["tracteur", "porteur", "semi_remorque", "remorque", "utilitaire", "autre"]),
  year: z.coerce.number().min(1900, "Année invalide").max(new Date().getFullYear() + 1, "Année future invalide"),
  mileage: z.coerce.number().min(0, "Kilométrage invalide"),
  tonnage: z.coerce.number().min(0, "Tonnage invalide").optional(),
  axleCount: z.coerce.number().min(0, "Nombre d'essieux invalide").optional(),
  engineSpec: z.string().optional(),
  vin: z.string().optional(),
  fuelType: z.enum(["diesel", "petrol", "electric", "hybrid", "other"]),
  status: z.enum(["operational", "maintenance", "out_of_service"]),
  purchaseDate: z.string().optional(),
  purchasePrice: z.coerce.number().min(0, "Prix d'achat invalide").optional(), // pas de maximum pour être réaliste
  nextMaintenanceDate: z.string().optional(),
  nextMaintenanceMileage: z.coerce.number().min(0, "Kilométrage invalide").optional(),
  licensePlateExpiry: z.string().optional(),
  insuranceExpiry: z.string().optional(),
  technicalInspectionDate: z.string().optional(),
  notes: z.string().optional(),
});

type VehicleFormValues = z.infer<typeof vehicleFormSchema>;

interface VehicleFormProps {
  initialData?: Partial<VehicleFormValues>;
  isEdit?: boolean;
  vehicleId?: number;
}

export function VehicleForm({ initialData, isEdit = false, vehicleId }: VehicleFormProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showWorkflow, setShowWorkflow] = useState(false);
  const [vehicleData, setVehicleData] = useState<VehicleFormValues | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  
  // Utiliser le hook de persistence des workflows seulement en mode création
  const workflowHook = useWorkflowPersistence(!isEdit ? undefined : 'skip');
  const { 
    data: workflowData, 
    updateData: updateWorkflowData, 
    sessionId, 
    saveCurrentState,
    isSaving 
  } = workflowHook || { data: {}, updateData: () => {}, sessionId: null, saveCurrentState: () => {}, isSaving: false };
  
  // Prix d'achat : lisible par admin, logistique et secrétariat seulement (décision du 3 novembre 2026).
  // Les autres rôles ne voient pas le champ, et la valeur n'est pas renvoyée au PATCH.
  const { user: currentUser } = useAuth();
  // Le champ n'est offert qu'aux rôles qui peuvent écrire le prix : le serveur refuse la clé aux autres.
  const canSeePurchasePrice = canWriteVehiclePurchasePrice(currentUser?.role);

  const form = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: {
      registrationNumber: initialData?.registrationNumber || "",
      brand: initialData?.brand || "",
      model: initialData?.model || "",
      vehicleType: initialData?.vehicleType || "tracteur",
      year: initialData?.year || new Date().getFullYear(),
      mileage: initialData?.mileage || 0,
      tonnage: initialData?.tonnage || undefined,
      axleCount: initialData?.axleCount || undefined,
      engineSpec: initialData?.engineSpec || "",
      vin: initialData?.vin || "",
      fuelType: initialData?.fuelType || "diesel",
      status: initialData?.status || "operational",
      purchaseDate: initialData?.purchaseDate || "",
      purchasePrice: initialData?.purchasePrice || undefined,
      nextMaintenanceDate: initialData?.nextMaintenanceDate || "",
      nextMaintenanceMileage: initialData?.nextMaintenanceMileage || 0,
      licensePlateExpiry: initialData?.licensePlateExpiry || "",
      insuranceExpiry: initialData?.insuranceExpiry || "",
      technicalInspectionDate: initialData?.technicalInspectionDate || "",
      notes: initialData?.notes || "",
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  // Creation uniquement: en edition, restaurer une saisie ancienne par-dessus
  // une fiche modifiee entre-temps ferait plus de degats qu'il n'en evite.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: vehicleDraft.storage as any,
    isEmpty: vehicleDraft.isEmpty as any,
    enabled: !isEdit,
  });
  
  const createVehicleMutation = useMutation({
    mutationFn: async (values: VehicleFormValues) => {
      const response = await apiRequest("POST", "/api/vehicles", values);
      return response.json();
    },
    onSuccess: (createdVehicle) => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      toast({
        title: "Véhicule créé avec succès",
        description: "Redirection vers le workflow d'acquisition...",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      setLocation(`/workflows/vehicle-acquisition?vehicleId=${(createdVehicle as any)?.id}`);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Erreur lors de l'ajout du véhicule."),
      });
    },
  });

  const updateVehicleMutation = useMutation({
    mutationFn: async (values: VehicleFormValues) => {
      return apiRequest("PATCH", `/api/vehicles/${vehicleId}`, values);
    },
    onSuccess: () => {
      toast({
        title: "Véhicule mis à jour",
        description: "Le véhicule a été mis à jour avec succès.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
      setLocation("/vehicles");
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Erreur lors de la mise à jour du véhicule."),
      });
    },
  });
  
  async function onSubmit(values: VehicleFormValues) {
    console.log('Form submitted with values:', values);
    if (isEdit && vehicleId) {
      // Mode édition - PATCH
      updateVehicleMutation.mutate(values);
    } else {
      // Mode création - Intégrer dans le workflow d'acquisition
      toast({
        title: "Étape 1 terminée",
        description: "Passage au workflow d'acquisition...",
      });
      
      // Créer une nouvelle session de workflow avec les données du véhicule
      const sessionId = `acquisition-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      const workflowData = {
        sessionId,
        currentStep: 1,
        workflowData: {
          registrationNumber: values.registrationNumber,
          brand: values.brand,
          model: values.model,
          year: values.year,
          vin: values.vin || '',
          vehicleType: values.vehicleType,
          tonnage: values.tonnage || 0,
          axleCount: values.axleCount || 2,
          engineSpec: values.engineSpec || '',
          purchaseDate: values.purchaseDate || '',
          // Un rôle qui ne lit pas le prix ne l'envoie pas : sans la clé, il n'écrase rien et n'écrit pas 0.
          ...(canSeePurchasePrice ? { purchasePrice: values.purchasePrice || 0 } : {}),
          fuelType: values.fuelType,
          status: values.status,
          mileage: values.mileage,
          nextMaintenanceDate: values.nextMaintenanceDate || '',
          nextMaintenanceMileage: values.nextMaintenanceMileage || 0,
          licensePlateExpiry: values.licensePlateExpiry || '',
          insuranceExpiry: values.insuranceExpiry || '',
          technicalInspectionDate: values.technicalInspectionDate || '',
          notes: values.notes || '',
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
        },
      };

      try {
        // Sauvegarder la session de workflow
        const response = await fetch('/api/workflows/vehicle-acquisition', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(workflowData),
        });

        if (!response.ok) {
          throw new Error('Erreur de sauvegarde du workflow');
        }

        // Redirection vers le workflow avec la session ID
        setLocation(`/workflows/vehicle-acquisition?resumeSession=${sessionId}`);
      } catch (error) {
        console.error('Erreur lors de la création du workflow:', error);
        toast({
          title: "Erreur",
          description: "Impossible de créer le workflow d'acquisition",
          variant: "destructive"
        });
      }
    }
  }

  const handleWorkflowComplete = async (vehicleId: number) => {
    // Le workflow a créé le véhicule, on navigue vers la liste
    toast({
      title: "Véhicule intégré avec succès",
      description: "Le workflow d'acquisition est terminé. Le véhicule est maintenant actif dans votre flotte.",
    });
    queryClient.invalidateQueries({ queryKey: ["/api/vehicles"] });
    setLocation("/vehicles");
  };

  const handleWorkflowCancel = () => {
    setShowWorkflow(false);
    setVehicleData(null);
  };
  
  // Note: Workflow intégré directement dans le formulaire avec barre de progression

  return (
    <div className="space-y-6">
      {/* Barre de progression du workflow - toujours visible */}
      {!isEdit && (
        <CardShell>
          <div className="px-5 py-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-green-800">Workflow d'Acquisition Guidé</h3>
                <span className="text-sm text-muted-foreground">
                  20% terminé
                </span>
              </div>
              
              <div className="flex items-center space-x-2">
                {[
                  { id: 1, name: 'Informations Véhicule', icon: ClipboardList, time: '2 min' },
                  { id: 2, name: 'Validation VIN', icon: Check, time: '1 min' },
                  { id: 3, name: 'Documents Obligatoires', icon: FileText, time: '3 min' },
                  { id: 4, name: 'Planification Maintenance', icon: Wrench, time: '2 min' },
                  { id: 5, name: 'Activation Flotte', icon: Play, time: '1 min' }
                ].map((step, index) => {
                  const isCompleted = index === 0;
                  const isCurrent = index === 0;
                  
                  return (
                    <div key={step.id} className="flex flex-col items-center flex-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium mb-1 ${
                        isCompleted 
                          ? 'bg-green-600 text-white' 
                          : isCurrent 
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-600'
                      }`}>
                        {isCompleted ? <Check className="h-4 w-4" aria-hidden /> : <step.icon className="h-4 w-4" aria-hidden />}
                      </div>
                      <div className="text-xs text-center">
                        <div className={`font-medium ${isCurrent ? 'text-blue-600' : isCompleted ? 'text-green-600' : 'text-gray-500'}`}>
                          {step.name}
                        </div>
                        <div className="text-gray-400">{step.time}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: '20%' }}
                ></div>
              </div>
            </div>
          </div>
        </CardShell>
      )}

      <CardShell topBar>
        <div className="px-5 py-4 border-b border-gray-100">
          <SectionLabel className="text-green-600">{isEdit ? "Vehicule" : "Acquisition"}</SectionLabel>
          <h3 className="text-base font-semibold text-gray-900 mt-1">
            {isEdit ? "Modifier le vehicule" : "Ajouter un vehicule"}
          </h3>
          {!isEdit && (
            <p className="text-sm text-muted-foreground mt-1">
              {showWorkflow ? "Workflow en cours..." : "Etape 1 : saisie des informations techniques"}
            </p>
          )}
        </div>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          {draftSavedAt && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <FormDraftBadge savedAt={draftSavedAt} />
              <FormDraftDiscardButton
                savedAt={draftSavedAt}
                onDiscard={() => discardDraft(form.getValues())}
              />
            </div>
          )}
          <div className="space-y-6 px-5 py-5">
            {/* Informations de base */}
            <div className="bg-green-50 dark:bg-green-950/20 p-6 rounded-lg border border-green-100 dark:border-green-900/30">
              <h3 className="text-lg font-medium mb-4 text-green-800 dark:text-green-200">Informations de base</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <FormField
                control={form.control}
                name="registrationNumber"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Immatriculation</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Plaque d'immatriculation du véhicule. Format standard camerounais.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - Généralement 5-7 caractères</li>
                            <li><span className="font-semibold">Exemple</span> - CE-123-AB, LT-5678-H</li>
                            <li><span className="font-semibold">Obligatoire</span> - Identifiant unique officiel</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input placeholder="AB-123-CD" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Statut</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">État actuel de disponibilité du véhicule.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold text-success">Opérationnel</span> - Disponible pour utilisation immédiate</li>
                            <li><span className="font-semibold text-warning-text">En maintenance</span> - En réparation ou révision programmée</li>
                            <li><span className="font-semibold text-destructive-text">Hors service</span> - Indisponible pour utilisation (panne, accident)</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un statut" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="operational">Opérationnel</SelectItem>
                        <SelectItem value="maintenance">En maintenance</SelectItem>
                        <SelectItem value="out_of_service">Hors service</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="vehicleType"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Type de véhicule</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Tracteur</span> - Véhicule moteur qui tracte une semi-remorque</li>
                            <li><span className="font-semibold">Porteur</span> - Camion avec caisse intégrée au châssis</li>
                            <li><span className="font-semibold">Semi-remorque</span> - Remorque sans essieu avant qui s'attelle à un tracteur</li>
                            <li><span className="font-semibold">Remorque</span> - Remorque complète avec tous ses essieux</li>
                            <li><span className="font-semibold">Utilitaire</span> - Véhicules utilitaires légers</li>
                            <li><span className="font-semibold">Autre</span> - Pour tout autre type de véhicule</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="tracteur">Tracteur</SelectItem>
                        <SelectItem value="porteur">Porteur</SelectItem>
                        <SelectItem value="semi_remorque">Semi-remorque</SelectItem>
                        <SelectItem value="remorque">Remorque</SelectItem>
                        <SelectItem value="utilitaire">Utilitaire</SelectItem>
                        <SelectItem value="autre">Autre</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Marque</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Fabricant du véhicule.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - 2-20 caractères</li>
                            <li><span className="font-semibold">Exemples</span> - Renault, Volvo, MAN, Scania, Mercedes, DAF, Iveco</li>
                            <li><span className="font-semibold">Obligatoire</span> - Information essentielle pour les pièces et l'entretien</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input placeholder="Renault, Volvo, MAN, etc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Modèle</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Modèle spécifique du véhicule.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - 2-30 caractères</li>
                            <li><span className="font-semibold">Exemples</span> - Premium, FH16, TGX, Actros, XF</li>
                            <li><span className="font-semibold">Obligatoire</span> - Nécessaire pour l'identification précise</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input placeholder="Premium, FH16, TGX, etc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="vin"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>N° de série (VIN)</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Numéro d'identification du véhicule unique, gravé sur le châssis.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - 17 caractères (standard international)</li>
                            <li><span className="font-semibold">Exemple</span> - WVWZZZ1JZXW000001</li>
                            <li><span className="font-semibold">Utilité</span> - Identification précise, traçabilité, vérification des rappels</li>
                            <li><span className="font-semibold">Emplacement</span> - Sur le châssis et documents officiels</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input placeholder="WVWZZZ1JZXW000001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
            </div>

            {/* Spécifications techniques */}
            <div className="bg-green-50 dark:bg-green-950/20 p-6 rounded-lg border border-green-100 dark:border-green-900/30">
              <h3 className="text-lg font-medium mb-4 text-green-800 dark:text-green-200">Spécifications techniques</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <FormField
                control={form.control}
                name="year"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Année</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Année de fabrication du véhicule.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - 4 chiffres (AAAA)</li>
                            <li><span className="font-semibold">Plage valide</span> - Entre 1900 et l'année suivante</li>
                            <li><span className="font-semibold">Importance</span> - Détermine la disponibilité des pièces, les normes applicables</li>
                            <li><span className="font-semibold">Obligatoire</span> - Information essentielle pour la gestion</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="mileage"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Kilométrage</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Distance totale parcourue par le véhicule en kilomètres.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - Nombre entier positif</li>
                            <li><span className="font-semibold">Utilité</span> - Planification des entretiens, évaluation de l'usure</li>
                            <li><span className="font-semibold">Mise à jour</span> - À actualiser régulièrement pour un suivi précis</li>
                            <li><span className="font-semibold">Obligatoire</span> - Essentiel pour la planification de la maintenance</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="tonnage"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Tonnage (capacité en tonnes)</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Capacité de charge maximale autorisée du véhicule en tonnes.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - Nombre décimal (0.0)</li>
                            <li><span className="font-semibold">Importance</span> - Détermine la classification et les limitations légales</li>
                            <li><span className="font-semibold">Exemple</span> - 44.0 pour un semi-remorque standard</li>
                            <li><span className="font-semibold">Options précises</span> - Pour les porteurs: 7.5, 12.0, 19.0, 26.0 tonnes</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input type="number" step="0.1" {...field} value={field.value || ''} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="axleCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nombre d'essieux</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" max="10" {...field} value={field.value || ''} onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="engineSpec"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Spécifications moteur</FormLabel>
                    <FormControl>
                      <Input placeholder="13L 500CV Euro 6" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="fuelType"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Type de carburant</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Source d'énergie utilisée par le véhicule.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Diesel</span> - Carburant le plus commun pour les camions lourds</li>
                            <li><span className="font-semibold">Essence</span> - Rare pour les poids lourds, plus courant pour les utilitaires</li>
                            <li><span className="font-semibold">Électrique</span> - Véhicules à batterie, autonomie limitée</li>
                            <li><span className="font-semibold">Hybride</span> - Combinaison moteur thermique et électrique</li>
                            <li><span className="font-semibold">Autre</span> - GNV, biocarburant, hydrogène, etc.</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un type de carburant" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="diesel">Diesel</SelectItem>
                        <SelectItem value="petrol">Essence</SelectItem>
                        <SelectItem value="electric">Électrique</SelectItem>
                        <SelectItem value="hybrid">Hybride</SelectItem>
                        <SelectItem value="other">Autre</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
            </div>

            {/* Informations administratives */}
            <div className="bg-green-50 dark:bg-green-950/20 p-6 rounded-lg border border-green-100 dark:border-green-900/30">
              <h3 className="text-lg font-medium mb-4 text-green-800 dark:text-green-200">Informations administratives</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <FormField
                control={form.control}
                name="purchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Date d'achat</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Date à laquelle le véhicule a été acquis par l'entreprise.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - JJ/MM/AAAA</li>
                            <li><span className="font-semibold">Importance</span> - Calcul de l'amortissement, suivi des coûts</li>
                            <li><span className="font-semibold">Documents associés</span> - Facture d'achat, contrat de vente</li>
                            <li><span className="font-semibold">Conseil</span> - À vérifier dans les documents officiels</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              {canSeePurchasePrice && (
                <FormField
                  control={form.control}
                  name="purchasePrice"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center">
                        <FormLabel>Prix d'achat (F CFA)</FormLabel>
                        <div className="ml-2 relative group">
                          <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                            ?
                          </div>
                          <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                            <p className="mb-1">Montant payé pour l'acquisition du véhicule en Francs CFA.</p>
                            <ul className="space-y-1">
                              <li><span className="font-semibold">Format</span> - Nombre entier sans décimale</li>
                              <li><span className="font-semibold">Importance</span> - Calcul de l'amortissement, évaluation de la flotte</li>
                              <li><span className="font-semibold">Accessibilité</span> - Visible uniquement par l'administrateur, la logistique et le secrétariat</li>
                              <li><span className="font-semibold">À inclure</span> - Prix du véhicule + taxes et frais d'immatriculation</li>
                            </ul>
                            <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                          </div>
                        </div>
                      </div>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field} 
                          value={field.value !== undefined ? Number(field.value).toString() : ''} 
                          onChange={e => field.onChange(e.target.value ? Number(e.target.value) : undefined)} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              
              <FormField
                control={form.control}
                name="licensePlateExpiry"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Expiration carte grise</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Date d'expiration du certificat d'immatriculation (carte grise).</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - JJ/MM/AAAA</li>
                            <li><span className="font-semibold">Importance</span> - Document légal obligatoire pour circuler</li>
                            <li><span className="font-semibold">Alerte</span> - Le système génère des alertes 30 jours avant expiration</li>
                            <li><span className="font-semibold">Sanction</span> - Amende et immobilisation possible du véhicule</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="insuranceExpiry"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Expiration assurance</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Date d'expiration du contrat d'assurance du véhicule.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - JJ/MM/AAAA</li>
                            <li><span className="font-semibold">Critique</span> - Circulation interdite sans assurance valide</li>
                            <li><span className="font-semibold">Alerte</span> - Notifications 30 jours avant expiration</li>
                            <li><span className="font-semibold">Risques</span> - Sanctions pénales et financières lourdes</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="technicalInspectionDate"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center">
                      <FormLabel>Date visite technique</FormLabel>
                      <div className="ml-2 relative group">
                        <div className="cursor-help w-4 h-4 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-xs shadow-sm">
                          ?
                        </div>
                        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 -translate-y-2 w-64 bg-popover text-popover-foreground text-xs rounded-md p-3 shadow-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 z-50 border">
                          <p className="mb-1">Date de la dernière inspection technique obligatoire.</p>
                          <ul className="space-y-1">
                            <li><span className="font-semibold">Format</span> - JJ/MM/AAAA</li>
                            <li><span className="font-semibold">Fréquence</span> - Tous les 6 mois pour les véhicules de transport</li>
                            <li><span className="font-semibold">Impact</span> - Détermine l'aptitude à circuler en toute sécurité</li>
                            <li><span className="font-semibold">Document</span> - Certificat d'inspection valide obligatoire</li>
                          </ul>
                          <div className="absolute w-2 h-2 bg-popover rotate-45 left-1/2 bottom-0 transform translate-y-1/2 -translate-x-1/2 border-r border-b"></div>
                        </div>
                      </div>
                    </div>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
            </div>

            {/* Maintenance */}
            <div className="bg-green-50 dark:bg-green-950/20 p-6 rounded-lg border border-green-100 dark:border-green-900/30">
              <h3 className="text-lg font-medium mb-4 text-green-800 dark:text-green-200">Maintenance</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              
              <FormField
                control={form.control}
                name="nextMaintenanceDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prochaine maintenance (date)</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="nextMaintenanceMileage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prochaine maintenance (km)</FormLabel>
                    <FormControl>
                      <Input type="number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="md:col-span-3">
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <textarea
                        className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                        placeholder="Informations supplémentaires sur ce véhicule..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              </div>
            </div>
          </div>
          <div className="flex justify-between border-t border-gray-100 px-5 py-4 bg-gray-50/60">
            <Button variant="outline" type="button" onClick={() => setLocation("/vehicles")}>
              Annuler
            </Button>
            <Button type="submit" disabled={createVehicleMutation.isPending}>
              {createVehicleMutation.isPending ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-background border-t-foreground"></div>
                  Traitement...
                </>
              ) : (
                isEdit ? "Mettre à jour" : "Continuer vers le workflow"
              )}
            </Button>
          </div>
        </form>
      </Form>
      </CardShell>
    </div>
  );
}
