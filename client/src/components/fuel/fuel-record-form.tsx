import { userMessageOf } from "@/lib/api-error";
import React from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAllVehicles } from "@/hooks/use-all-vehicles";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAnimatedError } from "@/hooks/use-animated-error";
import { AnimatedError } from "@/components/ui/animated-error";
import { CardShell, SectionLabel } from "@/components/design-system";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { fuelRecordDraft } from "@/lib/form-drafts";

// Create schema for fuel record form validation
const fuelRecordFormSchema = z.object({
  vehicleId: z.coerce.number().min(1, "Véhicule requis"),
  date: z.string().min(1, "Date requise"),
  quantity: z.coerce.number().min(0.1, "Quantité invalide"),
  cost: z.coerce.number().min(0, "Coût invalide"),
  mileage: z.coerce.number().min(0, "Kilométrage invalide"),
  fullTank: z.boolean().default(true),
  notes: z.string().optional(),
});

type FuelRecordFormValues = z.infer<typeof fuelRecordFormSchema>;

interface FuelRecordFormProps {
  initialData?: Partial<FuelRecordFormValues>;
  isEdit?: boolean;
  recordId?: number;
  fuelRecordId?: number;
  vehicleId?: number;
  embedded?: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function FuelRecordForm({ 
  initialData, 
  isEdit = false, 
  recordId,
  fuelRecordId,
  vehicleId,
  embedded = false,
  onSuccess,
  onCancel,
}: FuelRecordFormProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { error, showError, clearError, handleApiError } = useAnimatedError();
  
  // Fetch vehicles for dropdown
  const { data: allVehicles } = useAllVehicles();
  
  // Vérifier si on a une immatriculation stockée dans sessionStorage
  const [savedRegistration, setSavedRegistration] = React.useState<string | null>(null);
  
  // Effet pour récupérer l'immatriculation stockée
  React.useEffect(() => {
    const storedRegistration = sessionStorage.getItem('selected_vehicle_registration');
    if (storedRegistration) {
      setSavedRegistration(storedRegistration);
      // Nettoyer après utilisation
      sessionStorage.removeItem('selected_vehicle_registration');
    }
  }, []);

  // Si on est sur une page de véhicule spécifique, récupérer les détails par ID
  const { data: vehicleDetails } = useQuery<any>({
    queryKey: [`/api/vehicles/${vehicleId}`],
    enabled: !!vehicleId && !savedRegistration
  });
  
  // Si on a une immatriculation, récupérer les détails par immatriculation
  const { data: vehicleByRegistration } = useQuery<any>({
    queryKey: [`/api/vehicles/${savedRegistration}`],
    enabled: !!savedRegistration
  });
  
  // Définir les types pour éviter les erreurs
  type VehicleData = {
    id: number;
    registrationNumber: string;
    brand: string;
    model: string;
    mileage: number;
  };
  
  // Combinons les détails du véhicule, qu'ils viennent de l'ID ou de l'immatriculation
  const combinedVehicleDetails = vehicleDetails || vehicleByRegistration;
  
  // Assurons-nous que les détails sont correctement typés
  const typedVehicleDetails = combinedVehicleDetails as VehicleData | undefined;
  const effectiveRecordId = recordId ?? fuelRecordId;
  
  const vehicles = allVehicles ?? [];
  const currentVehicleMileage = typedVehicleDetails?.mileage || 0;
  
  // Si nous avons récupéré un véhicule par immatriculation, utilisez son ID
  const effectiveVehicleId = vehicleId || typedVehicleDetails?.id;
  
  const form = useForm<FuelRecordFormValues>({
    resolver: zodResolver(fuelRecordFormSchema),
    defaultValues: {
      vehicleId: initialData?.vehicleId || effectiveVehicleId || 0,
      date: initialData?.date 
        ? new Date(initialData.date).toISOString().split('T')[0] 
        : new Date().toISOString().split('T')[0],
      quantity: initialData?.quantity || 0,
      cost: initialData?.cost || 0,
      mileage: initialData?.mileage || currentVehicleMileage || 0,
      fullTank: initialData?.fullTank !== undefined ? initialData.fullTank : true,
      notes: initialData?.notes || "",
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  // Creation uniquement: en edition, restaurer une saisie ancienne par-dessus
  // une fiche modifiee entre-temps ferait plus de degats qu'il n'en evite.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: fuelRecordDraft.storage as any,
    isEmpty: fuelRecordDraft.isEmpty as any,
    enabled: !isEdit,
  });
  
  // Mettre à jour le kilométrage et sélectionner le véhicule quand les détails sont chargés
  React.useEffect(() => {
    if (typedVehicleDetails) {
      // Mettre à jour le kilométrage
      if (typedVehicleDetails.mileage > 0) {
        form.setValue('mileage', typedVehicleDetails.mileage);
      }
      
      // Sélectionner le véhicule automatiquement
      if (typedVehicleDetails.id) {
        console.log("Mise à jour du formulaire avec le véhicule ID:", typedVehicleDetails.id);
        form.setValue('vehicleId', typedVehicleDetails.id);
      }
    }
  }, [typedVehicleDetails, form]);
  
  const createFuelRecordMutation = useMutation({
    mutationFn: async (values: FuelRecordFormValues) => {
      return apiRequest(
        isEdit ? "PATCH" : "POST", 
        isEdit ? `/api/fuel-records/${effectiveRecordId}` : "/api/fuel-records", 
        values
      );
    },
    onSuccess: () => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      toast({
        title: isEdit ? "Enregistrement mis à jour" : "Plein enregistré",
        description: isEdit 
          ? "L'enregistrement de carburant a été mis à jour." 
          : "Le plein de carburant a été enregistré avec succès.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });

      if (onSuccess) {
        onSuccess();
        return;
      }
      
      if (vehicleId) {
        queryClient.invalidateQueries({ queryKey: [`/api/fuel-records/vehicle/${vehicleId}`] });
        // Si nous avons les détails du véhicule, utiliser son immatriculation
        if (typedVehicleDetails?.registrationNumber) {
          setLocation(`/vehicles/${encodeURIComponent(typedVehicleDetails.registrationNumber)}`);
        } else {
          setLocation(`/vehicles/${vehicleId}`);
        }
      } else {
        setLocation("/fuel");
      }
    },
    onError: (error) => {
      handleApiError(error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, `Erreur lors de ${isEdit ? "la mise à jour" : "l'enregistrement"} du plein.`),
      });
    },
  });
  
  function onSubmit(values: FuelRecordFormValues) {
    createFuelRecordMutation.mutate(values);
  }
  
  const formContent = (
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
        <div className="space-y-4 px-5 py-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="vehicleId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Véhicule</FormLabel>
                    <Select 
                      onValueChange={(value) => field.onChange(parseInt(value))} 
                      value={field.value ? field.value.toString() : undefined}
                      disabled={isEdit}
                    >
                      <FormControl>
                        <SelectTrigger className="bg-background text-foreground">
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
              
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantité (litres)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0.1} step={0.01} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Coût (F CFA)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={0.01} {...field} />
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
                    <FormLabel>Kilométrage</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="fullTank"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Plein complet</FormLabel>
                      <p className="text-sm text-muted-foreground">
                        Cochez si le réservoir a été rempli complètement
                      </p>
                    </div>
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Notes ou commentaires"
                        className="resize-none min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
          </div>
        </div>
        <div className="flex justify-between border-t border-gray-100 px-5 py-4 bg-gray-50/70">
            <Button 
              variant="outline" 
              type="button" 
              onClick={() => {
                if (onCancel) {
                  onCancel();
                  return;
                }
                if (vehicleId && typedVehicleDetails?.registrationNumber) {
                  setLocation(`/vehicles/${encodeURIComponent(typedVehicleDetails.registrationNumber)}`);
                } else if (vehicleId) {
                  setLocation(`/vehicles/${vehicleId}`);
                } else {
                  setLocation("/fuel");
                }
              }}
            >
              Annuler
            </Button>
            <Button 
              type="submit" 
              disabled={createFuelRecordMutation.isPending}
            >
              {createFuelRecordMutation.isPending ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-background border-t-foreground"></div>
                  Traitement...
                </>
              ) : (
                isEdit ? "Mettre à jour" : "Enregistrer"
              )}
            </Button>
        </div>
      </form>
    </Form>
  );

  return (
    <div className="space-y-4">
      {embedded ? (
        formContent
      ) : (
        <CardShell topBar>
          <div className="px-5 py-4 border-b border-gray-100">
            <SectionLabel className="text-green-600">Carburant</SectionLabel>
            <h3 className="text-base font-semibold text-gray-900 mt-1">
              {isEdit ? "Modifier le plein" : "Enregistrer un plein"}
            </h3>
          </div>
          {formContent}
        </CardShell>
      )}
      
      {/* Animated error display */}
      {error && (
        <div className="mt-4">
          <AnimatedError
            type={error.type}
            message={error.message}
            onRetry={() => {
              clearError();
              // Retry the last operation
              if (createFuelRecordMutation.variables) {
                createFuelRecordMutation.mutate(createFuelRecordMutation.variables);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
