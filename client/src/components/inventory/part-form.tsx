import { userMessageOf } from "@/lib/api-error";
import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { PART_UNITS } from "@shared/constants/parts";
import { SupplierCombobox } from "@/components/procurement/supplier-combobox";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { partDraft } from "@/lib/form-drafts";

const PART_CATEGORIES = [
  "PIECES DETACHEES",
  "MOTEUR",
  "FREINAGE",
  "PNEUMATIQUE",
  "ELECTRIQUE",
  "CARROSSERIE",
  "LUBRIFIANTS",
  "FILTRES",
  "TRANSMISSION",
  "SUSPENSION",
] as const;

// Create schema for part form validation
const partFormSchema = z.object({
  name: z.string().min(1, "Nom requis"),
  reference: z.string().min(1, "Référence requise"),
  description: z.string().optional(),
  category: z.string().optional(),
  customCategory: z.string().optional(),
  responsiblePerson: z.string().optional(),
  deliveryReceiptNumber: z.string().optional(),
  quantity: z.coerce.number().min(0, "Quantité invalide"),
  minQuantity: z.coerce.number().min(0, "Seuil minimal invalide"),
  unit: z.enum(PART_UNITS, { required_error: "Unité requise" }),
  location: z.string().optional(),
  unitPrice: z.coerce.number().min(0, "Prix unitaire invalide"),
  // `supplierId` est la vérité; `supplier` (nom) reste écrit en parallèle pendant
  // la transition, pour les écrans qui lisent encore le champ texte.
  supplierId: z.number().nullable().optional(),
  supplier: z.string().optional(),
});

type PartFormValues = z.infer<typeof partFormSchema>;

interface PartFormProps {
  initialData?: Partial<PartFormValues>;
  isEdit?: boolean;
  partId?: number;
}

interface InventoryResponsible {
  id: number;
  name: string;
  username: string;
  role: string;
}

