import { CardShell } from "@/components/design-system";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { queryView } from "@/lib/query-view";
import { parseStatNumber } from "@/lib/tire-statistics-view";
import { formatPrice, formatNumber } from "@/lib/utils";
import { MapPin } from "lucide-react";

const ERROR_FALLBACK = "Statistiques par destination indisponibles.";

interface DestinationsChartProps {
  /** Réponse brute de `GET /api/operations/stats/by-destination` : une liste de lignes. */
  data?: unknown;
  error?: unknown;
  isFetching?: boolean;
  onRetry?: () => void;
}

interface DestinationRow {
  destination: string;
  count: number | null;
  totalFuel: number | null;
  totalFuelCost: number | null;
  /** null : masqué hors lecteurs du budget (Q19), la ligne n'est pas affichée. */
  estimatedFuelCost: number | null;
}

function toRow(raw: unknown): DestinationRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    destination: typeof r.destination === "string" && r.destination ? r.destination : "AUTRE",
    count: parseStatNumber(r.count),
    totalFuel: parseStatNumber(r.totalFuel),
    totalFuelCost: parseStatNumber(r.totalFuelCost),
    estimatedFuelCost: parseStatNumber(r.estimatedFuelCost),
  };
}

const show = (value: number | null, format: (n: number) => string) => (value == null ? UNAVAILABLE : format(value));

/**
 * Onglet Destinations. Aucune marge : le serveur ne sert aucun coût complet ni chiffre d'affaires,
 * l'ancienne marge (`totalRevenue - totalCost`, champ jamais servi) affichait NaN.
 */
export function DestinationsChart({ data, error, isFetching = false, onRetry }: DestinationsChartProps) {
  const view = queryView({ data, error, isFetching });

  if (view.kind === "loading") {
    return (
      <CardShell className="px-6 py-10 text-center text-sm text-muted-foreground" data-testid="destinations-loading">
        Chargement des destinations…
      </CardShell>
    );
  }

  // Une réponse qui n'est pas une liste est une erreur, jamais « aucune donnée ».
  if (view.kind === "error" || !Array.isArray(view.data)) {
    return (
      <InlineQueryError
        error={view.kind === "error" ? view.error : null}
        fallback={ERROR_FALLBACK}
        onRetry={onRetry}
        isRetrying={view.kind === "error" && view.isRetrying}
        data-testid="destinations-error"
      />
    );
  }

  if (view.data.length === 0) {
    return (
      <CardShell className="px-6 py-10 text-center text-sm text-muted-foreground" data-testid="destinations-empty">
        Aucune mission en cours ou livrée
      </CardShell>
    );
  }

  const destinations = view.data.map(toRow);
  // Part des missions : jamais calculée sur une somme partielle.
  const totalMissions = destinations.some((d) => d.count == null)
    ? null
    : destinations.reduce((sum, d) => sum + (d.count ?? 0), 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {destinations.map((dest) => {
        const pct = totalMissions && dest.count != null ? (dest.count / totalMissions) * 100 : null;

        return (
          <CardShell key={dest.destination} topBar>
            <div className="px-5 py-4">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4 text-primary-text" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Destination
                    </p>
                    <h3 className="text-sm font-bold text-foreground leading-tight truncate">
                      {dest.destination}
                    </h3>
                  </div>
                </div>
                {pct != null && (
                  <span className="ml-2 shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary-text">
                    {pct.toFixed(1)}%
                  </span>
                )}
              </div>

              {pct != null && (
                <div className="mb-4 h-1 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
              )}

              <div className="space-y-2.5 border-t border-border pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Missions</span>
                  <span className="text-xs font-semibold text-foreground" data-testid={`dest-${dest.destination}-missions`}>
                    {show(dest.count, formatNumber)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Carburant consommé</span>
                  <span className="text-xs font-semibold text-foreground" data-testid={`dest-${dest.destination}-fuel`}>
                    {show(dest.totalFuel, (n) => `${formatNumber(n)} L`)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs text-muted-foreground">Carburant réel</span>
                  <span className="text-xs font-semibold text-foreground" data-testid={`dest-${dest.destination}-fuel-cost`}>
                    {show(dest.totalFuelCost, formatPrice)}
                  </span>
                </div>

                {dest.estimatedFuelCost != null && (
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Carburant estimé</span>
                    <span className="text-xs font-semibold text-foreground" data-testid={`dest-${dest.destination}-fuel-estimated`}>
                      {formatPrice(dest.estimatedFuelCost)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardShell>
        );
      })}
    </div>
  );
}
