import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Wrench, Package, FileText, Euro } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { partCategoryDraft, partSpecificationDraft, partVariantDraft } from "@/lib/form-drafts";

// Schémas de validation
const categorySchema = z.object({
  name: z.string().min(1, "Le nom est requis"),
  description: z.string().optional(),
});

const specificationSchema = z.object({
  partId: z.number(),
  specificationName: z.string().min(1, "Le nom de la spécification est requis"),
  specificationValue: z.string().min(1, "La valeur est requise"),
  unit: z.string().optional(),
});

const variantSchema = z.object({
  partId: z.number(),
  variantName: z.string().min(1, "Le nom de la variante est requis"),
  variantCode: z.string().min(1, "Le code est requis"),
  additionalPrice: z.number().min(0, "Le prix doit être positif"),
  isAvailable: z.boolean().default(true),
});

export default function PartsDatabasePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);

  // Queries pour récupérer les données
  const { data: parts = [], isLoading: partsLoading } = useQuery<any>({
    queryKey: ["/api/parts"],
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<any>({
    queryKey: ["/api/parts/categories"],
  });

  const { data: specifications = [] } = useQuery<any>({
    queryKey: ["/api/parts/specifications"],
    enabled: !!selectedPartId,
  });

  const { data: variants = [] } = useQuery<any>({
    queryKey: ["/api/parts/variants"],
    enabled: !!selectedPartId,
  });

  // Mutations
  const createCategoryMutation = useMutation({
    mutationFn: (data: z.infer<typeof categorySchema>) =>
      apiRequest("/api/parts/categories", { method: "POST", body: data }),
    onSuccess: () => {
      clearDraftCategory(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      queryClient.invalidateQueries({ queryKey: ["/api/parts/categories"] });
      toast({ title: "Catégorie créée avec succès" });
    },
  });

  const createSpecificationMutation = useMutation({
    mutationFn: (data: z.infer<typeof specificationSchema>) =>
      apiRequest("/api/parts/specifications", { method: "POST", body: data }),
    onSuccess: () => {
      clearDraftSpecification(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      queryClient.invalidateQueries({ queryKey: ["/api/parts/specifications"] });
      toast({ title: "Spécification ajoutée avec succès" });
    },
  });

  const createVariantMutation = useMutation({
    mutationFn: (data: z.infer<typeof variantSchema>) =>
      apiRequest("/api/parts/variants", { method: "POST", body: data }),
    onSuccess: () => {
      clearDraftVariant(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      queryClient.invalidateQueries({ queryKey: ["/api/parts/variants"] });
      toast({ title: "Variante créée avec succès" });
    },
  });

  // Forms
  const categoryForm = useForm<z.infer<typeof categorySchema>>({
    resolver: zodResolver(categorySchema),
    defaultValues: { name: "", description: "" },
  });

  const { draftSavedAt: draftCategory, clearDraft: clearDraftCategory, discardDraft: discardDraftCategory } = useFormDraft({
    form: categoryForm as any,
    storage: partCategoryDraft.storage as any,
    isEmpty: partCategoryDraft.isEmpty as any,
  });

  const specificationForm = useForm<z.infer<typeof specificationSchema>>({
    resolver: zodResolver(specificationSchema),
    defaultValues: { partId: selectedPartId || 0, specificationName: "", specificationValue: "", unit: "" },
  });

  const { draftSavedAt: draftSpecification, clearDraft: clearDraftSpecification, discardDraft: discardDraftSpecification } = useFormDraft({
    form: specificationForm as any,
    storage: partSpecificationDraft.storage as any,
    isEmpty: partSpecificationDraft.isEmpty as any,
  });

  const variantForm = useForm<z.infer<typeof variantSchema>>({
    resolver: zodResolver(variantSchema),
    defaultValues: { 
      partId: selectedPartId || 0, 
      variantName: "", 
      variantCode: "", 
      additionalPrice: 0, 
      isAvailable: true 
    },
  });

  const { draftSavedAt: draftVariant, clearDraft: clearDraftVariant, discardDraft: discardDraftVariant } = useFormDraft({
    form: variantForm as any,
    storage: partVariantDraft.storage as any,
    isEmpty: partVariantDraft.isEmpty as any,
  });

  const onCreateCategory = (data: z.infer<typeof categorySchema>) => {
    createCategoryMutation.mutate(data);
    categoryForm.reset();
  };

  const onCreateSpecification = (data: z.infer<typeof specificationSchema>) => {
    if (!selectedPartId) return;
    createSpecificationMutation.mutate({ ...data, partId: selectedPartId });
    specificationForm.reset();
  };

  const onCreateVariant = (data: z.infer<typeof variantSchema>) => {
    if (!selectedPartId) return;
    createVariantMutation.mutate({ ...data, partId: selectedPartId });
    variantForm.reset();
  };

  const isInitialLoading = partsLoading || categoriesLoading;

  if (isInitialLoading) {
    return (
      <div className="container mx-auto p-6 space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-80" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Base de données des pièces
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Gérez les catégories, spécifications et variantes de pièces
          </p>
        </div>
      </div>

      <Tabs defaultValue="parts" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="parts" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Pièces
          </TabsTrigger>
          <TabsTrigger value="categories" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Catégories
          </TabsTrigger>
          <TabsTrigger value="specifications" className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            Spécifications
          </TabsTrigger>
          <TabsTrigger value="variants" className="flex items-center gap-2">
            <Euro className="h-4 w-4" />
            Variantes & Prix
          </TabsTrigger>
        </TabsList>

        <TabsContent value="parts">
          <Card>
            <CardHeader>
              <CardTitle>Sélectionner une pièce</CardTitle>
              <CardDescription>
                Choisissez une pièce pour gérer ses spécifications et variantes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {parts.map((part: any) => (
                  <Card 
                    key={part.id} 
                    className={`cursor-pointer transition-colors ${
                      selectedPartId === part.id 
                        ? 'ring-2 ring-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                    onClick={() => setSelectedPartId(part.id)}
                  >
                    <CardContent className="p-4">
                      <h3 className="font-semibold">{part.name}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">{part.reference}</p>
                      <div className="flex justify-between items-center mt-2">
                        <Badge variant="outline">
                          {part.unitPrice ? `${part.unitPrice.toLocaleString()} XAF` : 'Prix non défini'}
                        </Badge>
                        <span className="text-sm text-gray-500">Stock: {part.currentStock}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Créer une catégorie</CardTitle>
                <CardDescription>
                  Ajoutez une nouvelle catégorie de pièces
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...categoryForm}>
                  <form onSubmit={categoryForm.handleSubmit(onCreateCategory)} className="space-y-4">
                    {draftCategory && (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <FormDraftBadge savedAt={draftCategory} />
                        <FormDraftDiscardButton savedAt={draftCategory} onDiscard={() => discardDraftCategory(categoryForm.getValues())} />
                      </div>
                    )}
                    <FormField
                      control={categoryForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Nom de la catégorie</FormLabel>
                          <FormControl>
                            <Input placeholder="ex: Freinage" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={categoryForm.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <Textarea placeholder="Description de la catégorie..." {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button 
                      type="submit" 
                      disabled={createCategoryMutation.isPending}
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Créer la catégorie
                    </Button>
                  </form>
                </Form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Catégories existantes</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {categories.map((category: any) => (
                    <div key={category.id} className="p-3 border rounded-lg">
                      <h4 className="font-medium">{category.name}</h4>
                      {category.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {category.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="specifications">
          {!selectedPartId ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center text-gray-500">
                  Sélectionnez d'abord une pièce dans l'onglet "Pièces"
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Ajouter une spécification</CardTitle>
                  <CardDescription>
                    Définissez les caractéristiques techniques de la pièce
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...specificationForm}>
                    <form onSubmit={specificationForm.handleSubmit(onCreateSpecification)} className="space-y-4">
                      {draftSpecification && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <FormDraftBadge savedAt={draftSpecification} />
                          <FormDraftDiscardButton savedAt={draftSpecification} onDiscard={() => discardDraftSpecification(specificationForm.getValues())} />
                        </div>
                      )}
                      <FormField
                        control={specificationForm.control}
                        name="specificationName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nom de la spécification</FormLabel>
                            <FormControl>
                              <Input placeholder="ex: Diamètre" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={specificationForm.control}
                        name="specificationValue"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Valeur</FormLabel>
                            <FormControl>
                              <Input placeholder="ex: 280" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={specificationForm.control}
                        name="unit"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Unité (optionnel)</FormLabel>
                            <FormControl>
                              <Input placeholder="ex: mm" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        disabled={createSpecificationMutation.isPending}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Ajouter la spécification
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Spécifications existantes</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Spécification</TableHead>
                        <TableHead>Valeur</TableHead>
                        <TableHead>Unité</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {specifications.map((spec: any) => (
                        <TableRow key={spec.id}>
                          <TableCell className="font-medium">{spec.specificationName}</TableCell>
                          <TableCell>{spec.specificationValue}</TableCell>
                          <TableCell>{spec.unit || '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="variants">
          {!selectedPartId ? (
            <Card>
              <CardContent className="pt-6">
                <div className="text-center text-gray-500">
                  Sélectionnez d'abord une pièce dans l'onglet "Pièces"
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Créer une variante</CardTitle>
                  <CardDescription>
                    Ajoutez différentes options avec leurs prix
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...variantForm}>
                    <form onSubmit={variantForm.handleSubmit(onCreateVariant)} className="space-y-4">
                      {draftVariant && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <FormDraftBadge savedAt={draftVariant} />
                          <FormDraftDiscardButton savedAt={draftVariant} onDiscard={() => discardDraftVariant(variantForm.getValues())} />
                        </div>
                      )}
                      <FormField
                        control={variantForm.control}
                        name="variantName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Nom de la variante</FormLabel>
                            <FormControl>
                              <Input placeholder="ex: Haute performance" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={variantForm.control}
                        name="variantCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Code de la variante</FormLabel>
                            <FormControl>
                              <Input placeholder="ex: DF-280MM-HP" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={variantForm.control}
                        name="additionalPrice"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Prix supplémentaire (en centimes)</FormLabel>
                            <FormControl>
                              <Input 
                                type="number" 
                                placeholder="ex: 1500 (pour 15,00 €)"
                                {...field}
                                onChange={(e) => field.onChange(Number(e.target.value))}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button 
                        type="submit" 
                        disabled={createVariantMutation.isPending}
                        className="w-full"
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Créer la variante
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Variantes existantes</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nom</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Prix +</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {variants.map((variant: any) => (
                        <TableRow key={variant.id}>
                          <TableCell className="font-medium">{variant.variantName}</TableCell>
                          <TableCell>{variant.variantCode}</TableCell>
                          <TableCell>
                            {variant.additionalPrice > 0 
                              ? `+${variant.additionalPrice.toLocaleString()} XAF` 
                              : 'Standard'
                            }
                          </TableCell>
                          <TableCell>
                            <Badge variant={variant.isAvailable ? "default" : "secondary"}>
                              {variant.isAvailable ? 'Disponible' : 'Indisponible'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
