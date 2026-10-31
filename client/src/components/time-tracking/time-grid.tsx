import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CalendarCheck, Clock, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeaderCard, StatusMetricStrip } from "@/components/design-system";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useToast } from "@/hooks/use-toast";
import { useContractQuery } from "@/lib/contract-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import {
  TIME_CODES,
  TIME_CODE_LABELS,
  TIME_TRACKING_MONTHLY_STATS_PATH,
  TIME_TRACKING_PATH,
  timeTrackingEntrySchema,
  timeTrackingMonthlyStatsResponseSchema,
  timeTrackingResponseSchema,
  type TimeCode,
  type TimeTrackingEntry,
} from "@shared/contracts/time-tracking";

const pad = (n: number) => String(n).padStart(2, "0");
export const cellKey = (userId: number, date: string) => `${userId}|${date}`;

export function daysOfMonth(year: number, month: number): string[] {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`);
}

/**
 * Grille mensuelle de pointage (T-54a), chauffeurs en lignes, jours en colonnes.
 * Les modifications restent locales jusqu'à « Enregistrer » ; seules les cellules
 * changées partent (une requête de contrat par cellule modifiée).
 * `readOnly` pour le chauffeur. Page à créer par fe-1 (menu Chauffeurs).
 */
export function TimeGrid({ year, month, readOnly = false }: { year: number; month: number; readOnly?: boolean }) {
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, TimeCode>>({});
  const params = { month, year };
  const stats = useContractQuery(TIME_TRACKING_MONTHLY_STATS_PATH, timeTrackingMonthlyStatsResponseSchema, params);
  const entries = useContractQuery(TIME_TRACKING_PATH, timeTrackingResponseSchema, params);

  const days = useMemo(() => daysOfMonth(year, month), [year, month]);
  const saved = useMemo(() => {
    const map = new Map<string, TimeCode>();
    for (const e of entries.data ?? []) map.set(cellKey(e.userId, e.date), e.status);
    return map;
  }, [entries.data]);

  const mutation = useMutation({
    mutationFn: async (changes: Array<{ userId: number; date: string; status: TimeCode }>) => {
      const results: TimeTrackingEntry[] = [];
      for (const change of changes) {
        results.push(timeTrackingEntrySchema.parse(await (await apiRequest("PUT", TIME_TRACKING_PATH, change)).json()));
      }
      return results;
    },
    onSuccess: () => {
      setEdits({});
      // Couche 3 : grille et totaux mensuels.
      void queryClient.invalidateQueries({ queryKey: [TIME_TRACKING_PATH] });
      void queryClient.invalidateQueries({ queryKey: [TIME_TRACKING_MONTHLY_STATS_PATH] });
      toast({ title: "Pointage enregistré" });
    },
    onError: (error) =>
      toast({ title: "Pointage non enregistré", description: userMessageOf(error), variant: "destructive" }),
  });
  const submit = useSingleFlightMutate(mutation.mutate);

  const save = () => {
    const changes = Object.entries(edits).map(([key, status]) => {
      const [userId, date] = key.split("|");
      return { userId: Number(userId), date, status };
    });
    if (changes.length > 0) submit(changes);
  };

  const totals = TIME_CODES.map((code) => ({
    code,
    total: (stats.data ?? []).reduce((sum, person) => sum + (person.counts[code] ?? 0), 0),
  }));

  return (
    <div className="space-y-4" data-testid="time-grid">
      <HeaderCard
        moduleLabel="Chauffeurs"
        title={`Pointage ${pad(month)}/${year}`}
        icon={<CalendarCheck className="h-5 w-5" />}
        actions={
          readOnly ? null : (
            <Button onClick={save} disabled={mutation.isPending || Object.keys(edits).length === 0} data-testid="button-save-time">
              <Save className="mr-2 h-4 w-4" />
              Enregistrer
            </Button>
          )
        }
      />
      <StatusMetricStrip
        items={totals.map((t) => ({ id: t.code, icon: <Clock className="h-4 w-4" />, label: `${t.code} · ${TIME_CODE_LABELS[t.code]}`, value: t.total }))}
      />
      <div className="overflow-x-auto rounded-xl border">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-muted/50">
              <th className="sticky left-0 bg-muted/50 px-3 py-2 text-left">Chauffeur</th>
              {days.map((d) => (
                <th key={d} className="px-1 py-2 text-center font-medium">
                  {d.slice(8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(stats.data ?? []).map((person) => (
              <tr key={person.userId} className="border-t">
                <td className="sticky left-0 bg-background px-3 py-1.5 font-medium">{person.userName}</td>
                {days.map((date) => {
                  const key = cellKey(person.userId, date);
                  const value = edits[key] ?? saved.get(key) ?? "";
                  return (
                    <td key={date} className="px-0.5 py-1 text-center">
                      {readOnly ? (
                        <span>{value || "—"}</span>
                      ) : (
                        <select
                          className={`h-7 w-11 rounded border bg-background text-center ${edits[key] ? "border-primary" : ""}`}
                          value={value}
                          aria-label={`${person.userName}, jour ${date.slice(8)}`}
                          onChange={(e) => {
                            const next = e.target.value as TimeCode | "";
                            setEdits((old) => {
                              const copy = { ...old };
                              if (next && next !== saved.get(key)) copy[key] = next;
                              else delete copy[key];
                              return copy;
                            });
                          }}
                          data-testid={`cell-${person.userId}-${date}`}
                        >
                          <option value="">—</option>
                          {TIME_CODES.map((code) => (
                            <option key={code} value={code} title={TIME_CODE_LABELS[code]}>
                              {code}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
