import React, { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Car, Wrench, Calendar, User, FileText, ShieldCheck, Loader2, ArrowLeft, ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import { Stepper } from "@/components/workflow/stepper";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { workOrderDraft } from "@/lib/form-drafts";

// Create schema for work order form validation
const workOrderFormSchema = z.object({
  vehicleId: z.coerce.number().min(1, "Véhicule requis"),
  vehicleRegistration: z.string().optional(),
  vehicleBrand: z.string().optional(),
  vehicleModel: z.string().optional(),
  technicianId: z.coerce.number().nullable().optional(),
  title: z.string().min(1, "Titre requis"),
  description: z.string().min(1, "Description requise"),
  diagnosis: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
  priority: z.enum(["low", "medium", "high", "critical"]),
  startDate: z.string().min(1, "Date de début requise"),
  isPreventive: z.boolean().default(false),
  isFirstVisit: z.boolean().default(false),
  maintenanceScheduleId: z.coerce.number().nullable().optional(),
});

type WorkOrderFormValues = z.infer<typeof workOrderFormSchema>;

interface WorkOrderFormProps {
  initialData?: Partial<WorkOrderFormValues>;
  isEdit?: boolean;
  workOrderId?: number;
  preselectedVehicleId?: number;
  onSuccess?: () => void;
  onCancel?: () => void;
}

const failureCategoryOptions = [
  { value: "mechanical", label: "Panne mécanique" },
  { value: "electrical", label: "Panne électrique" },
  { value: "brake", label: "Freinage" },
  { value: "engine", label: "Moteur" },
  { value: "tire", label: "Pneumatique" },
  { value: "accident", label: "Incident / accident" },
  { value: "other", label: "Autre motif" },
] as const;

const getFailureCategoryLabel = (category: string) =>
  failureCategoryOptions.find((option) => option.value === category)?.label || "Autre motif";

const applePanelClass =
  "rounded-2xl border border-slate-200/80 bg-white/80 backdrop-blur-sm p-5 md:p-6 shadow-[0_12px_30px_-18px_rgba(15,23,42,0.35)]";
const appleInputClass =
  "h-11 rounded-xl border-slate-200 bg-white/90 shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:border-blue-300";
const appleSelectTriggerClass =
  "h-11 rounded-xl border-slate-200 bg-white/90 shadow-sm transition-all focus:ring-2 focus:ring-blue-200 focus:border-blue-300";
const appleTextareaClass =
  "rounded-xl border-slate-200 bg-white/90 shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-blue-200 focus-visible:border-blue-300";

export function WorkOrderForm({ initialData, isEdit = false, workOrderId, preselectedVehicleId, onSuccess, onCancel }: WorkOrderFormProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch vehicles for dropdown
  const { data: vehiclesData } = useQuery<{ vehicles: any[] }>({
    queryKey: ["/api/vehicles"],
  });

  // Fetch technicians (users with technician role) for dropdown
  const { data: techniciansData } = useQuery<any[]>({
    queryKey: ["/api/users"],
    select: (data) => data?.filter((user: any) => 
      user.role === "technician" || 
      user.role === "workshop_manager" || 
      user.role === "admin"
    ),
  });

  // Fetch maintenance schedules for the selected vehicle
  const { data: schedulesData, refetch: refetchSchedules } = useQuery<any[]>({
    queryKey: ["/api/maintenance-schedules/vehicle", initialData?.vehicleId || preselectedVehicleId],
    enabled: !!(initialData?.vehicleId || preselectedVehicleId),
  });

  const vehicles = vehiclesData?.vehicles || [];

  const technicians = Array.isArray(techniciansData) ? techniciansData : [];
  const schedules = Array.isArray(schedulesData) ? schedulesData : [];

  // Récupérer l'immatriculation stockée dans localStorage si elle existe
  const savedVehicleRegistration = typeof window !== 'undefined' ? localStorage.getItem("currentVehicleRegistration") : null;
  
  // Si on a une immatriculation, récupérer les détails par immatriculation
  const { data: vehicleByRegistration } = useQuery<any>({
    queryKey: [`/api/vehicles/${savedVehicleRegistration}`],
    enabled: !!savedVehicleRegistration
  });

  // Si on est sur une page de véhicule spécifique, récupérer les détails par ID
  const { data: vehicleDetails } = useQuery<any>({
    queryKey: [`/api/vehicles/${preselectedVehicleId}`],
    enabled: !!preselectedVehicleId && !savedVehicleRegistration
  });

  // Combinons les détails du véhicule, qu'ils viennent de l'ID ou de l'immatriculation
  const combinedVehicleDetails = vehicleDetails || vehicleByRegistration;

  const form = useForm<WorkOrderFormValues>({
    resolver: zodResolver(workOrderFormSchema),
    defaultValues: {
      vehicleId: initialData?.vehicleId || combinedVehicleDetails?.id || preselectedVehicleId || 0,
      vehicleRegistration: initialData?.vehicleRegistration || combinedVehicleDetails?.registrationNumber || savedVehicleRegistration || "",
      vehicleBrand: initialData?.vehicleBrand || combinedVehicleDetails?.brand || "",
      vehicleModel: initialData?.vehicleModel || combinedVehicleDetails?.model || "",
      technicianId: initialData?.technicianId || null,
      title: initialData?.title || "",
      description: initialData?.description || "",
      diagnosis: initialData?.diagnosis || "",
      status: initialData?.status || "pending",
      priority: initialData?.priority || "medium",
      startDate: initialData?.startDate 
        ? typeof initialData.startDate === 'string' 
          ? initialData.startDate 
          : new Date(initialData.startDate).toISOString().split('T')[0] 
        : new Date().toISOString().split('T')[0],
      isPreventive: initialData?.isPreventive || false,
      isFirstVisit: initialData?.isFirstVisit || false,
      maintenanceScheduleId: initialData?.maintenanceScheduleId || null,
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  // Creation uniquement: en edition, restaurer une saisie ancienne par-dessus
  // une fiche modifiee entre-temps ferait plus de degats qu'il n'en evite.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: workOrderDraft.storage as any,
    isEmpty: workOrderDraft.isEmpty as any,
    enabled: !isEdit,
  });

  // Watch for changes to vehicleId to update maintenance schedules and vehicle registration
  const watchVehicleId = form.watch("vehicleId");
  const watchIsPreventive = form.watch("isPreventive");
  const watchTechnicianId = form.watch("technicianId");
  const watchTitle = form.watch("title");
  const watchDescription = form.watch("description");
  const watchPriority = form.watch("priority");
  const watchStartDate = form.watch("startDate");
  const watchIsFirstVisit = form.watch("isFirstVisit");
  const watchMaintenanceScheduleId = form.watch("maintenanceScheduleId");
  const [currentCreateStep, setCurrentCreateStep] = useState(1);
  const [failureCategory, setFailureCategory] = useState<string>("mechanical");
  const [failureDetails, setFailureDetails] = useState<string>("");
  const [symptom, setSymptom] = useState<string>("");
  const [operationalImpact, setOperationalImpact] = useState<string>("");
  const [requestedAction, setRequestedAction] = useState<string>("");
  const [safetyCritical, setSafetyCritical] = useState<boolean>(false);
  const [vehicleImmobilized, setVehicleImmobilized] = useState<boolean>(false);
  const [urgentOperation, setUrgentOperation] = useState<boolean>(false);

  const creationSteps = useMemo(
    () => [
      { number: 1, title: "Contexte", description: "Véhicule, priorité" },
      { number: 2, title: "Intervention", description: "Titre et description" },
      { number: 3, title: "Planification", description: "Date, assignation, options" },
      { number: 4, title: "Validation", description: "Contrôle avant création" },
    ],
    []
  );

  const stepValidationFields: Record<number, Array<keyof WorkOrderFormValues>> = {
    1: ["vehicleId", "priority"],
    2: ["title", "description"],
    3: ["startDate"],
    4: [],
  };

  const priorityLabels: Record<WorkOrderFormValues["priority"], string> = {
    low: "Faible",
    medium: "Moyenne",
    high: "Haute",
    critical: "Critique",
  };

  const priorityRiskMap: Record<
    WorkOrderFormValues["priority"],
    { label: string; variant: "success" | "warning" | "destructive"; hint: string }
  > = {
    low: {
      label: "Risque faible",
      variant: "success",
      hint: "Peut être planifiée sans impact opérationnel majeur.",
    },
    medium: {
      label: "Risque modéré",
      variant: "warning",
      hint: "À planifier rapidement pour éviter une dérive.",
    },
    high: {
      label: "Risque élevé",
      variant: "warning",
      hint: "Intervention prioritaire recommandée sur la journée.",
    },
    critical: {
      label: "Risque critique",
      variant: "destructive",
      hint: "Action immédiate requise pour limiter l’immobilisation.",
    },
  };

  const currentRisk = priorityRiskMap[watchPriority || "medium"];

  const selectedVehicleForSummary = useMemo(
    () => vehicles.find((vehicle: any) => Number(vehicle.id) === Number(watchVehicleId)),
    [vehicles, watchVehicleId]
  );

  const selectedTechnicianForSummary = useMemo(
    () => technicians.find((technician: any) => Number(technician.id) === Number(watchTechnicianId)),
    [technicians, watchTechnicianId]
  );

  const selectedScheduleForSummary = useMemo(
    () => schedules.find((schedule: any) => Number(schedule.id) === Number(watchMaintenanceScheduleId)),
    [schedules, watchMaintenanceScheduleId]
  );

  const suggestedTitle = useMemo(() => {
    const selectedVehicle =
      vehicles.find((vehicle: any) => Number(vehicle.id) === Number(watchVehicleId)) || combinedVehicleDetails;
    const registration = selectedVehicle?.registrationNumber ? ` - ${selectedVehicle.registrationNumber}` : "";
    const prefix = watchIsPreventive ? "Maintenance préventive" : "Panne à traiter";
    return `${prefix}${registration}`;
  }, [watchIsPreventive, vehicles, watchVehicleId, combinedVehicleDetails]);

  const totalCreateSteps = creationSteps.length;
  const isCreateLastStep = currentCreateStep === totalCreateSteps;

  const handleNextCreateStep = async () => {
    if (currentCreateStep === 2 && !form.getValues("description")?.trim()) {
      const guided = buildGuidedDescription();
      if (guided) {
        form.setValue("description", guided, { shouldValidate: true, shouldDirty: true });
      }
    }
    const fields = stepValidationFields[currentCreateStep] || [];
    const isValid = await form.trigger(fields as any, { shouldFocus: true });
    if (!isValid) {
      return;
    }
    setCurrentCreateStep((step) => Math.min(step + 1, totalCreateSteps));
  };

  const handlePreviousCreateStep = () => {
    setCurrentCreateStep((step) => Math.max(step - 1, 1));
  };

  const applySuggestedTitle = () => {
    form.setValue("title", suggestedTitle, { shouldDirty: true, shouldValidate: true });
  };

  const buildGuidedDescription = () => {
    const lines: string[] = [];
    if (symptom.trim()) {
      lines.push(`Symptôme constaté: ${symptom.trim()}`);
    }
    if (operationalImpact.trim()) {
      lines.push(`Impact opérationnel: ${operationalImpact.trim()}`);
    }
    if (requestedAction.trim()) {
      lines.push(`Action demandée: ${requestedAction.trim()}`);
    }
    return lines.join("\n");
  };

  const applyGuidedDescription = () => {
    const guided = buildGuidedDescription();
    if (!guided) return;
    form.setValue("description", guided, { shouldDirty: true, shouldValidate: true });
  };

  const buildBusinessContext = () => {
    const contextLines = [
      `Type d'intervention: ${watchIsPreventive ? "Préventive" : "Curative"}`,
      `Motif: ${getFailureCategoryLabel(failureCategory)}${failureDetails.trim() ? ` (${failureDetails.trim()})` : ""}`,
      `Checklist: Sécurité critique=${safetyCritical ? "Oui" : "Non"}, Immobilisation=${vehicleImmobilized ? "Oui" : "Non"}, Urgence opérationnelle=${urgentOperation ? "Oui" : "Non"}`,
    ];
    return contextLines.join("\n");
  };

  // Force la mise à jour du formulaire quand initialData change (pour le mode édition)
  useEffect(() => {
    if (isEdit && initialData) {
      form.reset({
        vehicleId: initialData.vehicleId || 0,
        vehicleRegistration: initialData.vehicleRegistration || "",
        technicianId: initialData.technicianId || null,
        title: initialData.title || "",
        description: initialData.description || "",
        diagnosis: initialData.diagnosis || "",
        status: initialData.status || "pending",
        priority: initialData.priority || "medium",
        startDate: initialData.startDate 
          ? typeof initialData.startDate === 'string' 
            ? initialData.startDate 
            : new Date(initialData.startDate).toISOString().split('T')[0] 
          : new Date().toISOString().split('T')[0],
        isPreventive: initialData.isPreventive || false,
        isFirstVisit: initialData.isFirstVisit || false,
        maintenanceScheduleId: initialData.maintenanceScheduleId || null,
      });
    }
  }, [isEdit, initialData, form]);

  // Préremplissage en création : supporte les arrivées asynchrones (query params / détails véhicule)
  useEffect(() => {
    if (isEdit) return;

    const resolvedVehicleId = Number(preselectedVehicleId || combinedVehicleDetails?.id || 0);
    if (!resolvedVehicleId) return;

    const currentVehicleId = Number(form.getValues("vehicleId") || 0);
    if (currentVehicleId > 0) return;

    form.setValue("vehicleId", resolvedVehicleId, { shouldValidate: true });

    const resolvedVehicle =
      vehicles.find((vehicle: any) => vehicle.id === resolvedVehicleId) ||
      combinedVehicleDetails;

    if (resolvedVehicle) {
      form.setValue("vehicleRegistration", resolvedVehicle.registrationNumber || "");
      form.setValue("vehicleBrand", resolvedVehicle.brand || "");
      form.setValue("vehicleModel", resolvedVehicle.model || "");

      if (resolvedVehicle.registrationNumber) {
        localStorage.setItem("currentVehicleRegistration", resolvedVehicle.registrationNumber);
      }
    }
  }, [isEdit, preselectedVehicleId, combinedVehicleDetails, vehicles, form]);

  useEffect(() => {
    if (watchVehicleId && vehicles?.length > 0) {
      refetchSchedules();
      
      // Mettre à jour toutes les informations du véhicule automatiquement
      const selectedVehicle = vehicles.find((v: any) => v.id === watchVehicleId);
      if (selectedVehicle) {
        form.setValue("vehicleRegistration", selectedVehicle.registrationNumber);
        form.setValue("vehicleBrand", selectedVehicle.brand);
        form.setValue("vehicleModel", selectedVehicle.model);
        localStorage.setItem("currentVehicleRegistration", selectedVehicle.registrationNumber);
      }
    }
  }, [watchVehicleId, refetchSchedules, vehicles, form]);

  useEffect(() => {
    if (!isEdit) {
      setCurrentCreateStep(1);
    }
  }, [isEdit, preselectedVehicleId]);

  const createWorkOrderMutation = useMutation({
    mutationFn: async (values: WorkOrderFormValues) => {
      try {
        const response = await apiRequest(
          isEdit ? "PATCH" : "POST", 
          isEdit ? `/api/work-orders/${workOrderId}` : "/api/work-orders", 
          values
        );
        return response;
      } catch (error) {
        console.error("Erreur détaillée:", error);
        throw error;
      }
    },
    onSuccess: () => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      toast({
        title: isEdit ? "Ordre de travail mis à jour" : "Ordre de travail créé",
        description: isEdit 
          ? "L'ordre de travail a été mis à jour avec succès." 
          : "L'ordre de travail a été créé avec succès.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      
      if (onSuccess) {
        onSuccess();
      } else {
        setLocation("/maintenance/work-orders");
      }
    },
    onError: (error: any) => {
      // Afficher un message d'erreur plus détaillé si disponible
      const errorMessage = error.response?.data?.message || error.message || "Erreur inconnue";
      const errorDetails = error.response?.data?.details || "";
      
      toast({
        variant: "destructive",
        title: "Erreur",
        description: `Erreur lors de ${isEdit ? "la mise à jour" : "la création"} de l'ordre de travail: ${errorMessage}${errorDetails ? ` (${errorDetails})` : ""}`,
      });
    },
  });

  function onSubmit(values: WorkOrderFormValues) {
    // Créer une copie pour éviter de modifier les valeurs originales du formulaire
    const formData = { ...values };

    // À la création, le statut initial est toujours "En attente"
    if (!isEdit) {
      formData.status = "pending";
    }
    
    // Si ce n'est pas une maintenance préventive, définir maintenanceScheduleId à null
    if (!formData.isPreventive) {
      formData.maintenanceScheduleId = null;
    }
    
    // S'assurer que vehicleId est un nombre
    if (formData.vehicleId) {
      formData.vehicleId = Number(formData.vehicleId);
    }
    
    // Si technicianId est une chaîne vide ou "0", le définir à null
    if (!formData.technicianId || formData.technicianId === 0) {
      formData.technicianId = null;
    } else if (formData.technicianId) {
      formData.technicianId = Number(formData.technicianId);
    }
    
    // S'assurer que maintenanceScheduleId est un nombre ou null
    if (formData.maintenanceScheduleId) {
      formData.maintenanceScheduleId = Number(formData.maintenanceScheduleId);
    }
    
    // Formater la date correctement
    if (formData.startDate) {
      try {
        // Essayer de convertir la date en format ISO
        const date = new Date(formData.startDate);
        if (!isNaN(date.getTime())) {
          // Utiliser seulement la date sans l'heure pour éviter les problèmes de fuseau horaire
          formData.startDate = date.toISOString().split('T')[0] + 'T00:00:00.000Z';
        }
      } catch (error) {
        console.error("Erreur de formatage de date:", error);
      }
    }

    // Enrichir la description avec le contexte métier saisi dans le wizard
    const guidedDescription = buildGuidedDescription();
    if (!formData.description?.trim() && guidedDescription) {
      formData.description = guidedDescription;
    }
    const contextBlock = buildBusinessContext();
    formData.description = [formData.description?.trim(), contextBlock]
      .filter(Boolean)
      .join("\n\n");
    
    // Envoyer les données corrigées
    createWorkOrderMutation.mutate(formData);
  }

  return (
    <Card className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/80 shadow-[0_24px_64px_-36px_rgba(15,23,42,0.45)]">
      <div className="h-0.5 bg-gradient-to-r from-slate-800 via-emerald-500 to-sky-400" />
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
          {!isEdit && (
            <div className="px-6 pt-6 pb-2 border-b border-slate-200/70 bg-white/70">
              <div className="flex items-center justify-between gap-3 pb-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500 font-semibold">Assistant OT</p>
                  <p className="text-sm text-slate-700">Création guidée en 4 étapes</p>
                </div>
                <Badge variant="outline" className="rounded-full border-slate-300 bg-white px-3 py-1 text-slate-700">
                  Étape {currentCreateStep}/{totalCreateSteps}
                </Badge>
              </div>
              <Stepper currentStep={currentCreateStep} steps={creationSteps} />
            </div>
          )}

          <CardContent className="pt-6 space-y-8">
            {isEdit ? (
              <>
                <div className={applePanelClass}>
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-200/80">
                    <Car className="h-4 w-4 text-green-600" />
                    <h3 className="text-sm font-semibold text-green-800">Véhicule & assignation</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="vehicleId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Véhicule</FormLabel>
                          <Select
                            onValueChange={(value) => field.onChange(parseInt(value, 10))}
                            value={field.value ? field.value.toString() : ""}
                            disabled
                          >
                            <FormControl>
                              <SelectTrigger className={appleSelectTriggerClass}>
                                <SelectValue placeholder="Sélectionner un véhicule" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {vehicles.map((vehicle: any) => (
                                <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                                  {vehicle.registrationNumber} — {vehicle.brand} {vehicle.model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="technicianId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Technicien</FormLabel>
                          <Select
                            onValueChange={(value) => field.onChange(value === "0" ? null : parseInt(value, 10))}
                            value={field.value ? field.value.toString() : "0"}
                          >
                            <FormControl>
                              <SelectTrigger className={appleSelectTriggerClass}>
                                <SelectValue placeholder="Assigner un technicien" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="0">Non assigné</SelectItem>
                              {technicians.map((tech: any) => (
                                <SelectItem key={tech.id} value={tech.id.toString()}>
                                  {tech.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className={applePanelClass}>
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-200/80">
                    <Wrench className="h-4 w-4 text-green-600" />
                    <h3 className="text-sm font-semibold text-green-800">Intervention</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Titre</FormLabel>
                          <FormControl>
                            <Input className={appleInputClass} placeholder="Ex : Vidange huile moteur" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="priority"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Priorité</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className={appleSelectTriggerClass}>
                                <SelectValue placeholder="Sélectionner une priorité" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Faible</SelectItem>
                              <SelectItem value="medium">Moyenne</SelectItem>
                              <SelectItem value="high">Haute</SelectItem>
                              <SelectItem value="critical">Critique</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Statut</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className={appleSelectTriggerClass}>
                                <SelectValue placeholder="Sélectionner un statut" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="pending">En attente</SelectItem>
                              <SelectItem value="in_progress">En cours</SelectItem>
                              <SelectItem value="completed">Terminé</SelectItem>
                              <SelectItem value="cancelled">Annulé</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="startDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date de début</FormLabel>
                          <FormControl>
                            <Input className={appleInputClass} type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className={applePanelClass}>
                  <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-200/80">
                    <FileText className="h-4 w-4 text-green-600" />
                    <h3 className="text-sm font-semibold text-green-800">Description</h3>
                  </div>
                  <div className="space-y-4">
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description des travaux</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Description détaillée des travaux à effectuer..."
                              className={`${appleTextareaClass} resize-none min-h-[100px]`}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="diagnosis"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Diagnostic</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Diagnostic après inspection..."
                              className={`${appleTextareaClass} resize-none min-h-[100px]`}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                {currentCreateStep === 1 && (
                  <div className={`${applePanelClass} space-y-5`}>
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200/80">
                      <Car className="h-4 w-4 text-green-600" />
                      <h3 className="text-sm font-semibold text-green-800">Contexte panne</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Identifie d’abord le véhicule concerné et le niveau d’urgence métier.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <FormLabel>Type d'intervention</FormLabel>
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            variant={watchIsPreventive ? "outline" : "default"}
                            className={
                              !watchIsPreventive
                                ? "rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-sm"
                                : "rounded-xl border-slate-300 bg-white text-slate-700"
                            }
                            onClick={() => {
                              form.setValue("isPreventive", false, { shouldDirty: true });
                              form.setValue("maintenanceScheduleId", null, { shouldDirty: true });
                            }}
                          >
                            Curative
                          </Button>
                          <Button
                            type="button"
                            variant={watchIsPreventive ? "default" : "outline"}
                            className={
                              watchIsPreventive
                                ? "rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-sm"
                                : "rounded-xl border-slate-300 bg-white text-slate-700"
                            }
                            onClick={() => form.setValue("isPreventive", true, { shouldDirty: true })}
                          >
                            Préventive
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <FormLabel>Motif principal</FormLabel>
                        <Select value={failureCategory} onValueChange={setFailureCategory}>
                          <SelectTrigger className={appleSelectTriggerClass}>
                            <SelectValue placeholder="Sélectionner un motif" />
                          </SelectTrigger>
                          <SelectContent>
                            {failureCategoryOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <FormLabel>Précision du motif (optionnel)</FormLabel>
                      <Input
                        className={appleInputClass}
                        value={failureDetails}
                        onChange={(event) => setFailureDetails(event.target.value)}
                        placeholder="Ex: Bruit anormal côté compresseur, voyant moteur allumé..."
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="vehicleId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Véhicule concerné</FormLabel>
                            <Select
                              onValueChange={(value) => field.onChange(parseInt(value, 10))}
                              value={field.value ? field.value.toString() : ""}
                            >
                              <FormControl>
                              <SelectTrigger className={appleSelectTriggerClass}>
                                <SelectValue placeholder="Sélectionner un véhicule" />
                              </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {vehicles.map((vehicle: any) => (
                                  <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                                    {vehicle.registrationNumber} — {vehicle.brand} {vehicle.model}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="priority"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Priorité intervention</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                              <SelectTrigger className={appleSelectTriggerClass}>
                                <SelectValue placeholder="Sélectionner une priorité" />
                              </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="low">Faible</SelectItem>
                                <SelectItem value="medium">Moyenne</SelectItem>
                                <SelectItem value="high">Haute</SelectItem>
                                <SelectItem value="critical">Critique</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium">Niveau de risque opérationnel</p>
                        <Badge variant={currentRisk.variant}>{currentRisk.label}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{currentRisk.hint}</p>
                    </div>

                    <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-4">
                      <p className="text-sm font-medium text-amber-800">Statut initial: En attente</p>
                      <p className="text-xs text-amber-700/90 mt-1">
                        Le statut est verrouillé à la création. L’OT démarre toujours en attente.
                      </p>
                    </div>
                  </div>
                )}

                {currentCreateStep === 2 && (
                  <div className={`${applePanelClass} space-y-5`}>
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200/80">
                      <Wrench className="h-4 w-4 text-green-600" />
                      <h3 className="text-sm font-semibold text-green-800">Détails de l’intervention</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Donne un titre explicite et une description actionnable pour l’atelier.
                    </p>
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <div className="flex items-center justify-between gap-2">
                            <FormLabel>Titre OT</FormLabel>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 px-3 text-xs rounded-lg border-slate-300 bg-white/90 hover:bg-slate-50"
                              onClick={applySuggestedTitle}
                            >
                              <Sparkles className="h-3.5 w-3.5 mr-1" />
                              Suggérer un titre
                            </Button>
                          </div>
                          <FormControl>
                            <Input className={appleInputClass} placeholder="Ex : Panne moteur sur route Douala-Yaoundé" {...field} />
                          </FormControl>
                          <p className="text-xs text-muted-foreground">
                            Suggestion: <span className="font-medium">{suggestedTitle}</span>
                          </p>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <FormLabel>Symptôme constaté</FormLabel>
                        <Textarea
                          value={symptom}
                          onChange={(event) => setSymptom(event.target.value)}
                          placeholder="Ex: vibrations, voyant, fuite..."
                          className={`${appleTextareaClass} resize-none min-h-[90px]`}
                        />
                      </div>
                      <div className="space-y-2">
                        <FormLabel>Impact opérationnel</FormLabel>
                        <Textarea
                          value={operationalImpact}
                          onChange={(event) => setOperationalImpact(event.target.value)}
                          placeholder="Ex: immobilisation ligne, retard mission..."
                          className={`${appleTextareaClass} resize-none min-h-[90px]`}
                        />
                      </div>
                      <div className="space-y-2">
                        <FormLabel>Action demandée</FormLabel>
                        <Textarea
                          value={requestedAction}
                          onChange={(event) => setRequestedAction(event.target.value)}
                          placeholder="Ex: diagnostiquer et remplacer la pièce..."
                          className={`${appleTextareaClass} resize-none min-h-[90px]`}
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 px-3 text-xs rounded-lg border-slate-300 bg-white/90 hover:bg-slate-50"
                        onClick={applyGuidedDescription}
                      >
                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                        Générer la description depuis le guide
                      </Button>
                    </div>

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description des travaux</FormLabel>
                          <FormControl>
                            <Textarea
                              placeholder="Décris le symptôme, l'impact opérationnel et l'intervention attendue..."
                              className={`${appleTextareaClass} resize-none min-h-[140px]`}
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="space-y-2">
                      <FormLabel>Checklist rapide</FormLabel>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <label className="flex items-start gap-3 rounded-xl border border-red-200/70 bg-red-50/70 p-3 cursor-pointer shadow-sm">
                          <Checkbox checked={safetyCritical} onCheckedChange={(checked) => setSafetyCritical(Boolean(checked))} />
                          <div>
                            <p className="text-sm font-medium">Risque sécurité</p>
                            <p className="text-xs text-muted-foreground">Situation critique sécurité / conformité</p>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 rounded-xl border border-orange-200/70 bg-orange-50/70 p-3 cursor-pointer shadow-sm">
                          <Checkbox checked={vehicleImmobilized} onCheckedChange={(checked) => setVehicleImmobilized(Boolean(checked))} />
                          <div>
                            <p className="text-sm font-medium">Véhicule immobilisé</p>
                            <p className="text-xs text-muted-foreground">Impossible de poursuivre l’exploitation</p>
                          </div>
                        </label>
                        <label className="flex items-start gap-3 rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 cursor-pointer shadow-sm">
                          <Checkbox checked={urgentOperation} onCheckedChange={(checked) => setUrgentOperation(Boolean(checked))} />
                          <div>
                            <p className="text-sm font-medium">Urgence opérationnelle</p>
                            <p className="text-xs text-muted-foreground">Impact immédiat sur missions / service</p>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {currentCreateStep === 3 && (
                  <div className={`${applePanelClass} space-y-6`}>
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200/80">
                      <Calendar className="h-4 w-4 text-green-600" />
                      <h3 className="text-sm font-semibold text-green-800">Planification et options</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Planifie la date de démarrage, puis indique les options métier utiles au suivi.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="startDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date de début</FormLabel>
                            <FormControl>
                              <Input className={appleInputClass} type="date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="technicianId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                              Assignation technicien (optionnel)
                            </FormLabel>
                            <Select
                              onValueChange={(value) => field.onChange(value === "0" ? null : parseInt(value, 10))}
                              value={field.value ? field.value.toString() : "0"}
                            >
                              <FormControl>
                                <SelectTrigger className={appleSelectTriggerClass}>
                                  <SelectValue placeholder="Assigner un technicien" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="0">Non assigné</SelectItem>
                                {technicians.map((tech: any) => (
                                  <SelectItem key={tech.id} value={tech.id.toString()}>
                                    {tech.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div>
                      <div className="flex items-center gap-2 mb-4">
                        <ShieldCheck className="h-4 w-4 text-green-600" />
                        <h4 className="text-sm font-semibold text-green-800">Options métier</h4>
                      </div>
                      <div className="space-y-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                          <p className="text-sm font-medium">
                            Type sélectionné: {watchIsPreventive ? "Préventive" : "Curative"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Ce paramètre se règle à l’étape 1 (Contexte panne).
                          </p>
                        </div>
                        <FormField
                          control={form.control}
                          name="isFirstVisit"
                          render={({ field }) => (
                            <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-xl border border-blue-100 bg-blue-50/40 p-4 hover:bg-blue-50 transition-colors cursor-pointer">
                              <FormControl>
                                <Checkbox checked={field.value} onCheckedChange={field.onChange} className="mt-0.5" />
                              </FormControl>
                              <div className="space-y-0.5 leading-none">
                                <FormLabel className="cursor-pointer font-medium">Première visite</FormLabel>
                                <p className="text-xs text-muted-foreground">
                                  Première visite de ce véhicule à l'atelier
                                </p>
                              </div>
                            </FormItem>
                          )}
                        />
                      </div>

                      {watchIsPreventive && (
                        <div className="mt-3">
                          <FormField
                            control={form.control}
                            name="maintenanceScheduleId"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Plan de maintenance associé</FormLabel>
                                <Select
                                  onValueChange={(value) => field.onChange(value === "0" ? null : parseInt(value, 10))}
                                  value={field.value ? field.value.toString() : "0"}
                                >
                                  <FormControl>
                                    <SelectTrigger className={appleSelectTriggerClass}>
                                      <SelectValue placeholder="Sélectionner un plan de maintenance" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="0">Aucun plan associé</SelectItem>
                                    {schedules.map((schedule: any) => (
                                      <SelectItem key={schedule.id} value={schedule.id.toString()}>
                                        {schedule.title}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {currentCreateStep === 4 && (
                  <div className={`${applePanelClass} space-y-5`}>
                    <div className="flex items-center gap-2 pb-2 border-b border-slate-200/80">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <h3 className="text-sm font-semibold text-green-800">Validation finale</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Vérifie les informations avant de générer l’OT. Ce résumé sera la base de l’exécution atelier.
                    </p>

                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Véhicule</p>
                        <p className="font-medium">
                          {selectedVehicleForSummary
                            ? `${selectedVehicleForSummary.registrationNumber} — ${selectedVehicleForSummary.brand} ${selectedVehicleForSummary.model}`
                            : "Non renseigné"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Priorité</p>
                        <p className="font-medium">{watchPriority ? priorityLabels[watchPriority] : "Non renseigné"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Type d'intervention</p>
                        <p className="font-medium">{watchIsPreventive ? "Préventive" : "Curative"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Motif</p>
                        <p className="font-medium">
                          {getFailureCategoryLabel(failureCategory)}
                          {failureDetails.trim() ? ` — ${failureDetails.trim()}` : ""}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Date de début</p>
                        <p className="font-medium">{watchStartDate || "Non renseignée"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Technicien</p>
                        <p className="font-medium">{selectedTechnicianForSummary?.name || "Non assigné"}</p>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-muted-foreground">Titre</p>
                        <p className="font-medium">{watchTitle || "Non renseigné"}</p>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-muted-foreground">Description</p>
                        <p className="font-medium whitespace-pre-wrap">
                          {watchDescription || "Non renseignée"}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 p-4 text-sm">
                      <p className="font-medium text-green-800">Options sélectionnées</p>
                      <ul className="mt-2 space-y-1 text-green-900/90">
                        <li>Statut initial: En attente</li>
                        <li className="flex items-center gap-2">
                          Risque opérationnel:
                          <Badge variant={currentRisk.variant} className="font-medium">
                            {currentRisk.label}
                          </Badge>
                        </li>
                        <li>Risque sécurité: {safetyCritical ? "Oui" : "Non"}</li>
                        <li>Véhicule immobilisé: {vehicleImmobilized ? "Oui" : "Non"}</li>
                        <li>Urgence opérationnelle: {urgentOperation ? "Oui" : "Non"}</li>
                        <li>Première visite: {watchIsFirstVisit ? "Oui" : "Non"}</li>
                        {watchIsPreventive && (
                          <li>Plan associé: {selectedScheduleForSummary?.title || "Aucun plan sélectionné"}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>

          <CardFooter className="flex justify-between border-t border-slate-200/70 bg-white/80 px-6 py-4 backdrop-blur-sm">
            <Button
              variant="outline"
              type="button"
              className="rounded-xl border-slate-300 bg-white/90 hover:bg-slate-50"
              onClick={() => {
                if (onCancel) {
                  onCancel();
                } else {
                  setLocation("/maintenance/work-orders");
                }
              }}
            >
              Annuler
            </Button>

            {isEdit ? (
              <Button
                type="submit"
                disabled={createWorkOrderMutation.isPending}
                className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-6 shadow-sm"
              >
                {createWorkOrderMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Traitement...
                  </>
                ) : (
                  "Mettre à jour"
                )}
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                {currentCreateStep > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl border-slate-300 bg-white/90 hover:bg-slate-50"
                    onClick={handlePreviousCreateStep}
                  >
                    <ArrowLeft className="h-4 w-4 mr-1.5" />
                    Précédent
                  </Button>
                )}

                {!isCreateLastStep ? (
                  <Button
                    type="button"
                    onClick={handleNextCreateStep}
                    className="rounded-xl bg-slate-900 hover:bg-slate-800 text-white px-6 shadow-sm"
                  >
                    Suivant
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    disabled={createWorkOrderMutation.isPending}
                    className="rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white px-6 shadow-sm"
                  >
                    {createWorkOrderMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Création...
                      </>
                    ) : (
                      "Créer l'ordre de travail"
                    )}
                  </Button>
                )}
              </div>
            )}
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
