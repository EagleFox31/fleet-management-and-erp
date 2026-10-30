import { useMutation } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useContractQuery } from "@/lib/contract-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import {
  NOTIFICATION_SETTINGS_PATH,
  notificationSettingsResponseSchema,
  type NotificationSetting,
  type NotificationTopic,
} from "@shared/contracts/notification-settings";

export const NOTIFICATION_TOPIC_LABELS: Record<NotificationTopic, string> = {
  maintenance: "Maintenance",
  inventory: "Stock",
  work_order: "Ordres de travail",
  fuel: "Carburant",
  mission: "Missions",
  procurement: "Achats",
  documents: "Documents de véhicule",
  incidents: "Pannes déclarées",
  backups: "Sauvegardes",
};

/**
 * Section « Notifications » du profil (T-33a). À insérer dans `pages/profile.tsx`.
 * Le canal e-mail n'est pas proposé : l'option est coupée du lot.
 */
export function NotificationPreferences() {
  const { toast } = useToast();
  const settings = useContractQuery(NOTIFICATION_SETTINGS_PATH, notificationSettingsResponseSchema);

  const mutation = useMutation({
    mutationFn: async (change: { topic: NotificationTopic; inApp: boolean }) =>
      notificationSettingsResponseSchema.parse(
        await (await apiRequest("PATCH", NOTIFICATION_SETTINGS_PATH, [change])).json(),
      ),
    // Mise à jour optimiste, retour arrière si erreur.
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: [NOTIFICATION_SETTINGS_PATH] });
      const previous = queryClient.getQueryData<NotificationSetting[]>([NOTIFICATION_SETTINGS_PATH]);
      queryClient.setQueryData<NotificationSetting[]>([NOTIFICATION_SETTINGS_PATH], (old = []) =>
        old.map((row) => (row.topic === change.topic ? { ...row, inApp: change.inApp } : row)),
      );
      return { previous };
    },
    onError: (error, _change, ctx) => {
      if (ctx?.previous) queryClient.setQueryData([NOTIFICATION_SETTINGS_PATH], ctx.previous);
      toast({ title: "Préférence non enregistrée", description: userMessageOf(error), variant: "destructive" });
    },
    onSuccess: (rows) => queryClient.setQueryData([NOTIFICATION_SETTINGS_PATH], rows),
    // Couche 3 : le compteur de la cloche dépend des préférences.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["/api/alerts"] }),
  });

  return (
    <section className="space-y-3" data-testid="notification-preferences">
      <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
      <ul className="divide-y rounded-xl border">
        {(settings.data ?? []).map((row) => (
          <li key={row.topic} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-foreground">{NOTIFICATION_TOPIC_LABELS[row.topic]}</span>
            <Switch
              checked={row.inApp}
              onCheckedChange={(inApp) => mutation.mutate({ topic: row.topic, inApp })}
              aria-label={`Notifications dans l'application : ${NOTIFICATION_TOPIC_LABELS[row.topic]}`}
              data-testid={`switch-notif-${row.topic}`}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
