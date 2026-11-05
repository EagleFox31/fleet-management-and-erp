import { useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Award,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  Fuel,
  MapPin,
  Package,
  Route,
  TrendingDown,
  TrendingUp,
  Truck,
  Zap,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { CardShell, SectionLabel } from "@/components/design-system";
import { formatPrice } from "@/lib/utils";
import type {
  ManagementDashboardResponse,
  ManagementMissionProfitability,
} from "@shared/constants/management-dashboard";

type ManagementProfitabilityBentoProps = {
  data: ManagementDashboardResponse;
};

function GlassmorphicTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div className="bg-slate-950/90 backdrop-blur-md border border-slate-700 text-white p-3 rounded-xl shadow-2xl space-y-1 min-w-[170px]">
        <div className="font-semibold text-xs text-emerald-400 border-b border-slate-800 pb-1 truncate">
          {d.name || d.label}
        </div>
        {payload.map((p: any, idx: number) => (
          <div key={idx} className="flex justify-between items-center text-xs gap-3 pt-0.5">
            <span className="text-slate-400 text-[11px]">{p.name} :</span>
            <span className="font-bold text-white tabular-nums">
              {typeof p.value === "number" && p.value > 1000
                ? formatPrice(p.value)
                : `${p.value}`}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

export function ManagementProfitabilityBento({ data }: ManagementProfitabilityBentoProps) {
  const { missionProfitability, topClients, topDestinations, topCargoTypes } = data;
  const { summary, topProfitable, worstDeficit } = missionProfitability;

  const profitabilityRate =
    summary.analyzedCount > 0 ? (summary.profitableCount / summary.analyzedCount) * 100 : 0;

  // Données du BarChart Top Marges Missions
  const missionsChartData = useMemo(() => {
    return topProfitable.slice(0, 5).map((m) => ({
      name: `${m.orderNumber}`,
      client: m.clientName,
      marge: m.marginHT,
      ca: m.revenueHT,
      couts: m.totalCostsHT,
      destination: m.destination,
    }));
  }, [topProfitable]);

  // Max pour barres relatives
  const maxClientAmount = Math.max(...topClients.map((c) => c.invoicedTTC), 1);
  const maxDestCount = Math.max(...topDestinations.map((d) => d.missionCount), 1);
  const maxCargoCount = Math.max(...topCargoTypes.map((c) => c.missionCount), 1);

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. BENTO 1 : Ratios Exécutifs de Rentabilité par Mission                   */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Missions Analysées */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border border-blue-500/20 dark:border-blue-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 text-blue-600" /> Missions Clôturées
            </span>
            <span className="p-1.5 rounded-lg bg-blue-500/20 text-blue-700 dark:text-blue-300">
              <Route className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-blue-700 dark:text-blue-400 tabular-nums">
              {summary.analyzedCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Taux de succès financier : <strong className="text-foreground">{profitabilityRate.toFixed(0)}%</strong>
            </p>
          </div>
        </div>

        {/* Missions Rentables */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 dark:border-emerald-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Missions Rentables
            </span>
            <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {summary.profitableCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Marge HT nette positive sur le voyage
            </p>
          </div>
        </div>

        {/* Missions Déficitaires */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-rose-500/10 via-rose-500/5 to-transparent border border-rose-500/20 dark:border-rose-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-rose-800 dark:text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> Voyages Déficitaires
            </span>
            <span className="p-1.5 rounded-lg bg-rose-500/20 text-rose-700 dark:text-rose-300">
              <TrendingDown className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-rose-700 dark:text-rose-400 tabular-nums">
              {summary.deficitCount}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Coûts réels &gt; Facturation client (retours à vide)
            </p>
          </div>
        </div>

        {/* Marge Cumulée Missions */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border border-primary/25 dark:border-primary/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-primary-text flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-primary-text" /> Marge Nette Missions
            </span>
            <span className="p-1.5 rounded-lg bg-primary/20 text-primary-text">
              <Zap className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-primary-text tabular-nums tracking-tight">
              {formatPrice(summary.totalMarginHT)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Cumul net hors frais généraux non rattachés
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. BENTO 2 : Face-à-Face Missions Rentables vs Missions Déficitaires      */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Top 5 Missions Rentables (7/12) */}
        <CardShell className="lg:col-span-7 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Top Missions Rentables</h4>
                  <p className="text-xs text-muted-foreground">Plus fortes marges nettes HT dégagées</p>
                </div>
              </div>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                {topProfitable.length} au vert
              </span>
            </div>

            {topProfitable.length > 0 ? (
              <div className="space-y-2.5">
                {topProfitable.slice(0, 4).map((m, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800 hover:border-emerald-500/40 transition-colors flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-extrabold text-[10px] flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-bold text-foreground truncate">
                          {m.orderNumber} · {m.clientName}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 text-emerald-600 shrink-0" />
                        <span className="truncate">{m.destination}</span>
                        <span>· CA {formatPrice(m.revenueHT)}</span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400 block tabular-nums">
                        +{formatPrice(m.marginHT)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Coûts : {formatPrice(m.totalCostsHT)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-6 text-center">Aucune mission rentable sur la période.</p>
            )}
          </div>
        </CardShell>

        {/* Missions Déficitaires / À Auditer (5/12) */}
        <CardShell className="lg:col-span-5 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/20">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Voyages Déficitaires</h4>
                  <p className="text-xs text-muted-foreground">À investiguer (surcoûts carburant/FDR)</p>
                </div>
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                worstDeficit.length > 0
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              }`}>
                {worstDeficit.length} alerte(s)
              </span>
            </div>

            {worstDeficit.length > 0 ? (
              <div className="space-y-2.5">
                {worstDeficit.slice(0, 3).map((m, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-rose-950 dark:text-rose-200 truncate">
                        {m.orderNumber} · {m.clientName}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {m.destination} · CA {formatPrice(m.revenueHT)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-extrabold text-rose-600 dark:text-rose-400 block tabular-nums">
                        -{formatPrice(Math.abs(m.marginHT))}
                      </span>
                      <span className="text-[10px] text-rose-700 dark:text-rose-400 font-semibold uppercase">
                        Perte brute
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 text-center space-y-1">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
                <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Aucun déficit constaté</p>
                <p className="text-[11px] text-muted-foreground">Toutes les missions clôturées ont dégagé une marge positive.</p>
              </div>
            )}
          </div>
        </CardShell>
      </div>

      {/* ========================================================================= */}
      {/* 3. BENTO 3 : Triplet Stratégique (Clients / Corridors / Marchandises)      */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Top Clients */}
        <CardShell className="border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-primary-text" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Top Clients (CA)</h4>
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground">Portefeuille</span>
            </div>

            <div className="space-y-2.5">
              {topClients.slice(0, 4).map((c, idx) => {
                const widthPercent = Math.max((c.invoicedTTC / maxClientAmount) * 100, 10);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground truncate max-w-[140px]">
                        {idx + 1}. {c.clientName}
                      </span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                        {formatPrice(c.invoicedTTC)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-500"
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground flex justify-between">
                      <span>{c.invoiceCount} factures</span>
                      <span>Encaissé {formatPrice(c.collectedTTC)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardShell>

        {/* Top Destinations / Corridors */}
        <CardShell className="border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-blue-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Lignes &amp; Corridors</h4>
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground">Volume</span>
            </div>

            <div className="space-y-2.5">
              {topDestinations.slice(0, 4).map((d, idx) => {
                const widthPercent = Math.max((d.missionCount / maxDestCount) * 100, 10);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground truncate max-w-[140px]">
                        {idx + 1}. {d.destination}
                      </span>
                      <span className="font-bold text-blue-700 dark:text-blue-400 tabular-nums">
                        {d.missionCount} missions
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full transition-all duration-500"
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground flex justify-between">
                      <span>Carburant associé :</span>
                      <span>{formatPrice(d.fuelCost)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardShell>

        {/* Top Marchandises (Cargo) */}
        <CardShell className="border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-amber-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Marchandises (Fret)</h4>
              </div>
              <span className="text-[10px] font-semibold text-muted-foreground">Tonnage</span>
            </div>

            <div className="space-y-2.5">
              {topCargoTypes.slice(0, 4).map((c, idx) => {
                const widthPercent = Math.max((c.missionCount / maxCargoCount) * 100, 10);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-foreground truncate max-w-[140px]">
                        {idx + 1}. {c.cargoLabel}
                      </span>
                      <span className="font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                        {c.missionCount} voy.
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500 to-orange-400 rounded-full transition-all duration-500"
                        style={{ width: `${widthPercent}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground flex justify-between">
                      <span>{c.totalWeight > 0 ? `${c.totalWeight.toFixed(0)} T` : "Vrac"}</span>
                      <span>Gasoil {formatPrice(c.fuelCost)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardShell>
      </div>
    </div>
  );
}
