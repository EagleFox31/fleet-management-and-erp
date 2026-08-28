import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { driverDraftStorage, isDriverFormEmpty, type DriverDraftData } from "@/lib/driver-draft";
import type { FormDraftStorage } from "@/lib/form-draft-storage";

const optionalText = z
  .string()
  .optional()
  .transform((value) => {
    if (typeof value !== "string") return "";
    return value.trim();
  });

const optionalDate = z
  .string()
  .optional()
  .transform((value) => {
    if (typeof value !== "string") return "";
    return value.trim();
  })
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Format attendu: YYYY-MM-DD",
  });

const driverFormSchema = z.object({
  firstName: z.string().trim().min(1, "Le prénom est requis"),
  lastName: z.string().trim().min(1, "Le nom est requis"),
  employeeNumber: optionalText,
  licenseNumber: optionalText,
  licenseExpiry: optionalDate,
  cniNumber: optionalText,
  cniExpiry: optionalDate,
  cpcTrainingDate: optionalDate,
  isActive: z.enum(["true", "false"]).default("true"),
});

type DriverFormValues = z.infer<typeof driverFormSchema>;

export interface DriverFormData {
  id?: number;
  /** Dernière modification côté serveur: arbitre brouillon vs donnée fraîche. */
  updatedAt?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  employeeNumber?: string | null;
  licenseNumber?: string | null;
  licenseExpiry?: string | null;
  cniNumber?: string | null;
  cniExpiry?: string | null;
  cpcTrainingDate?: string | null;
  isActive?: boolean | null;
}

interface DriverFormProps {
  initialData?: DriverFormData;
  isEdit?: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
}

function normalizeDateValue(value: string | null | undefined): string {
  if (!value) return "";
  return value.split("T")[0] || "";
}

export function DriverForm({ initialData, isEdit = false, onSuccess, onCancel }: DriverFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const driverId = initialData?.id;
  const defaultValues = useMemo<DriverFormValues>(
    () => ({
      firstName: initialData?.firstName || "",
      lastName: initialData?.lastName || "",
      employeeNumber: initialData?.employeeNumber || "",
      licenseNumber: initialData?.licenseNumber || "",
      licenseExpiry: normalizeDateValue(initialData?.licenseExpiry),
      cniNumber: initialData?.cniNumber || "",
      cniExpiry: normalizeDateValue(initialData?.cniExpiry),
      cpcTrainingDate: normalizeDateValue(initialData?.cpcTrainingDate),
      isActive: initialData?.isActive === false ? "false" : "true",
    }),
    [
      initialData?.cniExpiry,
      initialData?.cniNumber,
      initialData?.cpcTrainingDate,
      initialData?.employeeNumber,
      initialData?.firstName,
      initialData?.isActive,
      initialData?.lastName,
      initialData?.licenseExpiry,
      initialData?.licenseNumber,
    ],
  );

  const form = useForm<DriverFormValues>({
    resolver: zodResolver(driverFormSchema),
    defaultValues,
  });

  // Fiche longue (identité + permis + CNI + CPC), souvent remplie en plusieurs
  // fois: la saisie ne doit pas disparaître sur un rafraîchissement.
  // Le brouillon n'est activé qu'en création: en édition, restaurer une saisie
  // ancienne par-dessus une fiche corrigée entre-temps ferait plus de dégâts
  // qu'il n'en éviterait.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft<DriverFormValues>({
    form,
    storage: driverDraftStorage as FormDraftStorage<DriverFormValues>,
    enabled: !isEdit,
    isEmpty: (data) => isDriverFormEmpty(data as unknown as DriverDraftData),
  });

  const mutation = useMutation({
    mutationFn: async (values: DriverFormValues) => {
      const payload = {
        firstName: values.firstName,
        lastName: values.lastName,
        employeeNumber: values.employeeNumber || null,
        licenseNumber: values.licenseNumber || null,
        licenseExpiry: values.licenseExpiry || null,
        cniNumber: values.cniNumber || null,
        cniExpiry: values.cniExpiry || null,
        cpcTrainingDate: values.cpcTrainingDate || null,
        isActive: values.isActive === "true",
      };

      if (isEdit && driverId) {
        return apiRequest("PATCH", `/api/drivers/${driverId}`, payload);
      }

      return apiRequest("POST", "/api/drivers", payload);
    },
    onSuccess: () => {
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      toast({
        title: isEdit ? "Chauffeur mis à jour" : "Chauffeur créé",
        description: isEdit
          ? "Les informations du chauffeur ont été mises à jour."
          : "Le chauffeur est maintenant disponible pour affectation.",
      });
      onSuccess?.();
      if (!isEdit) {
        form.reset({
          firstName: "",
          lastName: "",
          employeeNumber: "",
          licenseNumber: "",
          licenseExpiry: "",
          cniNumber: "",
          cniExpiry: "",
          cpcTrainingDate: "",
          isActive: "true",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: error.message || "Impossible d'enregistrer le chauffeur.",
      });
    },
    onSettled: () => {
      setIsSubmitting(false);
    },
  });

  const onSubmit = (values: DriverFormValues) => {
    setIsSubmitting(true);
    mutation.mutate(values);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        {draftSavedAt && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <FormDraftBadge savedAt={draftSavedAt} />
            <FormDraftDiscardButton
              savedAt={draftSavedAt}
              onDiscard={() => discardDraft(defaultValues)}
            />
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prénom *</FormLabel>
                    <FormControl>
                      <Input placeholder="Ali" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom *</FormLabel>
                    <FormControl>
                      <Input placeholder="Sawadogo" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="employeeNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Matricule</FormLabel>
                    <FormControl>
                      <Input placeholder="DRV-001" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Statut</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Statut du chauffeur" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="true">Actif</SelectItem>
                        <SelectItem value="false">Inactif</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="licenseNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>N° permis</FormLabel>
                    <FormControl>
                      <Input placeholder="PERMIS-12345" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="licenseExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Validité permis</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cniNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>N° CNI</FormLabel>
                    <FormControl>
                      <Input placeholder="CNI-..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cniExpiry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Validité CNI</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="cpcTrainingDate"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Date formation CPC</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="outline" onClick={onCancel}>
                Annuler
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Traitement..." : isEdit ? "Mettre à jour" : "Créer le chauffeur"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
