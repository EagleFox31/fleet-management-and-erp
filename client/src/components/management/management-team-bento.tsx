import { useMemo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Award,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  Fuel,
  Info,
  Layers,
  MapPin,
  Package,
  Route,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Truck,
  UserCheck,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CardShell, SectionLabel } from "@/components/design-system";
import { formatDistance, formatPrice } from "@/lib/utils";
import type {
  ManagementTeamDecision,
  ManagementTeamPole,
  ManagementTeamPoleId,
  ManagementTeamResponse,
} from "@shared/constants/management-team";

type ManagementTeamBentoProps = {
  data: ManagementTeamResponse;
  selectedPoleId: ManagementTeamPoleId | null;
  onSelectPole: (poleId: ManagementTeamPoleId) => void;
};

function GlassmorphicTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const item = payload[0];
    return (
      <div className="bg-slate-950/90 backdrop-blur-md border border-slate-700 text-white p-3 rounded-xl shadow-2xl space-y-1 min-w-[160px]">
        <div className="font-semibold text-xs text-emerald-400 border-b border-slate-800 pb-1">
          {item.name}
        </div>
        <div className="flex items-baseline justify-between gap-3 pt-0.5">
          <span className="text-[11px] text-slate-400">Effectif :</span>
          <span className="text-sm font-bold text-white tabular-nums">
            {item.value} conducteur(s)
          </span>
        </div>
      </div>
    );
  }
  return null;
}

