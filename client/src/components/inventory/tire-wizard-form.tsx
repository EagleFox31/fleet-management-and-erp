import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  Package,
  Save,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { Stepper } from "@/components/workflow/stepper";
import { TireBrandCombobox } from "@/components/inventory/tire-brand-combobox";
import { TireDotInput } from "@/components/inventory/tire-dot-input";
import { TireLoadIndexCombobox } from "@/components/inventory/tire-load-index-combobox";
import { TireSizeFields } from "@/components/inventory/tire-size-fields";
import { TireSupplierCombobox } from "@/components/inventory/tire-supplier-combobox";
import { useFormDraft } from "@/hooks/use-form-draft";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatDraftSavedTime } from "@/lib/form-draft-storage";
import { apiRequest } from "@/lib/queryClient";
import { tireWizardDraftStorage, type TireWizardDraftMeta } from "@/lib/tire-wizard-draft";
import {
  TIRE_MANUFACTURING_WEEKS,
  TIRE_SPEED_RATINGS,
  TIRE_USAGE_TYPES,
  formatTireSize,
  getTireManufacturingYears,
} from "@shared/constants/tires";
import {
  TIRE_WIZARD_STEP_FIELDS,
  TIRE_WIZARD_STEPS,
  TIRE_WIZARD_TOTAL_STEPS,
  getDefaultTireFormValues,
  tireFormSchema,
  type TireFormData,
} from "@shared/tire-form";

const MANUFACTURING_YEARS = getTireManufacturingYears();
const panelClass = "space-y-4 rounded-xl border border-green-200 bg-green-50/80 p-5";