export function PartForm({ initialData, isEdit = false, partId }: PartFormProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const initialCategory = (initialData?.category || "").trim();
  const isInitialCategoryInList = PART_CATEGORIES.includes(initialCategory as (typeof PART_CATEGORIES)[number]);
  const initialResponsible = (initialData?.responsiblePerson || "").trim();
  const initialUnit = (initialData?.unit || "").trim();
  const normalizedInitialUnit: PartFormValues["unit"] = PART_UNITS.includes(initialUnit as PartFormValues["unit"])
    ? (initialUnit as PartFormValues["unit"])
    : "pièce";

  const { data: inventoryResponsibles = [] } = useQuery<InventoryResponsible[]>({
    queryKey: ["/api/users/inventory-responsibles"],
    staleTime: 5 * 60 * 1000,
  });

  // La liste des fournisseurs est désormais chargée par `SupplierCombobox`.

  const form = useForm<PartFormValues>({
    resolver: zodResolver(partFormSchema),
    defaultValues: {
      name: initialData?.name || "",
      reference: initialData?.reference || "",
      description: initialData?.description || "",
      category: initialCategory
        ? (isInitialCategoryInList ? initialCategory : "__custom__")
        : "",
      customCategory: initialCategory && !isInitialCategoryInList ? initialCategory : "",
      responsiblePerson: initialData?.responsiblePerson || "",
      deliveryReceiptNumber: initialData?.deliveryReceiptNumber || "",
      quantity: initialData?.quantity || 0,
      minQuantity: initialData?.minQuantity || 5,
      unit: normalizedInitialUnit,
      location: initialData?.location || "",
      unitPrice: initialData?.unitPrice || 0,
      supplierId: initialData?.supplierId ?? null,
      supplier: initialData?.supplier || "",
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  // Creation uniquement: en edition, restaurer une saisie ancienne par-dessus
  // une fiche modifiee entre-temps ferait plus de degats qu'il n'en evite.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: partDraft.storage as any,
    isEmpty: partDraft.isEmpty as any,
    enabled: !isEdit,
    userId: user?.id,
  });
  
  const createPartMutation = useMutation({
    mutationFn: async (values: PartFormValues) => {
      const resolvedCategory = values.category === "__custom__"
        ? values.customCategory?.trim()
        : values.category?.trim();

      // Convertir unitPrice en string pour correspondre au schéma backend
      // En modification, le stock ne passe pas par la fiche : le serveur refuse `quantity`
      // (ajustement de stock tracé depuis la fiche pièce).
      const { quantity, ...rest } = values;
      const payload = {
        ...rest,
        ...(isEdit ? {} : { quantity }),
        category: resolvedCategory || undefined,
        customCategory: undefined,
        responsiblePerson: values.responsiblePerson?.trim() || undefined,
        deliveryReceiptNumber: values.deliveryReceiptNumber?.trim() || undefined,
        description: values.description?.trim() || undefined,
        location: values.location?.trim() || undefined,
        supplier: values.supplier?.trim() || undefined,
        unitPrice: values.unitPrice.toString()
      };
      return apiRequest(
        isEdit ? "PATCH" : "POST", 
        isEdit ? `/api/parts/${partId}` : "/api/parts", 
        payload
      );
    },
    onSuccess: () => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      toast({
        title: isEdit ? "Pièce mise à jour" : "Pièce créée",
        description: isEdit 
          ? "La pièce a été mise à jour avec succès." 
          : "La pièce a été ajoutée avec succès au stock.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/low-on-stock"] });
      setLocation("/inventory");
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, `Erreur lors de ${isEdit ? "la mise à jour" : "l'ajout"} de la pièce.`),
      });
    },
  });
  
  function onSubmit(values: PartFormValues) {
    if (values.category === "__custom__" && !values.customCategory?.trim()) {
      form.setError("customCategory", { message: "Précisez la catégorie" });
      return;
    }
    createPartMutation.mutate(values);
  }

  const selectedCategory = form.watch("category");

  // Nom hérité: affiché en repli par le combobox tant que la pièce n'est pas
  // rattachée par clé étrangère.
  const initialSupplier = (initialData?.supplier || "").trim();

  const effectiveResponsibles =
    inventoryResponsibles.length > 0
      ? inventoryResponsibles
      : user?.role === "warehouse"
        ? [
            {
              id: Number(user.id || 0),
              name: user.name || "",
              username: user.username || "",
              role: user.role || "warehouse",
            },
          ]
        : [];

  const responsibleOptions = effectiveResponsibles
    .map((responsible) => {
      const displayName = (responsible.name || responsible.username || "").trim();
      const username = (responsible.username || "").trim();
      const value = displayName || username;
      const label =
        displayName && username && displayName.toLowerCase() !== username.toLowerCase()
          ? `${displayName} (@${username})`
          : value;

      return { value, label };
    })
    .filter((option): option is { value: string; label: string } => option.value.length > 0);

  const deduplicatedResponsibleOptions = Array.from(
    new Map(responsibleOptions.map((option) => [option.value.toLowerCase(), option])).values(),
  ).sort((a, b) => a.label.localeCompare(b.label, "fr"));

  const initialResponsibleAlreadyMapped = initialResponsible
    ? effectiveResponsibles.some((responsible) => {
        const name = (responsible.name || "").trim().toLowerCase();
        const username = (responsible.username || "").trim().toLowerCase();
        const target = initialResponsible.toLowerCase();
        return target === name || target === username;
      })
    : false;

  if (
    initialResponsible &&
    !initialResponsibleAlreadyMapped &&
    !deduplicatedResponsibleOptions.some((option) => option.value.toLowerCase() === initialResponsible.toLowerCase())
  ) {
    deduplicatedResponsibleOptions.push({
      value: initialResponsible,
      label: initialResponsible,
    });
  }

  const isSingleResponsible = deduplicatedResponsibleOptions.length === 1;

  React.useEffect(() => {
    if (!isSingleResponsible) {
      return;
    }

    const onlyResponsible = deduplicatedResponsibleOptions[0]?.value;
    const currentValue = form.getValues("responsiblePerson");

    if (onlyResponsible && !currentValue) {
      form.setValue("responsiblePerson", onlyResponsible, {
        shouldDirty: false,
        shouldValidate: true,
      });
    }
  }, [deduplicatedResponsibleOptions, form, isSingleResponsible]);
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? "Modifier la pièce" : "Ajouter une pièce"}</CardTitle>
      </CardHeader>
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
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom</FormLabel>
                    <FormControl>
                      <Input placeholder="Filtre à huile" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Référence</FormLabel>
                    <FormControl>
                      <Input placeholder="FH-2345" {...field} disabled={isEdit} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Catégorie</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value && field.value.length > 0 ? field.value : undefined}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner une catégorie" />
                        </SelectTrigger>
                      </FormControl>
                        <SelectContent>
                          {PART_CATEGORIES.map((category) => (
                            <SelectItem key={category} value={category}>
                              {category}
                            </SelectItem>
                          ))}
                          <SelectItem value="__custom__">Autre...</SelectItem>
                        </SelectContent>
                      </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {selectedCategory === "__custom__" && (
                <FormField
                  control={form.control}
                  name="customCategory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Catégorie personnalisée</FormLabel>
                      <FormControl>
                        <Input placeholder="Saisir la catégorie" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="responsiblePerson"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Responsable magasin</FormLabel>
                    <FormControl>
                      <Select
                        onValueChange={(value) => field.onChange(value === "__none__" ? "" : value)}
                        value={field.value && field.value.length > 0 ? field.value : undefined}
                        disabled={isSingleResponsible}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner un responsable" />
                        </SelectTrigger>
                        <SelectContent>
                          {!isSingleResponsible && <SelectItem value="__none__">Non assigné</SelectItem>}
                          {deduplicatedResponsibleOptions.map((responsible) => (
                            <SelectItem key={responsible.value} value={responsible.value}>
                              {responsible.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="deliveryReceiptNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>N° bon livraison</FormLabel>
                    <FormControl>
                      <Input placeholder="BL-2026-001" {...field} />
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
                    <FormLabel>Quantité en stock</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} {...field} disabled={isEdit} />
                    </FormControl>
                    {isEdit && (
                      <FormDescription>Modifiable par l'ajustement de stock de la fiche pièce.</FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="minQuantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Seuil d'alerte</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="unit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unité</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value && field.value.length > 0 ? field.value : undefined}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner une unité" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PART_UNITS.map((unit) => (
                          <SelectItem key={unit} value={unit}>
                            {unit}
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
                name="unitPrice"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prix unitaire (XAF)</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} step={0.01} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Emplacement</FormLabel>
                    <FormControl>
                      <Input placeholder="Étagère A-12" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="supplierId"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Fournisseur</FormLabel>
                    <FormControl>
                      <SupplierCombobox
                        value={field.value ?? null}
                        legacyName={form.getValues("supplier") || initialSupplier}
                        onChange={(supplierId, supplierName) => {
                          field.onChange(supplierId);
                          // On écrit aussi le nom tant que des écrans lisent
                          // encore `parts.supplier`.
                          form.setValue("supplier", supplierName, { shouldDirty: true });
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Description détaillée de la pièce"
                        className="resize-none min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button 
              variant="outline" 
              type="button" 
              onClick={() => setLocation("/inventory")}
            >
              Annuler
            </Button>
            <Button 
              type="submit" 
              disabled={createPartMutation.isPending}
            >
              {createPartMutation.isPending ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-background border-t-foreground"></div>
                  Traitement...
                </>
              ) : (
                isEdit ? "Mettre à jour" : "Ajouter"
              )}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
