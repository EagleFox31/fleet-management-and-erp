import { useState } from "react";
import { useLocation } from "wouter";
import { Wallet } from "lucide-react";
import { HeaderCard, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { LoadingError } from "@/components/ui/loading-error";
import { useContractQuery } from "@/lib/contract-query";
import { formatXaf, MISSION_BUDGET_STATUS_CLASSES, toDisburseOf } from "@/lib/mission-budget-ui";
import { isoDateInZone } from "@shared/contracts/kpi-period";
import {
  dailyNeedResponseSchema,
  MISSION_BUDGET_STATUS_LABELS,
  MISSION_BUDGET_STATUSES,
  MISSION_BUDGETS_DAILY_NEED_PATH,
  MISSION_BUDGETS_PATH,
  missionBudgetsResponseSchema,
  type MissionBudgetListItem,
} from "@shared/contracts/mission-budgets";

/**
 * Besoin du jour (L1f-2) : les budgets de mission d'une date, sommés au total et par statut,
 * puis le détail par mission. Lecture seule : chaque étape se fait sur la fiche mission (onglet
 * Budget), où la ligne mène. Le temps réel passe par la table des satellites
 * (`mission_budget_updated` invalide la liste et le besoin du jour).
 */
export function MissionBudgetsDailyNeed() {
  const [date, setDate] = useState(() => isoDateInZone(new Date()));
  const [, setLocation] = useLocation();
  const need = useContractQuery(MISSION_BUDGETS_DAILY_NEED_PATH, dailyNeedResponseSchema, { date }, { enabled: !!date });
  const budgets = useContractQuery(MISSION_BUDGETS_PATH, missionBudgetsResponseSchema, { date }, { enabled: !!date });

  const columns: PremiumDataTableColumn<MissionBudgetListItem>[] = [
    { id: "mission", header: "Mission", cell: (b) => <span className="font-medium">{b.missionOrderNumber ?? `#${b.missionId}`}</span> },
    {
      id: "status",
      header: "Statut",
      cell: (b) => <Badge className={MISSION_BUDGET_STATUS_CLASSES[b.status]}>{MISSION_BUDGET_STATUS_LABELS[b.status]}</Badge>,
    },
    { id: "fuel", header: "Carburant", align: "right", cell: (b) => formatXaf(b.fuelAmount) },
    { id: "fdr", header: "FDR", align: "right", cell: (b) => formatXaf(b.fdrAmount) },
    { id: "extras", header: "Frais annexes", align: "right", cell: (b) => formatXaf(b.extrasAmount) },
    { id: "total", header: "Total", align: "right", cell: (b) => <span className="font-semibold">{formatXaf(b.totalAmount)}</span> },
  ];

  const loading = need.isLoading || budgets.isLoading;
  const error = need.error ?? budgets.error;

  return (
    <div className="space-y-4" data-testid="mission-budgets-daily-need">
      <HeaderCard moduleLabel="Finance" title="Besoin du jour" icon={<Wallet className="h-5 w-5" />} />

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="daily-need-date" className="text-sm text-muted-foreground">
          Date des budgets
        </label>
        <Input
          id="daily-need-date"
          type="date"
          className="w-44"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          data-testid="input-daily-need-date"
        />
      </div>

      {loading || error ? (
        <LoadingError
          isLoading={loading}
          error={error}
          onRetry={() => {
            need.refetch();
            budgets.refetch();
          }}
        />
      ) : (
        <>
          {need.data && (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="daily-need-totals">
                {[
                  ["Budgets", String(need.data.count), "count"],
                  ["Carburant", formatXaf(need.data.fuelAmount), "fuel"],
                  ["FDR", formatXaf(need.data.fdrAmount), "fdr"],
                  ["Frais annexes", formatXaf(need.data.extrasAmount), "extras"],
                  ["Total", formatXaf(need.data.totalAmount), "total"],
                  ["Reste à décaisser", formatXaf(toDisburseOf(need.data)), "to-disburse"],
                ].map(([label, value, key]) => (
                  <div key={key} className="rounded-lg border bg-card p-3" data-testid={`daily-need-${key}`}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="text-lg font-semibold text-foreground">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2" data-testid="daily-need-by-status">
                {MISSION_BUDGET_STATUSES.map((status) => {
                  const totals = need.data.byStatus[status];
                  return (
                    <div key={status} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm" data-testid={`daily-need-status-${status}`}>
                      <Badge className={MISSION_BUDGET_STATUS_CLASSES[status]}>{MISSION_BUDGET_STATUS_LABELS[status]}</Badge>
                      <span className="text-muted-foreground">{totals?.count ?? 0}</span>
                      <span className="font-medium text-foreground">{formatXaf(totals?.totalAmount ?? 0)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          <PremiumDataTable
            columns={columns}
            rows={budgets.data ?? []}
            rowKey={(b) => b.id}
            onRowClick={(b) => setLocation(`/missions/${b.missionId}`)}
            emptyState={<p className="p-6 text-center text-sm text-muted-foreground">Aucun budget de mission à cette date.</p>}
          />
        </>
      )}
    </div>
  );
}
