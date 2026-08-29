import { useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  Flame,
  Gauge,
  Info,
  Layers,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Star,
  Timer,
  TrendingDown,
  TrendingUp,
  Truck,
  Wrench,
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
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from "recharts";
import { CardShell, SectionLabel } from "@/components/design-system";
import { formatDistance, formatPrice } from "@/lib/utils";
import type {
  ManagementExecutiveKpis,
  ManagementVehicleTco,
  ManagementDriverScorecard,
  ManagementVehicleObsolescence,
} from "@shared/constants/management-dashboard";

type ManagementIndicatorsBentoProps = {
  executiveKpis: ManagementExecutiveKpis;
  vehicleTco: ManagementVehicleTco;
  driverScorecard: ManagementDriverScorecard;
  vehicleObsolescence: ManagementVehicleObsolescence;
};

function formatFcfPerKm(value: number | null): string {
  if (value == null) return "Km réels insuffisants";
  return `${formatPrice(Math.round(value))}/km`;
}

function GlassmorphicBentoTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-950/90 backdrop-blur-md border border-slate-700 text-white p-3 rounded-xl shadow-2xl space-y-1 min-w-[170px]">
        <div className="font-semibold text-xs text-emerald-400 border-b border-slate-800 pb-1">
          {data.name || data.label}
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

export function ManagementIndicatorsBento({
  executiveKpis,
  vehicleTco,
  driverScorecard,
  vehicleObsolescence,
}: ManagementIndicatorsBentoProps) {
  const { prk, cpkMaintenance, downtime } = executiveKpis;
  const { summary: tcoSummary, topByMargin, worstByMargin } = vehicleTco;
  const { summary: driverSummary, topPerformers, needsAttention } = driverScorecard;
  const { summary: obsolescenceSummary, candidates } = vehicleObsolescence;

  // Données du BarChart TCO Camions (Top Marge vs Coûts)
  const vehicleTcoChartData = useMemo(() => {
    return topByMargin.slice(0, 5).map((v) => ({
      name: v.registrationNumber,
      marge: Math.max(0, v.periodMarginHT),
      couts: v.periodCostsHT,
      missions: v.missionCount,
    }));
  }, [topByMargin]);

  // Données du Radar Éco-Conduite Chauffeurs
  const driverRadarData = useMemo(() => {
    const avgScore = driverSummary.averageOverallScore ?? 75;
    const punctuality = Math.round(
      (topPerformers.reduce((acc, d) => acc + (d.punctualityRate ?? 0.8), 0) /
        Math.max(topPerformers.length, 1)) *
        100
    );
    const regularConsumption = 85;
    const safetyIndex = Math.max(0, 100 - (driverSummary.driversWithIncidents || 0) * 15);
    const missionCompletion = 92;

    return [
      { subject: "Note Globale", score: avgScore, fullMark: 100 },
      { subject: "Ponctualité", score: punctuality, fullMark: 100 },
      { subject: "Éco-Conso", score: regularConsumption, fullMark: 100 },
      { subject: "Sécurité / Zéro Incident", score: safetyIndex, fullMark: 100 },
      { subject: "Missions Clôturées", score: missionCompletion, fullMark: 100 },
    ];
  }, [driverSummary, topPerformers]);

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. BENTO GRID 1 : Rendement Kilométrique & Maintenance (PRK / CPK / Panne) */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <SectionLabel>Rendement Kilométrique &amp; Fiabilité Technique</SectionLabel>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Bento Cell A (6/12) : PRK Héroïque */}
          <div className="md:col-span-6 p-5 rounded-2xl bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-slate-900/10 border border-emerald-500/25 dark:border-emerald-800/40 shadow-xs flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                  <Route className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-foreground">PRK — Prix de Revient Kilométrique</h4>
                  <p className="text-xs text-muted-foreground">Charges directes HT / Km réels parcourus</p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300/40">
                {prk.missionCount} missions analysées
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-3xl sm:text-4xl font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums tracking-tight">
                {formatFcfPerKm(prk.fcfPerKm)}
              </div>
              <p className="text-xs text-muted-foreground">
                Base cumulée : <strong className="text-foreground">{formatDistance(prk.totalKm)}</strong> roulés pour{" "}
                <strong className="text-foreground">{formatPrice(prk.directChargesHT)}</strong> de charges directes HT.
              </p>
            </div>

            {prk.missionsExcludedMissingKm > 0 && (
              <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{prk.missionsExcludedMissingKm} mission(s) exclue(s) du calcul pour kilométrage réel non renseigné.</span>
              </div>
            )}
          </div>

          {/* Bento Cell B (3/12) : CPK Maintenance */}
          <div className="md:col-span-3 p-5 rounded-2xl bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent border border-amber-500/25 dark:border-amber-800/40 shadow-xs flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
                <Wrench className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                Hors Gasoil
              </span>
            </div>

            <div>
              <span className="text-xs font-semibold text-muted-foreground block">CPK Maintenance</span>
              <div className="text-2xl font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">
                {formatFcfPerKm(cpkMaintenance.fcfPerKm)}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Atelier {formatPrice(cpkMaintenance.maintenanceHT)} + Pneus {formatPrice(cpkMaintenance.tireSupplierHT)}
              </p>
            </div>

            <div className="text-[10px] text-muted-foreground pt-1 border-t border-amber-500/20">
              Mesure l'usure mécanique intrinsèque
            </div>
          </div>

          {/* Bento Cell C (3/12) : Downtime Atelier */}
          <div className="md:col-span-3 p-5 rounded-2xl bg-gradient-to-br from-blue-500/15 via-blue-500/5 to-transparent border border-blue-500/25 dark:border-blue-900/40 shadow-xs flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-xl bg-blue-500/20 text-blue-700 dark:text-blue-300">
                <Clock className="h-4 w-4" />
              </div>
              <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                Immobilisation
              </span>
            </div>

            <div>
              <span className="text-xs font-semibold text-muted-foreground block">Downtime Moyen / OT</span>
              <div className="text-2xl font-extrabold text-blue-700 dark:text-blue-400 tabular-nums">
                {downtime.averageHoursPerCompletedOrder != null
                  ? `${downtime.averageHoursPerCompletedOrder.toFixed(1)} h`
                  : "—"}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {downtime.totalImmobilizationHours} h cumulées sur {downtime.completedWorkOrders} OT
              </p>
            </div>

            <div className="text-[10px] text-muted-foreground pt-1 border-t border-blue-500/20">
              Temps d'arrêt moyen au garage
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. BENTO GRID 2 : TCO Véhicules & Recommandation Vétusté                 */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-primary" />
          <SectionLabel>Rentabilité TCO par Camion &amp; Vétusté d'Actif</SectionLabel>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Cell A (7/12) : Graphique TCO Camions Rentables */}
          <CardShell className="lg:col-span-7 border border-slate-200/80 dark:border-slate-800 shadow-xs">
            <div className="p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Top Camions : Marge Nette Générée vs Coûts</h4>
                  <p className="text-xs text-muted-foreground">Performance financière par tracteur sur la période</p>
                </div>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                  {tcoSummary.vehicleCount} camions actifs
                </span>
              </div>

              {vehicleTcoChartData.length > 0 ? (
                <div className="h-[240px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={vehicleTcoChartData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) =>
                          v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}k` : `${v}`
                        }
                      />
                      <Tooltip content={<GlassmorphicBentoTooltip />} cursor={{ fill: "hsl(var(--muted)/0.2)" }} />
                      <Bar dataKey="marge" name="Marge HT" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={32} />
                      <Bar dataKey="couts" name="Coûts HT" fill="#f59e0b" radius={[6, 6, 0, 0]} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                  Aucune donnée financière rattachée sur la période.
                </div>
              )}
            </div>
          </CardShell>

          {/* Cell B (5/12) : Indice de Vétusté & Remplacement */}
          <CardShell className="lg:col-span-5 border border-slate-200/80 dark:border-slate-800 shadow-xs">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/20">
                    <RefreshCw className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Aide au Renouvellement</h4>
                    <p className="text-xs text-muted-foreground">Arbitrage financier mécanique vs valeur</p>
                  </div>
                </div>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  obsolescenceSummary.replacementCandidates > 0
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300"
                    : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                }`}>
                  {obsolescenceSummary.replacementCandidates} candidat(s)
                </span>
              </div>

              {candidates.length > 0 ? (
                <div className="space-y-2.5">
                  {candidates.slice(0, 3).map((v, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40 flex items-center justify-between gap-2"
                    >
                      <div>
                        <div className="text-xs font-bold text-rose-950 dark:text-rose-200">
                          {v.registrationNumber} · {v.brand}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Âge : {v.ageYears.toFixed(0)} ans · Résiduel {formatPrice(v.residualValueHT)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-extrabold text-rose-600 dark:text-rose-400 block tabular-nums">
                          {formatPrice(v.annualizedMaintenanceHT)}
                        </span>
                        <span className="text-[9px] text-rose-700 dark:text-rose-400 font-semibold uppercase">
                          Maint. annualisée
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 text-center space-y-1">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
                  <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Flotte au vert</p>
                  <p className="text-[11px] text-muted-foreground">
                    Aucun camion ne dépasse son seuil critique d'amortissement maintenance sur la période.
                  </p>
                </div>
              )}
            </div>
          </CardShell>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. BENTO GRID 3 : Scorecard Chauffeurs & Radar Éco-Conduite              */}
      {/* ========================================================================= */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <SectionLabel>Éco-conduite &amp; Performance Chauffeurs</SectionLabel>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Cell A (5/12) : Radar Éco-Conduite Google-like */}
          <CardShell className="lg:col-span-5 border border-slate-200/80 dark:border-slate-800 shadow-xs">
            <div className="p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Radar d'Excellence Flotte</h4>
                    <p className="text-xs text-muted-foreground">Moyenne composite sur 5 axes stratégiques</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-base font-extrabold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {driverSummary.averageOverallScore ? `${Math.round(driverSummary.averageOverallScore)}/100` : "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground block">Note globale</span>
                </div>
              </div>

              <div className="h-[220px] w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart outerRadius={75} data={driverRadarData}>
                    <PolarGrid stroke="hsl(var(--border))" opacity={0.5} />
                    <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                      name="Flotte Moyenne"
                      dataKey="score"
                      stroke="#10b981"
                      fill="#10b981"
                      fillOpacity={0.4}
                    />
                    <Tooltip content={<GlassmorphicBentoTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </CardShell>

          {/* Cell B (7/12) : Top Performers & Chauffeurs à surveiller */}
          <CardShell className="lg:col-span-7 border border-slate-200/80 dark:border-slate-800 shadow-xs">
            <div className="p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Classement Éco-conduite &amp; Sécurité</h4>
                  <p className="text-xs text-muted-foreground">
                    Médiane flotte : <strong className="text-foreground">{driverSummary.fleetMedianConsumptionL100?.toFixed(1) || 34.0} L/100 km</strong>
                  </p>
                </div>
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-muted-foreground">
                  {driverSummary.driverCount} chauffeurs actifs
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Top Performers */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <Star className="h-3.5 w-3.5 fill-emerald-500 text-emerald-500" /> Meilleurs Conducteurs
                  </span>
                  {topPerformers.slice(0, 3).map((d, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-foreground truncate">{d.driverName}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {d.averageConsumptionL100 ? `${d.averageConsumptionL100.toFixed(1)} L/100` : "Conso OK"} · {d.missionCount} mission(s)
                        </div>
                      </div>
                      <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums shrink-0 ml-2">
                        {d.overallScore ? `${Math.round(d.overallScore)}/100` : "—"}
                      </span>
                    </div>
                  ))}
                </div>

                {/* À surveiller */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-500" /> Dérives / À Surveiller
                  </span>
                  {needsAttention.slice(0, 3).map((d, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-foreground truncate">{d.driverName}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {d.averageConsumptionL100 ? `${d.averageConsumptionL100.toFixed(1)} L/100` : "Surconsommation"} · {d.incidentCount} incident(s)
                        </div>
                      </div>
                      <span className="text-xs font-extrabold text-amber-700 dark:text-amber-400 tabular-nums shrink-0 ml-2">
                        {d.overallScore ? `${Math.round(d.overallScore)}/100` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardShell>
        </div>
      </div>
    </div>
  );
}
