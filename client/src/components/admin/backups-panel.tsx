import { DatabaseBackup, Loader2, Play } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LoadingError } from "@/components/ui/loading-error";
import {
  AlertBannerCard,
  HeaderCard,
  KpiGrid,
  KpiTile,
  PremiumDataTable,
  type PremiumDataTableColumn,
} from "@/components/design-system";
import { useToast } from "@/hooks/use-toast";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useContractQuery } from "@/lib/contract-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import {
  RUNNING_REFRESH_MS,
  backupErrorLabel,
  backupRunOutcome,
  backupRunToast,
  formatBackupStart,
  hasRunningBackup,
} from "@/lib/backup-run";
import {
  BACKUP_ALERTS_PATH,
  BACKUPS_PATH,
  RUN_BACKUP_PATH,
  backupAlertsResponseSchema,
  backupRunSchema,
  backupRunsResponseSchema,
  type BackupRun,
} from "@shared/contracts/backups";

const STATUS_LABEL: Record<BackupRun["status"], string> = {
  running: "En cours",
  success: "Réussie",
  failed: "Échec",
};
const STATUS_CLASS: Record<BackupRun["status"], string> = {
  running: "bg-blue-100 text-blue-700",
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
};

export function formatBackupSize(bytes: number | null): string {
  if (bytes == null) return "—";
  return bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`;
}

export function formatBackupDuration(ms: number | null): string {
  if (ms == null) return "—";
  const seconds = Math.round(ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

type RunVariables = { requestedAt: number; knownRunIds: number[] };

/**
 * Page admin des sauvegardes (T-33a, T-33b), sur `/api/admin/backups*` (routes `backups.routes.ts`).
 * Temps réel : `backup_failed` invalide l'historique et les alertes (`REALTIME_EVENTS`) ; une
 * réussite n'émet rien, d'où le rafraîchissement tant qu'une exécution tourne.
 */
export function BackupsPanel() {
  const { toast } = useToast();
  const runs = useContractQuery(BACKUPS_PATH, backupRunsResponseSchema, undefined, {
    refetchInterval: (query) => (hasRunningBackup(query.state.data) ? RUNNING_REFRESH_MS : false),
  });
  const running = hasRunningBackup(runs.data);
  const alerts = useContractQuery(BACKUP_ALERTS_PATH, backupAlertsResponseSchema, undefined, {
    refetchInterval: running ? RUNNING_REFRESH_MS : false,
  });

  const runMutation = useMutation({
    mutationFn: async (_vars: RunVariables) =>
      backupRunSchema.parse(await (await apiRequest("POST", RUN_BACKUP_PATH)).json()),
    onSuccess: (run, { requestedAt, knownRunIds }) => {
      // 202 dans les deux cas (contrat figé) : nouvelle exécution ou exécution déjà en cours.
      const outcome = backupRunOutcome(run, knownRunIds, requestedAt);
      toast(backupRunToast(outcome, run));
      // Couche 1 : l'exécution apparaît tout de suite, sans doublon. Couche 3 : alertes et cloche.
      queryClient.setQueryData<BackupRun[]>([BACKUPS_PATH], (old = []) => [run, ...old.filter((r) => r.id !== run.id)]);
      void queryClient.invalidateQueries({ queryKey: [BACKUPS_PATH] });
      void queryClient.invalidateQueries({ queryKey: [BACKUP_ALERTS_PATH] });
      void queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
    },
    onError: (error) =>
      toast({ title: "Sauvegarde impossible", description: userMessageOf(error), variant: "destructive" }),
  });
  const submitRun = useSingleFlightMutate(runMutation.mutate);

  const rows = runs.data ?? [];
  const last = rows[0];

  const columns: PremiumDataTableColumn<BackupRun>[] = [
    { id: "startedAt", header: "Début", cell: (r) => formatBackupStart(r.startedAt) },
    {
      id: "status",
      header: "Statut",
      cell: (r) => (
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_CLASS[r.status]}`}>
          {STATUS_LABEL[r.status]}
        </span>
      ),
    },
    { id: "size", header: "Taille", align: "right", cell: (r) => formatBackupSize(r.sizeBytes) },
    { id: "duration", header: "Durée", align: "right", cell: (r) => formatBackupDuration(r.durationMs) },
    {
      id: "detail",
      header: "Détail",
      cell: (r) => <span className="text-muted-foreground">{backupErrorLabel(r.errorCode) ?? ""}</span>,
    },
  ];

  return (
    <div className="space-y-4" data-testid="backups-panel">
      <HeaderCard
        moduleLabel="Administration"
        title="Sauvegardes"
        subtitle="Sauvegarde automatique de la base de données"
        icon={<DatabaseBackup className="h-5 w-5" />}
        actions={
          <Button
            onClick={() => submitRun({ requestedAt: Date.now(), knownRunIds: rows.map((r) => r.id) })}
            disabled={runMutation.isPending}
            data-testid="button-run-backup"
          >
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {running ? "Sauvegarde en cours" : "Lancer maintenant"}
          </Button>
        }
      />
      {(alerts.data ?? []).map((alert) => (
        <AlertBannerCard
          key={alert.kind}
          icon={<DatabaseBackup className="h-4 w-4" />}
          title={alert.message}
          variant="danger"
        />
      ))}
      {runs.isLoading || runs.error ? (
        <LoadingError isLoading={runs.isLoading} error={runs.error} onRetry={() => runs.refetch()} />
      ) : (
        <>
          <KpiGrid columns={3}>
            <KpiTile
              label="Dernière sauvegarde"
              value={last ? formatBackupStart(last.startedAt) : "—"}
              subValue={last ? STATUS_LABEL[last.status] : "Aucune"}
            />
            <KpiTile label="Taille" value={formatBackupSize(last?.sizeBytes ?? null)} />
            <KpiTile label="Durée" value={formatBackupDuration(last?.durationMs ?? null)} />
          </KpiGrid>
          <PremiumDataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucune sauvegarde enregistrée.</p>}
          />
        </>
      )}
    </div>
  );
}