interface TireWizardFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function TireWizardForm({ onSuccess, onCancel }: TireWizardFormProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);

  const form = useForm<TireFormData>({
    resolver: zodResolver(tireFormSchema),
    defaultValues: getDefaultTireFormValues(),
    mode: "onChange",
  });

  const { draftSavedAt, persistDraft, clearDraft, discardDraft } = useFormDraft<
    TireFormData,
    TireWizardDraftMeta
  >({
    form,
    storage: tireWizardDraftStorage,
    userId: user?.id,
    getMeta: () => ({ step: currentStep }),
    applyMeta: (meta) =>
      setCurrentStep(Math.min(Math.max(meta.step, 1), TIRE_WIZARD_TOTAL_STEPS)),
    isEmpty: (data) => !data.brand?.trim() && !data.model?.trim(),
    restoreDescription: (draft) =>
      `Reprise à l'étape ${draft.meta?.step ?? 1} (sauvegarde ${formatDraftSavedTime(draft.savedAt)}).`,
  });

  const createTireMutation = useMutation({
    mutationFn: async (data: TireFormData) => {
      return apiRequest("POST", "/api/tires", data);
    },
    onSuccess: () => {
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ["/api/tires"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tires/statistics-advanced"] });
      form.reset(getDefaultTireFormValues());
      setCurrentStep(1);
      toast({
        title: "Pneu ajouté",
        description: "Le pneu a été enregistré dans l'inventaire.",
      });
      onSuccess?.();
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: error.message || "Impossible d'enregistrer le pneu. Vérifiez les champs obligatoires.",
        variant: "destructive",
      });
    },
  });

  const goToNextStep = async () => {
    const fields = TIRE_WIZARD_STEP_FIELDS[currentStep];
    if (fields.length > 0) {
      const valid = await form.trigger(fields);
      if (!valid) {
        return;
      }
    }

    const nextStep = Math.min(currentStep + 1, TIRE_WIZARD_TOTAL_STEPS);
    setCurrentStep(nextStep);
    persistDraft(form.getValues(), { step: nextStep });
  };

  const goToPreviousStep = () => {
    const prevStep = Math.max(currentStep - 1, 1);
    setCurrentStep(prevStep);
    persistDraft(form.getValues(), { step: prevStep });
  };

  const handleDiscardDraft = () => {
    discardDraft(getDefaultTireFormValues(), () => setCurrentStep(1));
  };

  const onSubmit = (data: TireFormData) => {
    createTireMutation.mutate(data);
  };

  const summary = form.watch();
  const sizePreview = formatTireSize(summary.sizeWidth, summary.sizeAspect, summary.sizeDiameter);

  return (
    <Card className="overflow-hidden rounded-[28px] border border-slate-200/80 shadow-sm">
      <div className="h-0.5 bg-gradient-to-r from-green-700 via-emerald-500 to-lime-400" />
      <CardHeader className="border-b bg-white/80 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Package className="h-5 w-5 text-green-700" />
              Nouveau pneu — assistant
            </CardTitle>
            <CardDescription>Saisie guidée en {TIRE_WIZARD_TOTAL_STEPS} étapes avec brouillon automatique</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full">
              Étape {currentStep}/{TIRE_WIZARD_TOTAL_STEPS}
            </Badge>
            <FormDraftBadge savedAt={draftSavedAt} />
          </div>
        </div>
        <Stepper currentStep={currentStep} steps={[...TIRE_WIZARD_STEPS]} />
      </CardHeader>

      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {currentStep === 1 ? (
              <div className={panelClass}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="brand"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Marque <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <TireBrandCombobox value={field.value} onChange={field.onChange} />
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
                        <FormLabel>Modèle <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="ex: X Multi Energy" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <TireSizeFields
                  width={form.watch("sizeWidth")}
                  aspect={form.watch("sizeAspect")}
                  diameter={form.watch("sizeDiameter")}
                  onWidthChange={(value) => form.setValue("sizeWidth", value, { shouldValidate: true })}
                  onAspectChange={(value) => form.setValue("sizeAspect", value, { shouldValidate: true })}
                  onDiameterChange={(value) =>
                    form.setValue("sizeDiameter", value, { shouldValidate: true })
                  }
                  onPresetSelect={(preset) => {
                    form.setValue("sizeWidth", preset.width, { shouldValidate: true });
                    form.setValue("sizeAspect", preset.aspect, { shouldValidate: true });
                    form.setValue("sizeDiameter", preset.diameter, { shouldValidate: true });
                  }}
                  widthError={form.formState.errors.sizeWidth?.message}
                  aspectError={form.formState.errors.sizeAspect?.message}
                  diameterError={form.formState.errors.sizeDiameter?.message}
                />
              </div>
            ) : null}

            {currentStep === 2 ? (
              <div className={panelClass}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="tireType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Essieu / usage <span className="text-red-500">*</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Sélectionnez..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {TIRE_USAGE_TYPES.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
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
                    name="compound"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Saison / compound</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="ete">Été</SelectItem>
                            <SelectItem value="hiver">Hiver</SelectItem>
                            <SelectItem value="toutes_saisons">Toutes saisons</SelectItem>
                            <SelectItem value="rechape">Rechapé</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="speedRating"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Indice vitesse <span className="text-red-500">*</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Lettre" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {TIRE_SPEED_RATINGS.map((rating) => (
                              <SelectItem key={rating.code} value={rating.code}>
                                {rating.code} — {rating.kmh} km/h
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
                    name="loadIndex"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Indice charge <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <TireLoadIndexCombobox value={field.value} onChange={field.onChange} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="reinforcement"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Renforcement</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="renforce">Renforcé</SelectItem>
                            <SelectItem value="extra_load">Extra Load</SelectItem>
                            <SelectItem value="xl">XL</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="treadPattern"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Motif sculpture</FormLabel>
                        <FormControl>
                          <Input placeholder="ex: Nervuré route" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="qualityGrade"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Grade qualité</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="premium">Premium</SelectItem>
                            <SelectItem value="standard">Standard</SelectItem>
                            <SelectItem value="economique">Économique</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="approvals"
                    render={({ field }) => (
                      <FormItem className="md:col-span-2">
                        <FormLabel>Homologations</FormLabel>
                        <FormControl>
                          <Input placeholder="ex: ECE R54, DOT…" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div className={panelClass}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="serialNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>N° de série</FormLabel>
                        <FormControl>
                          <Input placeholder="Optionnel" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="batchNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>N° de lot</FormLabel>
                        <FormControl>
                          <Input placeholder="Optionnel" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="dotCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code DOT (flanc)</FormLabel>
                      <FormControl>
                        <TireDotInput
                          value={field.value ?? ""}
                          manufacturingWeek={form.watch("manufacturingWeek")}
                          manufacturingYear={form.watch("manufacturingYear")}
                          onChange={field.onChange}
                          onManufacturingChange={(week, year) => {
                            form.setValue("manufacturingWeek", week, { shouldValidate: true });
                            form.setValue("manufacturingYear", year, { shouldValidate: true });
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="manufacturingWeek"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Semaine fabrication <span className="text-red-500">*</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Semaine DOT" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-72">
                            {TIRE_MANUFACTURING_WEEKS.map((week) => (
                              <SelectItem key={week.value} value={week.value}>
                                {week.label}
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
                    name="manufacturingYear"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Année fabrication <span className="text-red-500">*</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Année" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent className="max-h-72">
                            {MANUFACTURING_YEARS.map((year) => (
                              <SelectItem key={year.value} value={year.value}>
                                {year.label}
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
            ) : null}

            {currentStep === 4 ? (
              <div className={panelClass}>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="stockQuantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantité stock <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            onChange={(event) => field.onChange(Number(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="minStockLevel"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Seuil minimal <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            onChange={(event) => field.onChange(Number(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="purchasePrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prix d'achat (FCFA) <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            onChange={(event) => field.onChange(Number(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="supplier"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Fournisseur <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <TireSupplierCombobox value={field.value} onChange={field.onChange} />
                        </FormControl>
                        {/* Une aide de formulaire dit à l'utilisateur quoi saisir.
                            L'ancien texte décrivait l'architecture (« même référentiel
                            que les pièces », chemin de route `/procurement/suppliers`,
                            abréviation « PL ») : de l'information de développeur
                            livrée au magasinier. */}
                        <FormDescription>
                          Le fournisseur chez qui ces pneus ont été achetés. S'il n'est pas
                          dans la liste, tapez son nom pour le créer.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="location"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Emplacement <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input placeholder="ex: Zone pneus B12" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="receptionDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date réception <span className="text-red-500">*</span></FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="warrantyMonths"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Garantie (mois)</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            {...field}
                            onChange={(event) => field.onChange(Number(event.target.value))}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            ) : null}

            {currentStep === 5 ? (
              <div className="space-y-4">
                <div className={panelClass}>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes générales</FormLabel>
                          <FormControl>
                            <Textarea rows={3} placeholder="Observations…" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="inspectionNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notes inspection réception</FormLabel>
                          <FormControl>
                            <Textarea rows={3} placeholder="Contrôle visuel…" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
                  <p className="mb-3 font-semibold text-slate-900">Récapitulatif</p>
                  <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <div>
                      <dt className="text-muted-foreground">Produit</dt>
                      <dd className="font-medium">
                        {summary.brand} {summary.model} — {sizePreview}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Indices</dt>
                      <dd className="font-medium">
                        Charge {summary.loadIndex} · Vitesse {summary.speedRating}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Fabrication</dt>
                      <dd className="font-medium">
                        Sem. {summary.manufacturingWeek || "—"} / {summary.manufacturingYear || "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Stock</dt>
                      <dd className="font-medium">
                        {summary.stockQuantity} unité(s) · seuil {summary.minStockLevel} ·{" "}
                        {summary.purchasePrice.toLocaleString("fr-FR")} FCFA
                      </dd>
                    </div>
                    <div className="md:col-span-2">
                      <dt className="text-muted-foreground">Fournisseur / emplacement</dt>
                      <dd className="font-medium">
                        {summary.supplier || "—"} · {summary.location || "—"}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onCancel}>
                  Annuler
                </Button>
                <FormDraftDiscardButton savedAt={draftSavedAt} onDiscard={handleDiscardDraft} />
              </div>

              <div className="flex flex-wrap gap-2">
                {currentStep > 1 ? (
                  <Button type="button" variant="outline" onClick={goToPreviousStep}>
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Précédent
                  </Button>
                ) : null}

                {currentStep < TIRE_WIZARD_TOTAL_STEPS ? (
                  <Button type="button" onClick={goToNextStep}>
                    Suivant
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={createTireMutation.isPending} className="min-w-36">
                    {createTireMutation.isPending ? (
                      <>
                        <Activity className="mr-2 h-4 w-4 animate-spin" />
                        Enregistrement…
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Enregistrer le pneu
                      </>
                    )}
                  </Button>
                )}
              </div>
            </div>

            {currentStep < TIRE_WIZARD_TOTAL_STEPS ? (
              <p className="text-center text-xs text-muted-foreground">
                <Check className="mr-1 inline h-3 w-3" />
                Brouillon sauvegardé automatiquement à chaque étape
              </p>
            ) : null}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
