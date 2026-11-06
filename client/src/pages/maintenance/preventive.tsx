import { userMessageOf } from "@/lib/api-error";
import { daysBetweenDateOnly, toExpiryDateOnly, todayUtcDateOnly } from "@shared/constants/expiry-day";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Calendar,
  Plus,
  Settings,
  ShieldCheck,
  Timer,
  Wrench,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { RoleExplanationCard } from "@/components/RoleExplanationCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CardShell,
  HeaderCard,
  KpiGrid,
  KpiTile,
  PremiumDataTable,
  SectionLabel,
  StatusBadge,
  type PremiumDataTableColumn,
} from "@/components/design-system";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { preventiveDraft } from "@/lib/form-drafts";

const scheduleSchema = z.object({
  vehicleId: z.number({ required_error: "Le véhicule est requis" }),
  title: z.string().min(1, "Le titre est requis"),
  description: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "mileage"]),
  frequencyValue: z.number().min(1, "La fréquence doit être positive"),
  scheduledDate: z.string().min(1, "La date est requise"),
  scheduledMileage: z.number().optional(),
  isActive: z.boolean().default(true),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;

interface MaintenanceSchedule {
  id: number;
  vehicleId: number;
  vehicleRegistrationNumber?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  title: string;
  description?: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "mileage";
  frequencyValue: number;
  scheduledDate: string;
  scheduledMileage?: number;
  isActive: boolean;
}

const getFrequencyLabel = (frequency: MaintenanceSchedule["frequency"], value: number) => {
  const labels: Record<MaintenanceSchedule["frequency"], string> = {
    daily: `Tous les ${value} jour(s)`,
    weekly: `Toutes les ${value} semaine(s)`,
    monthly: `Tous les ${value} mois`,
    quarterly: `Tous les ${value} trimestre(s)`,
    yearly: `Tous les ${value} an(s)`,
    mileage: `Tous les ${value} km`,
  };

  return labels[frequency];
};

