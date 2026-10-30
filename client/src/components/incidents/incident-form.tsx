import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { useAuth } from "@/hooks/useAuth";
import { useFormDraft } from "@/hooks/use-form-draft";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import {
  INCIDENT_DEFAULT_VALUES,
  incidentDraftStorage,
  isIncidentFormEmpty,
  type IncidentFormValues,
} from "@/lib/incident-draft";
import {
  INCIDENTS_PATH,
  createIncidentRequestSchema,
  incidentSchema,
  type Incident,
} from "@shared/contracts/incidents";
import { INCIDENT_SEVERITY_LABELS } from "@/components/incidents/incident-labels";

const formSchema = createIncidentRequestSchema.pick({ description: true, severity: true });

/**
 * Déclaration de panne (T-52). Véhicule imposé par l'appelant (PWA chauffeur).
 * Page à créer par fe-1 : `pages/driver/` (non pré-déclarée sur cette branche).
 */
export function IncidentForm({ vehicleId, onDone }: { vehicleId: number; onDone?: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const form = useForm<IncidentFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: INCIDENT_DEFAULT_VALUES,
  });
  const { draftSavedAt, clearDraft, discardDraft } = useFormDraft({
    form,
    storage: incidentDraftStorage,
    userId: user?.id,
    isEmpty: isIncidentFormEmpty,
  });

  const mutation = useMutation({
    mutationFn: async (values: IncidentFormValues) =>
      incidentSchema.parse(await (await apiRequest("POST", INCIDENTS_PATH, { vehicleId, ...values })).json()),
    onSuccess: (incident) => {
      // Couche 1, puis couche 3 : liste, alertes et tuiles KPI.
      queryClient.setQueryData<Incident[]>([INCIDENTS_PATH], (old) => (old ? [incident, ...old] : old));
      void queryClient.invalidateQueries({ queryKey: [INCIDENTS_PATH] });
      void queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/kpi/incidents-per-month"] });
      clearDraft();
      form.reset(INCIDENT_DEFAULT_VALUES);
      toast({ title: "Panne déclarée", description: "Le chef d'atelier est prévenu." });
      onDone?.();
    },
    onError: (error) =>
      toast({ title: "Déclaration impossible", description: userMessageOf(error), variant: "destructive" }),
  });
  const submit = useSingleFlightMutate(mutation.mutate);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => submit(values))} className="space-y-4" data-testid="incident-form">
        <FormField
          control={form.control}
          name="severity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Gravité</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger data-testid="select-incident-severity">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.entries(INCIDENT_SEVERITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
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
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Que se passe-t-il ?</FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder="Décrivez la panne en quelques mots" data-testid="input-incident-description" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex items-center gap-2">
          <FormDraftBadge savedAt={draftSavedAt} />
          <FormDraftDiscardButton savedAt={draftSavedAt} onDiscard={() => discardDraft(INCIDENT_DEFAULT_VALUES)} />
          <Button type="submit" className="ml-auto" disabled={mutation.isPending} data-testid="button-submit-incident">
            <Send className="mr-2 h-4 w-4" />
            Déclarer la panne
          </Button>
        </div>
      </form>
    </Form>
  );
}