export function ManagementTeamBento({
  data,
  selectedPoleId,
  onSelectPole,
}: ManagementTeamBentoProps) {
  const { summary, poles, drivers, mobility, productivity, rewards, decisions } = data;

  const complianceRate =
    summary.driversField > 0 ? (drivers.cpcCompliant / summary.driversField) * 100 : 100;

  // Données Donut Conformité Permis / CPC
  const complianceDonutData = useMemo(() => {
    return [
      { name: "Conformes & À jour", value: drivers.cpcCompliant, color: "#10b981" },
      { name: "À recycler / Former", value: Math.max(0, drivers.cpcGap - drivers.cpcUrgent), color: "#f59e0b" },
      { name: "Urgences (< 30j)", value: drivers.cpcUrgent, color: "#ef4444" },
    ].filter((d) => d.value > 0);
  }, [drivers]);

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. BENTO ROW 1 : 4 Ratios Stratégiques du Capital Humain (Google-like)   */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Taux de Mobilisation */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 dark:border-emerald-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 text-emerald-600" /> Mobilisation Flotte
            </span>
            <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <Zap className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {mobility.mobilizationRate.toFixed(0)} %
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              <strong className="text-foreground">{summary.driversActive}</strong> chauffeurs sur route / {summary.driversField} au volant
            </p>
          </div>
        </div>

        {/* Conformité Permis & CPC */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border border-blue-500/20 dark:border-blue-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-blue-600" /> Conformité Réglementaire
            </span>
            <span className="p-1.5 rounded-lg bg-blue-500/20 text-blue-700 dark:text-blue-300">
              <ShieldCheck className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-blue-700 dark:text-blue-400 tabular-nums">
              {complianceRate.toFixed(0)} %
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {drivers.cpcUrgent > 0 ? (
                <span className="text-rose-600 font-bold">{drivers.cpcUrgent} urgence(s) &lt; 30 jours</span>
              ) : (
                <span>{drivers.cpcCompliant} conducteurs habilités</span>
              )}
            </p>
          </div>
        </div>

        {/* Forces Vives & Comptes App */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent border border-purple-500/20 dark:border-purple-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-purple-600" /> Effectif Total Entreprise
            </span>
            <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-700 dark:text-purple-300">
              <Users className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-purple-700 dark:text-purple-400 tabular-nums">
              {summary.appAccounts + summary.driversField}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {summary.appAccounts} managers/techs + {summary.driversField} chauffeurs
            </p>
          </div>
        </div>

        {/* Frais de Route & Primes */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 dark:border-amber-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-amber-600" /> Frais de Route (FDR)
            </span>
            <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">
              {formatPrice(rewards.totalRoadExpenses)}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Indemnités per diem versées sur la période
            </p>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. BENTO ROW 2 : Les 3 Pôles Opérationnels & Radar de Conformité           */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Pôles Opérationnels & Rendement Métier (7/12) */}
        <CardShell className="lg:col-span-7 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h4 className="text-sm font-semibold text-foreground">Pôles d'Activité &amp; Productivité</h4>
                <p className="text-xs text-muted-foreground">Forces opérationnelles et rendement par métier</p>
              </div>
              <span className="text-xs font-bold text-muted-foreground">3 Pôles Clés</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Pôle Exploitation */}
              <button
                type="button"
                onClick={() => onSelectPole("operations")}
                className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between space-y-3 ${
                  selectedPoleId === "operations"
                    ? "bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-500/20"
                    : "bg-slate-50/80 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800 hover:border-emerald-500/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                    <Truck className="h-4 w-4" />
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                    Exploitation
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-bold text-foreground block">
                    {productivity.operations.missionsTotal} missions
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDistance(productivity.operations.totalKm)} parcourus
                  </p>
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold pt-1 border-t border-slate-200 dark:border-slate-800">
                    CA/Chauffeur : {formatPrice(productivity.operations.averageRevenuePerDriver)}
                  </p>
                </div>
              </button>

              {/* Pôle Atelier */}
              <button
                type="button"
                onClick={() => onSelectPole("workshop")}
                className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between space-y-3 ${
                  selectedPoleId === "workshop"
                    ? "bg-blue-500/10 border-blue-500 ring-2 ring-blue-500/20"
                    : "bg-slate-50/80 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800 hover:border-blue-500/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="p-2 rounded-xl bg-blue-500/20 text-blue-700 dark:text-blue-300">
                    <Wrench className="h-4 w-4" />
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300">
                    Atelier
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-bold text-foreground block">
                    {productivity.workshop.completedWorkOrders} OT clôturés
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Downtime : {productivity.workshop.averageDowntimeHours.toFixed(1)} h / OT
                  </p>
                  <p className="text-[10px] text-blue-700 dark:text-blue-400 font-semibold pt-1 border-t border-slate-200 dark:border-slate-800">
                    Réactivité maintenance
                  </p>
                </div>
              </button>

              {/* Pôle Magasin */}
              <button
                type="button"
                onClick={() => onSelectPole("warehouse")}
                className={`p-3.5 rounded-2xl border text-left transition cursor-pointer flex flex-col justify-between space-y-3 ${
                  selectedPoleId === "warehouse"
                    ? "bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/20"
                    : "bg-slate-50/80 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800 hover:border-amber-500/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="p-2 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
                    <Package className="h-4 w-4" />
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                    Magasin
                  </span>
                </div>

                <div className="space-y-1">
                  <span className="text-xs font-bold text-foreground block">
                    {productivity.warehouse.partsMovementCount} flux stock
                  </span>
                  <p className="text-[11px] text-muted-foreground">
                    Pièces &amp; pneumatiques
                  </p>
                  <p className="text-[10px] text-amber-700 dark:text-amber-400 font-semibold pt-1 border-t border-slate-200 dark:border-slate-800">
                    Zéro rupture critique
                  </p>
                </div>
              </button>
            </div>
          </div>
        </CardShell>

        {/* Radar de Conformité Légale & Permis (5/12) */}
        <CardShell className="lg:col-span-5 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 border border-blue-500/20">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Conformité Permis &amp; CPC</h4>
                  <p className="text-xs text-muted-foreground">Contrôle des habilitations obligatoires</p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                {drivers.cpcCompliant}/{summary.driversField} à jour
              </span>
            </div>

            <div className="relative h-[150px] w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<GlassmorphicTooltip />} />
                  <Pie
                    data={complianceDonutData}
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {complianceDonutData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>

              <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                  Chauffeurs
                </span>
                <span className="text-base font-extrabold text-foreground tabular-nums">
                  {summary.driversField}
                </span>
              </div>
            </div>

            {/* Légende de conformité */}
            <div className="grid grid-cols-3 gap-1.5 pt-1 text-[11px]">
              <div className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-center">
                <span className="font-bold text-emerald-700 dark:text-emerald-400 block">{drivers.cpcCompliant}</span>
                <span className="text-[9px] text-muted-foreground">Conformes</span>
              </div>
              <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-center">
                <span className="font-bold text-amber-700 dark:text-amber-400 block">{drivers.cpcGap}</span>
                <span className="text-[9px] text-muted-foreground">À recycler</span>
              </div>
              <div className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-center">
                <span className="font-bold text-rose-700 dark:text-rose-400 block">{drivers.cpcUrgent}</span>
                <span className="text-[9px] text-muted-foreground">&lt; 30 jours</span>
              </div>
            </div>
          </div>
        </CardShell>
      </div>

      {/* ========================================================================= */}
      {/* 3. BENTO ROW 3 : Palmarès & Primes vs Décisions / Arbitrages DG           */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Palmarès d'Éco-Conduite & Primes (6/12) */}
        <CardShell className="lg:col-span-6 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <Star className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Palmarès &amp; Primes d'Éco-conduite</h4>
                  <p className="text-xs text-muted-foreground">Chauffeurs éligibles aux primes de performance</p>
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {rewards.topPerformers.length > 0 ? (
                rewards.topPerformers.map((d, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="h-6 w-6 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-extrabold text-[11px] flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-foreground truncate">{d.driverName}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {d.averageConsumptionL100 ? `${d.averageConsumptionL100.toFixed(1)} L/100 km` : "Conso optimale"} · {d.missionCount} mission(s)
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 block tabular-nums">
                        {d.overallScore}/100
                      </span>
                      <span className="text-[9px] text-emerald-600 font-semibold uppercase">
                        Prime éligible
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-6 text-center">Aucun chauffeur noté sur la période.</p>
              )}
            </div>
          </div>
        </CardShell>

        {/* Arbitrages & Décisions Direction (6/12) */}
        <CardShell className="lg:col-span-6 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 border border-amber-500/20">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Arbitrages &amp; Décisions Direction</h4>
                  <p className="text-xs text-muted-foreground">Actions prioritaires à valider avec les managers</p>
                </div>
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                decisions.some((d) => d.severity === "critical")
                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
              }`}>
                {decisions.length} décision(s)
              </span>
            </div>

            <div className="space-y-2.5">
              {decisions.length > 0 ? (
                decisions.map((d, idx) => {
                  const isCrit = d.severity === "critical";
                  const isWarn = d.severity === "warning";
                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${
                        isCrit
                          ? "bg-rose-50/70 dark:bg-rose-950/30 border-rose-200/60 dark:border-rose-900/40"
                          : isWarn
                          ? "bg-amber-50/70 dark:bg-amber-950/30 border-amber-200/60 dark:border-amber-900/40"
                          : "bg-blue-50/70 dark:bg-blue-950/30 border-blue-200/60 dark:border-blue-900/40"
                      }`}
                    >
                      <div className="mt-0.5">
                        {isCrit ? (
                          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                        ) : isWarn ? (
                          <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                        ) : (
                          <Info className="h-4 w-4 text-blue-600 shrink-0" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-foreground">{d.title}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{d.recommendation}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="p-6 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/50 text-center space-y-1">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto" />
                  <p className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Toutes les équipes sont alignées</p>
                  <p className="text-[11px] text-muted-foreground">Aucune décision urgente en attente d&apos;arbitrage.</p>
                </div>
              )}
            </div>
          </div>
        </CardShell>
      </div>
    </div>
  );
}
