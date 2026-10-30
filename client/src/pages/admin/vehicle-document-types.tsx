import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import {
  VEHICLE_DOCUMENT_TYPES_PATH,
  createVehicleDocumentTypeRequestSchema,
  vehicleDocumentTypePath,
  vehicleDocumentTypeSchema,
  type VehicleDocumentType,
} from "@shared/contracts/vehicle-document-types";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/layout/page-header";
import { PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system/premium-data-table";
import { LoadingError } from "@/components/ui/loading-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { appToast } from "@/lib/app-toast";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useVehicleDocumentTypes } from "@/hooks/use-vehicle-document-types";

type FormValues = {
  code: string;
  label: string;
  validityMonths: number | null;
  alertDays: number;
  active: boolean;
  sortOrder: number;
};

const EMPTY: FormValues = { code: "", label: "", validityMonths: null, alertDays: 30, active: true, sortOrder: 100 };

/** Champ numerique : vide = `emptyValue` (null pour une duree libre, 0 sinon). */
function toNumber(raw: string, emptyValue: number | null): number | null {
  if (raw.trim() === "") return emptyValue;
  const n = Number(raw);
  return Number.isNaN(n) ? emptyValue : n;
}

export default function VehicleDocumentTypesPage() {
  const query = useVehicleDocumentTypes();
  const [editing, setEditing] = useState<VehicleDocumentType | null>(null);
  const [open, setOpen] = useState(false);
  const isEdit = editing !== null;

  const form = useForm<FormValues>({
    resolver: zodResolver(createVehicleDocumentTypeRequestSchema),
    defaultValues: EMPTY,
  });

  const openDialog = (type: VehicleDocumentType | null) => {
    setEditing(type);
    form.reset(type ?? EMPTY);
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async ({ code, values, create }: { code: string; values: FormValues; create: boolean }) => {
      const res = create
        ? await apiRequest("POST", VEHICLE_DOCUMENT_TYPES_PATH, values)
        : await apiRequest("PATCH", vehicleDocumentTypePath(code), {
            label: values.label,
            validityMonths: values.validityMonths,
            alertDays: values.alertDays,
            active: values.active,
            sortOrder: values.sortOrder,
          });
      return vehicleDocumentTypeSchema.parse(await res.json());
    },
    onSuccess: (saved) => {
      // Couche 1 : la liste reflete la ligne tout de suite.
      queryClient.setQueryData<VehicleDocumentType[]>([VEHICLE_DOCUMENT_TYPES_PATH], (previous) => {
        const list = Array.isArray(previous) ? previous : [];
        return list.some((t) => t.code === saved.code)
          ? list.map((t) => (t.code === saved.code ? saved : t))
          : [...list, saved];
      });
      // Couche 3 : selecteurs et alertes des documents vehicule.
      queryClient.invalidateQueries({ queryKey: [VEHICLE_DOCUMENT_TYPES_PATH] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicle-documents"] });
      appToast({ title: "Type de document enregistré", variant: "success" });
      setOpen(false);
    },
    onError: (error) => {
      appToast({
        title: "Enregistrement impossible",
        description: userMessageOf(error, "Le type de document n'a pas pu être enregistré."),
        variant: "destructive",
      });
    },
  });
  const submit = useSingleFlightMutate(save.mutate);

  const columns: PremiumDataTableColumn<VehicleDocumentType>[] = [
    { id: "label", header: "Type", cell: (t) => <span className="font-medium text-foreground">{t.label}</span> },
    { id: "code", header: "Code", cell: (t) => <span className="text-xs text-muted-foreground">{t.code}</span> },
    {
      id: "validity",
      header: "Validité",
      cell: (t) => (t.validityMonths ? `${t.validityMonths} mois` : "Date saisie"),
    },
    { id: "alert", header: "Alerte", align: "right", cell: (t) => `${t.alertDays} j avant` },
    {
      id: "state",
      header: "État",
      cell: (t) => <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Actif" : "Désactivé"}</Badge>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (t) => (
        <Button size="sm" variant="outline" onClick={() => openDialog(t)}>
          <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
          Modifier
        </Button>
      ),
    },
  ];

  return (
    <PageLayout>
      <PageHeader
        title="Types de document véhicule"
        subtitle="Un type ne se supprime pas : il se désactive."
        actions={
          <Button onClick={() => openDialog(null)}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Nouveau type
          </Button>
        }
      />
      {query.isLoading || query.error ? (
        <LoadingError isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PremiumDataTable columns={columns} rows={query.data ?? []} rowKey={(t) => t.code} />
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Modifier le type" : "Nouveau type de document"}</DialogTitle>
            <DialogDescription>
              Sans durée de validité, l'alerte suit la date d'expiration saisie sur le document.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit((values) =>
                submit({ code: editing?.code ?? values.code, values, create: !isEdit }),
              )}
            >
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={isEdit} placeholder="permis_transport" />
                    </FormControl>
                    <FormDescription>Minuscules, chiffres et tirets bas. Non modifiable ensuite.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="label"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Libellé</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-3 gap-3">
                <FormField
                  control={form.control}
                  name="validityMonths"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Validité (mois)</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          value={field.value ?? ""}
                          onChange={(e) => field.onChange(toNumber(e.target.value, null))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="alertDays"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Alerte (jours)</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          value={field.value}
                          onChange={(e) => field.onChange(toNumber(e.target.value, 0))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sortOrder"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ordre</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          value={field.value}
                          onChange={(e) => field.onChange(toNumber(e.target.value, 0))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel>Actif dans les sélecteurs</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  Enregistrer
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
