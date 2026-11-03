import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, Hammer, Pencil, Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useFormDraft } from "@/hooks/use-form-draft";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import {
  WORK_ORDER_ITEM_STATUSES,
  getWorkOrderItemStatusLabel,
  validateWorkOrderItem,
  type WorkOrderItemStatus,
  type WorkOrderItemTotals,
} from "@shared/constants/work-order-items";
import {
  WORK_ORDER_ITEM_DEFAULT_VALUES,
  isWorkOrderItemFormEmpty,
  workOrderItemDraftStorage,
  type WorkOrderItemFormValues,
} from "@/lib/work-order-item-draft";

type WorkOrderItem = {
  id: number;
  laborCatalogId: number | null;
  laborCatalogCode: string | null;
  standardHours: number | null;
  customLabel: string | null;
  label: string;
  technicianId: number | null;
  technicianName: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  status: WorkOrderItemStatus;
  notes: string | null;
};

type WorkOrderItemsResponse = {
  items: WorkOrderItem[];
  totals: WorkOrderItemTotals;
};

type LaborCatalogEntry = {
  id: number;
  code: string;
  label: string;
  standardHours: number | null;
};

type Technician = { id: number; name: string; role?: string };

const NONE = "none";

const STATUS_STYLES: Record<WorkOrderItemStatus, string> = {
  pending: "bg-slate-50 text-slate-700 border-slate-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  done: "bg-green-50 text-green-700 border-green-200",
  cancelled: "bg-gray-50 text-gray-500 border-gray-200 line-through",
};

function formatHours(value: number | null): string {
  return value === null ? "—" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;
}

function toFormValues(item: WorkOrderItem): WorkOrderItemFormValues {
  return {
    laborCatalogId: item.laborCatalogId ? String(item.laborCatalogId) : "",
    customLabel: item.laborCatalogId ? "" : item.customLabel ?? "",
    technicianId: item.technicianId ? String(item.technicianId) : "",
    estimatedHours: item.estimatedHours === null ? "" : String(item.estimatedHours),
    actualHours: item.actualHours === null ? "" : String(item.actualHours),
    status: item.status,
    notes: item.notes ?? "",
  };
}

/** Le formulaire parle en chaînes, l'API en nombres ou `null`. */
function toPayload(values: WorkOrderItemFormValues) {
  const laborCatalogId = values.laborCatalogId ? Number(values.laborCatalogId) : null;
  return {
    laborCatalogId,
    customLabel: laborCatalogId ? null : values.customLabel.trim(),
    technicianId: values.technicianId ? Number(values.technicianId) : null,
    estimatedHours: values.estimatedHours.trim() === "" ? null : values.estimatedHours.replace(",", "."),
    actualHours: values.actualHours.trim() === "" ? null : values.actualHours.replace(",", "."),
    status: values.status,
    notes: values.notes,
  };
}

interface WorkOrderItemsPanelProps {
  workOrderId: number;
  userId?: number;
  /** Ajouter, modifier, supprimer: mêmes rôles que la garde serveur `isTechnician`. */
  canEdit: boolean;
  /** Technicien proposé par défaut: celui de l'OT. */
  defaultTechnicianId?: number | null;
}

/**
 * Lignes de travail d'un OT: qui a passé combien de temps sur quoi.
 *
 * Des heures, jamais des montants (docs/plans/lignes-de-travail-ot.md).
 */
