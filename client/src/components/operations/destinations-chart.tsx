import { CardShell } from "@/components/design-system";
import { formatPrice, formatNumber, cn } from "@/lib/utils";
import { MapPin } from "lucide-react";

interface DestinationStats {
  count: number;
  totalFuel: number;
  totalCost: number;
  totalRevenue: number;
}

interface DestinationsChartProps {
  data?: Record<string, DestinationStats>;
}

export function DestinationsChart({ data }: DestinationsChartProps) {
  if (!data || Object.keys(data).length === 0) {
    return (
      <CardShell className="px-6 py-10 text-center text-sm text-gray-400">
        Aucune donnée de destination disponible
      </CardShell>
    );
  }

  const destinations = Object.entries(data).map(([destination, stats]) => ({
    destination,
    ...stats,
  }));

  const totalMissions = destinations.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {destinations.map((dest) => {
        const pct = totalMissions > 0 ? (dest.count / totalMissions) * 100 : 0;
        const margin = dest.totalRevenue - dest.totalCost;

        return (
          <CardShell key={dest.destination} topBar>
            <div className="px-5 py-4">
              {/* Header : icône + nom + badge % */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <MapPin className="h-4 w-4 text-blue-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      Destination
                    </p>
                    <h3 className="text-sm font-bold text-gray-900 leading-tight truncate">
                      {dest.destination}
                    </h3>
                  </div>
                </div>
                <span className="ml-2 shrink-0 rounded-full bg-blue-50 border border-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-600">
                  {pct.toFixed(1)}%
                </span>
              </div>

              {/* Barre de progression */}
              <div className="mb-4 h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-400 to-blue-500 rounded-full transition-all"
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>

              {/* Lignes de stats */}
              <div className="space-y-2.5 border-t border-gray-100 pt-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Missions</span>
                  <span
                    className="text-xs font-semibold text-gray-800"
                    data-testid={`dest-${dest.destination}-missions`}
                  >
                    {formatNumber(dest.count)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Carburant</span>
                  <span
                    className="text-xs font-semibold text-orange-600"
                    data-testid={`dest-${dest.destination}-fuel`}
                  >
                    {formatNumber(dest.totalFuel)} L
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Coût</span>
                  <span className="text-xs font-semibold text-red-600">
                    {dest.totalCost > 0 ? formatPrice(dest.totalCost) : "N/A"}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Revenu</span>
                  <span
                    className="text-xs font-semibold text-green-600"
                    data-testid={`dest-${dest.destination}-revenue`}
                  >
                    {formatPrice(dest.totalRevenue)}
                  </span>
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">Marge</span>
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      dest.totalCost === 0
                        ? "text-gray-400"
                        : margin >= 0
                        ? "text-purple-600"
                        : "text-red-600"
                    )}
                  >
                    {dest.totalCost === 0 ? "N/A" : formatPrice(margin)}
                  </span>
                </div>
              </div>
            </div>
          </CardShell>
        );
      })}
    </div>
  );
}
