import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { useAllVehicles } from "@/hooks/use-all-vehicles";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { maintenanceScheduleDraft } from "@/lib/form-drafts";

// Schéma de validation modifié pour le formulaire
const maintenanceScheduleFormSchema = z.object({
  vehicleId: z.number().min(1, "Sélectionnez un véhicule"),
  title: z.string().min(2, "Le titre doit contenir au moins 2 caractères"),
  description: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "mileage"]),
  frequencyValue: z.number().min(1, "La valeur doit être d'au moins 1"),
  scheduledDate: z.date().optional(),
  scheduledMileage: z.coerce.number().optional(),
  isActive: z.boolean().default(true),
});

const frequencyOptions = [
  { value: "daily", label: "Quotidienne" },
  { value: "weekly", label: "Hebdomadaire" },
  { value: "monthly", label: "Mensuelle" },
  { value: "quarterly", label: "Trimestrielle" },
  { value: "yearly", label: "Annuelle" },
  { value: "mileage", label: "Kilométrage" },
];

interface MaintenanceScheduleFormProps {
  initialData?: any;
  isEdit?: boolean;
  scheduleId?: number;
  vehicleId?: number;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function MaintenanceScheduleForm({
  initialData,
  isEdit = false,
  scheduleId,
  vehicleId: preSelectedVehicleId,
  onSuccess,
  onCancel,
}: MaintenanceScheduleFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // État local pour le type de fréquence sélectionné
  const [frequencyType, setFrequencyType] = useState<string>(
    initialData?.frequency || "monthly"
  );

  // Charger la liste des véhicules pour le sélecteur
  const { data: allVehicles, isLoading: isLoadingVehicles } = useAllVehicles();
  
  const vehicles = allVehicles ?? [];

  // Configurer le formulaire avec le schéma de validation
  const form = useForm<z.infer<typeof maintenanceScheduleFormSchema>>({
    resolver: zodResolver(maintenanceScheduleFormSchema),
    defaultValues: initialData ? {
      ...initialData,
      scheduledDate: initialData.scheduledDate ? new Date(initialData.scheduledDate) : undefined,
    } : {
      vehicleId: preSelectedVehicleId || 0,
      title: "",
      description: "",
      frequency: "monthly" as const,
      frequencyValue: 1,
      scheduledDate: new Date(),
      scheduledMileage: 100000,
      isActive: true,
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  // Creation uniquement: en edition, restaurer une saisie ancienne par-dessus
  // une fiche modifiee entre-temps ferait plus de degats qu'il n'en evite.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: maintenanceScheduleDraft.storage as any,
    isEmpty: maintenanceScheduleDraft.isEmpty as any,
    enabled: !isEdit,
  });

  // Mutation pour créer ou mettre à jour une planification
  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof maintenanceScheduleFormSchema>) => {
      if (isEdit && scheduleId) {
        return apiRequest("PATCH", `/api/maintenance-schedules/${scheduleId}`, values);
      } else {
        return apiRequest("POST", "/api/maintenance-schedules", values);
      }
    },
    onSuccess: () => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      toast({
        title: isEdit ? "Planification mise à jour" : "Planification créée",
        description: isEdit 
          ? "La planification de maintenance a été mise à jour avec succès."
          : "Une nouvelle planification de maintenance a été créée.",
      });
      
      // Invalider les requêtes pour rafraîchir les données
      queryClient.invalidateQueries({ queryKey: ['/api/maintenance-schedules'] });
      if (preSelectedVehicleId) {
        queryClient.invalidateQueries({ queryKey: [`/api/maintenance-schedules/vehicle/${preSelectedVehicleId}`] });
      }
      
      // Callback de succès si fourni
      if (onSuccess) {
        onSuccess();
      }
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Erreur lors de l'enregistrement."),
      });
    },
  });

  // Fonction de soumission du formulaire
  function onSubmit(values: z.infer<typeof maintenanceScheduleFormSchema>) {
    // Préparation des données selon le type de fréquence
    if (values.frequency === "mileage") {
      values.scheduledDate = undefined;
    } else {
      values.scheduledMileage = undefined;
    }
    
    mutation.mutate(values);
  }

  // Traduire la fréquence en texte explicatif
  const getFrequencyText = (frequency: string, value: number) => {
    switch (frequency) {
      case "daily":
        return `Tous les ${value} jour${value > 1 ? 's' : ''}`;
      case "weekly":
        return `Toutes les ${value} semaine${value > 1 ? 's' : ''}`;
      case "monthly":
        return `Tous les ${value} mois`;
      case "quarterly":
        return `Tous les ${value * 3} mois`;
      case "yearly":
        return `Tous les ${value} an${value > 1 ? 's' : ''}`;
      case "mileage":
        return `Tous les ${value} kilomètres`;
      default:
        return "";
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {draftSavedAt && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <FormDraftBadge savedAt={draftSavedAt} />
              <FormDraftDiscardButton
                savedAt={draftSavedAt}
                onDiscard={() => discardDraft(form.getValues())}
              />
            </div>
          )}
        {/* Véhicule */}
        <FormField
          control={form.control}
          name="vehicleId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Véhicule</FormLabel>
              <Select
                value={field.value?.toString() || ""}
                onValueChange={(value) => field.onChange(parseInt(value))}
                disabled={!!preSelectedVehicleId || isLoadingVehicles}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un véhicule" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {vehicles.map((vehicle: any) => (
                    <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                      {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Titre */}
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Titre</FormLabel>
              <FormControl>
                <Input placeholder="Ex: Vidange moteur" {...field} />
              </FormControl>
              <FormDescription>
                Un titre court pour identifier cette maintenance.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Description */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Détails de l'intervention à réaliser..."
                  className="resize-none"
                  {...field}
                  value={field.value || ""}
                />
              </FormControl>
              <FormDescription>
                Décrivez l'intervention à réaliser et les points à vérifier.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Type de fréquence */}
        <FormField
          control={form.control}
          name="frequency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Type de fréquence</FormLabel>
              <Select
                value={field.value}
                onValueChange={(value: any) => {
                  field.onChange(value);
                  setFrequencyType(value);
                  
                  // Réinitialiser les valeurs selon le type
                  if (value === "mileage") {
                    form.setValue("scheduledMileage", 100000);
                    form.setValue("scheduledDate", undefined);
                  } else {
                    form.setValue("scheduledDate", new Date());
                    form.setValue("scheduledMileage", undefined);
                  }
                }}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {frequencyOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>
                Choisissez si la maintenance est basée sur le temps ou le kilométrage.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Valeur de fréquence */}
        <FormField
          control={form.control}
          name="frequencyValue"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Intervalle</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                />
              </FormControl>
              <FormDescription>
                {getFrequencyText(form.watch("frequency"), form.watch("frequencyValue") || 1)}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Date planifiée */}
        <FormField
          control={form.control}
          name="scheduledDate"
          render={({ field }) => (
            <FormItem className={frequencyType === "mileage" ? "hidden" : ""}>
              <FormLabel>
                Date de début <span className="text-red-500 ml-1">*</span>
              </FormLabel>
              <FormControl>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !field.value && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {field.value ? (
                        format(field.value, "PPP", { locale: fr })
                      ) : (
                        <span>Sélectionner une date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={field.value as Date | undefined}
                      onSelect={field.onChange}
                      initialFocus
                      locale={fr}
                    />
                  </PopoverContent>
                </Popover>
              </FormControl>
              <FormDescription>
                Date de référence pour le calcul des maintenances.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Kilométrage planifié */}
        <FormField
          control={form.control}
          name="scheduledMileage"
          render={({ field }) => (
            <FormItem className={frequencyType !== "mileage" ? "hidden" : ""}>
              <FormLabel>
                Kilométrage de référence <span className="text-red-500 ml-1">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  type="number"
                  placeholder="Ex: 100000"
                  {...field}
                  value={field.value === undefined ? "" : field.value}
                  onChange={(e) => {
                    const value = e.target.value === "" ? 0 : parseInt(e.target.value);
                    field.onChange(value);
                  }}
                />
              </FormControl>
              <FormDescription>
                Kilométrage à partir duquel calculer l'intervalle.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Actif */}
        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Actif</FormLabel>
                <FormDescription>
                  Active ou désactive cette planification de maintenance.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <div className="flex justify-end space-x-4 pt-4">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
            >
              Annuler
            </Button>
          )}
          <Button
            type="submit"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Enregistrement..." : isEdit ? "Mettre à jour" : "Créer"}
          </Button>
        </div>
      </form>
    </Form>
  );
}