export function WorkOrderItemsPanel({ workOrderId, userId, canEdit, defaultTechnicianId }: WorkOrderItemsPanelProps) {
  const { toast } = useToast();
  const itemsKey = [`/api/work-orders/${workOrderId}/items`];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkOrderItem | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const { data, isLoading } = useQuery<WorkOrderItemsResponse>({
    queryKey: itemsKey,
    enabled: !!workOrderId,
  });
  const { data: catalog = [] } = useQuery<LaborCatalogEntry[]>({ queryKey: ["/api/labor-catalog"], enabled: canEdit });
  const { data: technicians = [] } = useQuery<Technician[]>({ queryKey: ["/api/users/technicians"], enabled: canEdit });

  const items = data?.items ?? [];
  const totals = data?.totals;

  const storage = useMemo(() => workOrderItemDraftStorage(workOrderId), [workOrderId]);
  const form = useForm<WorkOrderItemFormValues>({ defaultValues: WORK_ORDER_ITEM_DEFAULT_VALUES });

  // Brouillon seulement pour une nouvelle ligne: modifier une ligne existante
  // repart toujours de ce qui est enregistré.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form,
    storage,
    userId,
    enabled: canEdit && editingItem === null,
    isEmpty: isWorkOrderItemFormEmpty,
  });

  const laborCatalogId = form.watch("laborCatalogId");
  const selectedStandard = catalog.find((entry) => String(entry.id) === laborCatalogId)?.standardHours ?? null;

  /** Couche 1 et 3: la réponse porte la liste à jour, on la pose dans le cache. */
  const onSaved = (result: WorkOrderItemsResponse) => {
    queryClient.setQueryData(itemsKey, { items: result.items, totals: result.totals });
    queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${workOrderId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
  };

  const onError = (error: unknown) => {
    toast({
      title: "Ligne non enregistrée",
      description: error instanceof Error ? error.message : "Erreur inconnue",
      variant: "destructive",
    });
  };

  const saveMutation = useMutation({
    mutationFn: async (values: WorkOrderItemFormValues) => {
      const response = editingItem
        ? await apiRequest("PATCH", `/api/work-order-items/${editingItem.id}`, toPayload(values))
        : await apiRequest("POST", `/api/work-orders/${workOrderId}/items`, toPayload(values));
      return (await response.json()) as WorkOrderItemsResponse;
    },
    onSuccess: (result) => {
      onSaved(result);
      if (!editingItem) clearDraft();
      toast({ title: editingItem ? "Ligne de travail modifiée" : "Ligne de travail ajoutée" });
      closeDialog();
    },
    onError,
  });

  const deleteMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const response = await apiRequest("DELETE", `/api/work-order-items/${itemId}`);
      return (await response.json()) as WorkOrderItemsResponse;
    },
    onSuccess: (result) => {
      onSaved(result);
      toast({ title: "Ligne de travail supprimée" });
    },
    onError,
  });

  function openCreate() {
    setEditingItem(null);
    setFormErrors([]);
    // Un brouillon restauré est déjà dans le formulaire: ne pas l'écraser.
    if (!draftSavedAt) {
      form.reset({
        ...WORK_ORDER_ITEM_DEFAULT_VALUES,
        technicianId: defaultTechnicianId ? String(defaultTechnicianId) : "",
      });
    }
    setDialogOpen(true);
  }

  function openEdit(item: WorkOrderItem) {
    setEditingItem(item);
    setFormErrors([]);
    form.reset(toFormValues(item));
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setFormErrors([]);
    if (editingItem) {
      setEditingItem(null);
      form.reset(WORK_ORDER_ITEM_DEFAULT_VALUES);
    }
  }

  function submit(values: WorkOrderItemFormValues) {
    // Mêmes règles que le serveur, lues depuis la même source.
    const verdict = validateWorkOrderItem(toPayload(values));
    if (!verdict.valid) {
      setFormErrors(verdict.errors);
      return;
    }
    saveMutation.mutate(values);
  }

  function onCatalogChange(value: string) {
    const id = value === NONE ? "" : value;
    form.setValue("laborCatalogId", id, { shouldDirty: true });
    // Le barème sert de valeur de départ pour l'estimé, jamais pour le réel.
    const standard = catalog.find((entry) => String(entry.id) === id)?.standardHours;
    if (standard != null && form.getValues("estimatedHours").trim() === "") {
      form.setValue("estimatedHours", String(standard), { shouldDirty: true });
    }
  }

  const variance = totals?.varianceHours ?? null;

  return (
    <div className="rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 overflow-hidden">
      <div className="h-0.5 bg-gradient-to-r from-sky-500 to-indigo-400" />
      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-sky-50 dark:bg-sky-950/40 flex items-center justify-center">
              <Hammer className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
            </div>
            <span className="text-sm font-semibold text-foreground">Travaux réalisés</span>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" />
              Ajouter une ligne
            </Button>
          )}
        </div>

        {totals && totals.lineCount > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">Heures réelles</div>
              <div className="text-lg font-semibold text-foreground">{formatHours(totals.actualHours)}</div>
              {totals.unmeasuredLineCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  Total partiel : {totals.unmeasuredLineCount} ligne{totals.unmeasuredLineCount > 1 ? "s" : ""} sans heures réelles
                </div>
              )}
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">Barème (lignes comparables)</div>
              <div className="text-lg font-semibold text-foreground">{formatHours(totals.standardHours)}</div>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <div className="text-xs text-muted-foreground">Écart au barème</div>
              <div
                className={`text-lg font-semibold ${
                  variance === null ? "text-foreground" : variance > 0 ? "text-orange-600" : "text-green-600"
                }`}
              >
                {variance === null ? "—" : `${variance > 0 ? "+" : ""}${formatHours(variance)}`}
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <Clock className="h-8 w-8" />
            <p className="text-sm">Aucune ligne de travail enregistrée</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Travail</th>
                  <th className="py-2 pr-3 font-medium">Technicien</th>
                  <th className="py-2 pr-3 font-medium text-right">Barème</th>
                  <th className="py-2 pr-3 font-medium text-right">Estimé</th>
                  <th className="py-2 pr-3 font-medium text-right">Réel</th>
                  <th className="py-2 pr-3 font-medium">Statut</th>
                  {canEdit && <th className="py-2 font-medium sr-only">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0" data-testid={`work-order-item-${item.id}`}>
                    <td className="py-2 pr-3">
                      <div className="font-medium text-foreground">{item.label}</div>
                      {item.laborCatalogCode && (
                        <div className="text-xs text-muted-foreground">{item.laborCatalogCode}</div>
                      )}
                      {item.notes && <div className="text-xs text-muted-foreground">{item.notes}</div>}
                    </td>
                    <td className="py-2 pr-3">{item.technicianName ?? <span className="text-muted-foreground">Non affecté</span>}</td>
                    <td className="py-2 pr-3 text-right">{formatHours(item.standardHours)}</td>
                    <td className="py-2 pr-3 text-right">{formatHours(item.estimatedHours)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{formatHours(item.actualHours)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="outline" className={STATUS_STYLES[item.status]}>
                        {getWorkOrderItemStatusLabel(item.status)}
                      </Badge>
                    </td>
                    {canEdit && (
                      <td className="py-2 text-right whitespace-nowrap">
                        <Button variant="ghost" size="icon" aria-label="Modifier la ligne" onClick={() => openEdit(item)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Supprimer la ligne"
                          disabled={deleteMutation.isPending}
                          onClick={() => {
                            if (window.confirm(`Supprimer la ligne « ${item.label} » ?`)) {
                              deleteMutation.mutate(item.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Modifier la ligne de travail" : "Ajouter une ligne de travail"}</DialogTitle>
            <DialogDescription>Temps passé sur l'intervention. Aucun montant n'est calculé.</DialogDescription>
          </DialogHeader>

          <form id="work-order-item-form" onSubmit={form.handleSubmit(submit)} className="space-y-3">
            <div className="space-y-1.5">
              <Label>Poste du catalogue</Label>
              <Select value={laborCatalogId || NONE} onValueChange={onCatalogChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Travail hors catalogue" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Travail hors catalogue</SelectItem>
                  {catalog.map((entry) => (
                    <SelectItem key={entry.id} value={String(entry.id)}>
                      {entry.label} ({entry.code}){entry.standardHours != null ? ` — ${formatHours(entry.standardHours)}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedStandard != null && (
                <p className="text-xs text-muted-foreground">Barème : {formatHours(selectedStandard)}</p>
              )}
            </div>

            {!laborCatalogId && (
              <div className="space-y-1.5">
                <Label htmlFor="wo-item-label">Libellé du travail</Label>
                <Input id="wo-item-label" placeholder="Ex. remplacement durite radiateur" {...form.register("customLabel")} />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Technicien</Label>
                <Select
                  value={form.watch("technicianId") || NONE}
                  onValueChange={(value) => form.setValue("technicianId", value === NONE ? "" : value, { shouldDirty: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Non affecté" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Non affecté</SelectItem>
                    {technicians.map((tech) => (
                      <SelectItem key={tech.id} value={String(tech.id)}>
                        {tech.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Statut</Label>
                <Select
                  value={form.watch("status")}
                  onValueChange={(value) => form.setValue("status", value, { shouldDirty: true })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORK_ORDER_ITEM_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {getWorkOrderItemStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wo-item-estimated">Heures estimées</Label>
                <Input id="wo-item-estimated" inputMode="decimal" placeholder="Ex. 1,5" {...form.register("estimatedHours")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wo-item-actual">Heures réelles</Label>
                <Input id="wo-item-actual" inputMode="decimal" placeholder="Laisser vide si non mesuré" {...form.register("actualHours")} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wo-item-notes">Notes</Label>
              <Textarea id="wo-item-notes" rows={2} {...form.register("notes")} />
            </div>

            {formErrors.length > 0 && (
              <ul className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                {formErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}
          </form>

          <DialogFooter className="flex-wrap items-center gap-2 sm:justify-between">
            <div className="flex items-center gap-2">
              {!editingItem && (
                <>
                  <FormDraftBadge savedAt={draftSavedAt} />
                  <FormDraftDiscardButton
                    savedAt={draftSavedAt}
                    onDiscard={() => discardDraft(WORK_ORDER_ITEM_DEFAULT_VALUES)}
                  />
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={closeDialog}>
                Annuler
              </Button>
              <Button type="submit" form="work-order-item-form" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