const toDateSafe = (rawDate: string) => {
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getStatusMeta = (schedule: MaintenanceSchedule) => {
  if (!schedule.isActive) {
    return { status: "draft", label: "Inactif" };
  }

  // Jour d'échéance UTC (#342) : plus de division de millisecondes dépendante du fuseau.
  const scheduledDay = toExpiryDateOnly(schedule.scheduledDate);
  if (scheduledDay === null) {
    return { status: "pending", label: "À vérifier" };
  }

  const diffDays = daysBetweenDateOnly(scheduledDay, todayUtcDateOnly());

  if (diffDays < 0) {
    return { status: "cancelled", label: "En retard" };
  }

  if (diffDays <= 7) {
    return { status: "partial", label: "Bientôt due" };
  }

  return { status: "approved", label: "Actif" };
};

export default function PreventiveMaintenancePage() {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      isActive: true,
      frequencyValue: 1,
    },
  });

  // Brouillon: la saisie ne doit pas se perdre sur un rafraichissement.
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form: form as any,
    storage: preventiveDraft.storage as any,
    isEmpty: preventiveDraft.isEmpty as any,
  });

  const { data: vehicles = [] } = useQuery<any[]>({
    queryKey: ["/api/vehicles"],
    enabled: isDialogOpen,
  });

  const { data: schedulesData = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/maintenance-schedules"],
  });

  const schedules: MaintenanceSchedule[] = useMemo(
    () => (Array.isArray(schedulesData) ? schedulesData : []),
    [schedulesData],
  );

  const createScheduleMutation = useMutation({
    mutationFn: (data: ScheduleFormData) =>
      apiRequest("/api/maintenance-schedules", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      clearDraft(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-schedules"] });
      setIsDialogOpen(false);
      form.reset({
        isActive: true,
        frequencyValue: 1,
      });
      toast({
        title: "Planification créée",
        description: "La planification préventive a été créée avec succès.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible de créer la planification."),
        variant: "destructive",
      });
    },
  });

  const toggleScheduleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest(`/api/maintenance-schedules/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance-schedules"] });
      toast({
        title: "Planification mise à jour",
        description: "Le statut de la planification a été modifié.",
      });
    },
  });

  const onSubmit = (data: ScheduleFormData) => {
    createScheduleMutation.mutate(data);
  };

  const stats = useMemo(() => {
    const active = schedules.filter((schedule) => schedule.isActive);
    const statusBuckets = schedules.reduce(
      (acc, schedule) => {
        const status = getStatusMeta(schedule).label;
        if (status === "En retard") acc.overdue += 1;
        if (status === "Bientôt due") acc.upcoming += 1;
        return acc;
      },
      { overdue: 0, upcoming: 0 },
    );

    return {
      total: schedules.length,
      active: active.length,
      inactive: schedules.length - active.length,
      overdue: statusBuckets.overdue,
      upcoming: statusBuckets.upcoming,
    };
  }, [schedules]);

  const columns: PremiumDataTableColumn<MaintenanceSchedule>[] = [
    {
      id: "title",
      header: "Planification",
      widthClassName: "w-[300px]",
      cell: (schedule) => (
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate">{schedule.title}</p>
          <p className="text-xs text-gray-400 truncate">
            {schedule.vehicleRegistrationNumber || "Véhicule"}
            {(schedule.vehicleBrand || schedule.vehicleModel)
              ? ` · ${schedule.vehicleBrand || ""} ${schedule.vehicleModel || ""}`
              : ""}
          </p>
        </div>
      ),
    },
    {
      id: "frequency",
      header: "Fréquence",
      widthClassName: "w-[180px]",
      cell: (schedule) => (
        <span className="text-sm text-gray-600">
          {getFrequencyLabel(schedule.frequency, schedule.frequencyValue)}
        </span>
      ),
    },
    {
      id: "nextDate",
      header: "Prochaine date",
      widthClassName: "w-[150px]",
      cell: (schedule) => {
        const date = toDateSafe(schedule.scheduledDate);
        return (
          <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <Calendar className="h-3.5 w-3.5 text-gray-400" />
            {date ? date.toLocaleDateString("fr-FR") : "-"}
          </span>
        );
      },
    },
    {
      id: "status",
      header: "Statut",
      widthClassName: "w-[150px]",
      cell: (schedule) => {
        const status = getStatusMeta(schedule);
        return <StatusBadge status={status.status} label={status.label} />;
      },
    },
    {
      id: "enabled",
      header: "Actif",
      align: "center",
      widthClassName: "w-[110px]",
      cell: (schedule) => (
        <div className="flex justify-center">
          <Switch
            checked={schedule.isActive}
            onCheckedChange={(checked) =>
              toggleScheduleMutation.mutate({ id: schedule.id, isActive: checked })
            }
            disabled={toggleScheduleMutation.isPending}
          />
        </div>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-5">
        <CardShell topBar>
          <div className="px-6 py-5 space-y-4">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-8 w-80" />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3 border-t border-gray-100 pt-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={`preventive-kpi-${index}`} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
        </CardShell>
        <CardShell>
          <div className="p-5 space-y-3">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </CardShell>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Maintenance · Préventif"
        title="Planifications préventives"
        subtitle="Gestion des échéances et cycles d'entretien"
        icon={<ShieldCheck className="h-5 w-5" />}
        actions={
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 text-xs gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Nouvelle planification
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Créer une planification préventive</DialogTitle>
              </DialogHeader>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {draftSavedAt && (
            <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
              <FormDraftBadge savedAt={draftSavedAt} />
              <FormDraftDiscardButton
                savedAt={draftSavedAt}
                onDiscard={() => discardDraft(form.getValues())}
              />
            </div>
          )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="vehicleId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Véhicule</FormLabel>
                          <Select onValueChange={(value) => field.onChange(parseInt(value, 10))}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Sélectionner un véhicule" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {vehicles.map((vehicle: any) => (
                                <SelectItem key={vehicle.id} value={String(vehicle.id)}>
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
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Titre</FormLabel>
                          <FormControl>
                            <Input placeholder="Ex: Vidange moteur" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Détails de la maintenance..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="frequency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Fréquence</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="daily">Journalier</SelectItem>
                              <SelectItem value="weekly">Hebdomadaire</SelectItem>
                              <SelectItem value="monthly">Mensuel</SelectItem>
                              <SelectItem value="quarterly">Trimestriel</SelectItem>
                              <SelectItem value="yearly">Annuel</SelectItem>
                              <SelectItem value="mileage">Kilométrage</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="frequencyValue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Valeur</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min="1"
                              placeholder="1"
                              {...field}
                              onChange={(event) => field.onChange(parseInt(event.target.value || "0", 10))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="scheduledDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date prévue</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {form.watch("frequency") === "mileage" ? (
                    <FormField
                      control={form.control}
                      name="scheduledMileage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kilométrage prévu</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              placeholder="Ex: 100000"
                              {...field}
                              onChange={(event) =>
                                field.onChange(parseInt(event.target.value || "0", 10) || undefined)
                              }
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Annuler
                    </Button>
                    <Button type="submit" disabled={createScheduleMutation.isPending}>
                      {createScheduleMutation.isPending ? "Création..." : "Créer"}
                    </Button>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        }
      >
        <KpiGrid columns={6}>
          <KpiTile
            label="Total"
            value={stats.total}
            subValue="Planifications"
            icon={<Settings className="h-4 w-4" />}
            iconWrapperClassName="bg-gray-100 text-gray-600"
          />
          <KpiTile
            label="Actives"
            value={stats.active}
            subValue="En suivi"
            icon={<ShieldCheck className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
            valueClassName={stats.active > 0 ? "text-green-700" : undefined}
          />
          <KpiTile
            label="Bientôt dues"
            value={stats.upcoming}
            subValue="Sous 7 jours"
            icon={<Timer className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
            valueClassName={stats.upcoming > 0 ? "text-orange-700" : undefined}
          />
          <KpiTile
            label="En retard"
            value={stats.overdue}
            subValue="Action atelier"
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-red-50 text-red-600"
            valueClassName={stats.overdue > 0 ? "text-red-700" : undefined}
          />
          <KpiTile
            label="Inactives"
            value={stats.inactive}
            subValue="Suspendues"
            icon={<Settings className="h-4 w-4" />}
            iconWrapperClassName="bg-gray-100 text-gray-500"
          />
          <KpiTile
            label="Couverture"
            value={stats.total > 0 ? `${Math.round((stats.active / stats.total) * 100)}%` : "0%"}
            subValue="Planifications actives"
            icon={<ShieldCheck className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
        </KpiGrid>
      </HeaderCard>

      <RoleExplanationCard pageType="preventive" />

      <CardShell>
        <div className="px-5 py-4">
          <SectionLabel className="mb-3 inline-block">Liste des planifications</SectionLabel>
          <PremiumDataTable
            columns={columns}
            rows={schedules}
            rowKey={(schedule) => schedule.id}
            rowClassName={(_, index) => (index % 2 === 0 ? "bg-white" : "bg-gray-50/35")}
            emptyState="Aucune planification préventive."
            tableContainerClassName="border border-gray-100 rounded-xl overflow-hidden"
          />
        </div>
      </CardShell>
    </div>
  );
}
