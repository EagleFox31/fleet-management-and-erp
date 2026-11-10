import { History } from "lucide-react";
import { Link } from "wouter";
import { HeaderCard } from "@/components/design-system";
import { Card, CardContent } from "@/components/ui/card";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { useContractQuery } from "@/lib/contract-query";
import { listQueryView } from "@/lib/query-view";
import { toWorkOrderHistoryEntry } from "@/lib/work-order-history";
import { workOrderAuditTrailPath, workOrderAuditTrailResponseSchema } from "@shared/contracts/work-order-audit-trail";
import type { AuditLogRow } from "@shared/contracts/audit-logs";

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
}

/** Chronologie d'un ordre de travail (P-13) : du plus ancien au plus récent, lue dans le journal d'audit. */
export function WorkOrderHistory({ workOrderId }: { workOrderId: number }) {
  const query = useContractQuery(workOrderAuditTrailPath(workOrderId), workOrderAuditTrailResponseSchema, undefined, { retry: false });
  const view = listQueryView<AuditLogRow>(query);

  return (
    <div className="space-y-4" data-testid="work-order-history">
      <HeaderCard moduleLabel="Maintenance" title={`Historique de l'ordre de travail n° ${workOrderId}`} icon={<History className="h-5 w-5" />} />
      <Link href={`/maintenance/work-orders/${workOrderId}`} className="text-sm text-primary-text underline" data-testid="work-order-history-back">
        Retour à l'ordre de travail
      </Link>
      {view.kind === "error" ? (
        <InlineQueryError
          error={view.error}
          fallback="L'historique n'a pas pu être chargé."
          onRetry={() => query.refetch()}
          isRetrying={view.isRetrying}
          data-testid="work-order-history-error"
        />
      ) : view.kind === "loading" ? (
        <p className="text-sm text-muted-foreground">Chargement de l'historique…</p>
      ) : view.data.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground" data-testid="work-order-history-empty">
          Aucun changement enregistré pour cet ordre de travail.
        </p>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ol className="divide-y">
              {view.data.map((row) => {
                const entry = toWorkOrderHistoryEntry(row);
                return (
                  <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3" data-testid={`work-order-history-entry-${entry.id}`}>
                    <span className="text-sm tabular-nums text-muted-foreground">{formatDateTime(entry.at)}</span>
                    <span className="text-sm font-medium">{entry.action}</span>
                    {entry.statusChange && <span className="text-sm">{entry.statusChange}</span>}
                    <span className="text-sm text-muted-foreground">par {entry.who}</span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
