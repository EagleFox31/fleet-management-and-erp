import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  DollarSign,
  Fuel,
  Percent,
  PieChart as PieIcon,
  Receipt,
  Route,
  TrendingUp,
  Wallet,
  Wrench,
} from "lucide-react";
import { CardShell, SectionLabel } from "@/components/design-system";
import { formatPrice } from "@/lib/utils";
import type { ManagementDashboardResponse } from "@shared/constants/management-dashboard";

type ManagementFinancialOverviewProps = {
  data: ManagementDashboardResponse;
};

// Couleurs Google-like épurées et modernes
const EXPENSE_COLORS = [
  { name: "Carburant", color: "#f59e0b", gradient: ["#f59e0b", "#d97706"] }, // Ambre
  { name: "Fournisseurs", color: "#3b82f6", gradient: ["#3b82f6", "#2563eb"] }, // Bleu
  { name: "Atelier", color: "#ef4444", gradient: ["#ef4444", "#dc2626"] }, // Rouge
  { name: "Frais de route", color: "#8b5cf6", gradient: ["#8b5cf6", "#7c3aed"] }, // Violet
];

function GlassmorphicFinancialTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const item = payload[0];
    return (
      <div className="bg-slate-950/90 backdrop-blur-md border border-slate-700 text-white p-3 rounded-xl shadow-2xl space-y-1.5 min-w-[180px]">
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1">
          <span className="font-semibold text-xs text-slate-300">{item.name}</span>
          {item.payload.percent != null && (
            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-bold">
              {item.payload.percent.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3 pt-0.5">
          <span className="text-[11px] text-slate-400">Montant :</span>
          <span className="text-sm font-bold text-white tabular-nums">
            {formatPrice(item.value)}
          </span>
        </div>
      </div>
    );
  }
  return null;
}

export function ManagementFinancialOverview({ data }: ManagementFinancialOverviewProps) {
  const { revenue, expenses, result, executiveKpis } = data;

  // Calcul des ratios exécutifs
  const recoveryRate = revenue.invoicedTTC > 0 ? (revenue.collectedTTC / revenue.invoicedTTC) * 100 : 0;
  const fuelWeightPercent = revenue.invoicedHT > 0 ? (expenses.fuel / revenue.invoicedHT) * 100 : 0;
  const marginPerMillion = revenue.invoicedHT > 0 ? (result.grossHT / revenue.invoicedHT) * 1_000_000 : 0;

  // Données du graphique comparatif Bilan d'Exploitation
  const comparisonData = useMemo(() => {
    return [
      {
        name: "CA Facturé (HT)",
        montant: revenue.invoicedHT,
        color: "#3b82f6",
        description: "Revenus d'exploitation",
      },
      {
        name: "Charges Directes",
        montant: expenses.total,
        color: "#ef4444",
        description: "Carburant + Achats + Atelier + FDR",
      },
      {
        name: "Résultat Brut",
        montant: Math.max(0, result.grossHT),
        color: "#10b981",
        description: `Marge nette de ${result.marginPercent.toFixed(1)}%`,
      },
    ];
  }, [revenue.invoicedHT, expenses.total, result.grossHT, result.marginPercent]);

  // Données du Donut de répartition des charges
  const expensePieData = useMemo(() => {
    return [
      { name: "Carburant", value: expenses.fuel, color: EXPENSE_COLORS[0].color },
      { name: "Fournisseurs", value: expenses.suppliers, color: EXPENSE_COLORS[1].color },
      { name: "Maintenance atelier", value: expenses.maintenance, color: EXPENSE_COLORS[2].color },
      { name: "Frais de route", value: expenses.roadExpenses, color: EXPENSE_COLORS[3].color },
    ].filter((item) => item.value > 0);
  }, [expenses]);

  return (
    <div className="space-y-4">
      {/* 1. Ligne des 4 Ratios Financiers Stratégiques Google-like */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Taux de Marge */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 dark:border-emerald-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
              <Percent className="h-3.5 w-3.5 text-emerald-600" /> Taux de Marge Brute
            </span>
            <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {result.marginPercent.toFixed(1)} %
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Résultat brut : <strong className="text-foreground">{formatPrice(result.grossHT)}</strong>
            </p>
          </div>
        </div>

        {/* Taux de Recouvrement Trésorerie */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border border-blue-500/20 dark:border-blue-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> Taux de Recouvrement
            </span>
            <span className="p-1.5 rounded-lg bg-blue-500/20 text-blue-700 dark:text-blue-300">
              <DollarSign className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-blue-700 dark:text-blue-400 tabular-nums">
              {recoveryRate.toFixed(0)} %
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Encaissé : <strong className="text-foreground">{formatPrice(revenue.collectedTTC)}</strong>
            </p>
          </div>
        </div>

        {/* Poids du Carburant sur le CA */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 dark:border-amber-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
              <Fuel className="h-3.5 w-3.5 text-amber-600" /> Ratio Carburant / CA
            </span>
            <span className="p-1.5 rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <Fuel className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">
              {fuelWeightPercent.toFixed(1)} %
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Dépense gasoil : <strong className="text-foreground">{formatPrice(expenses.fuel)}</strong>
            </p>
          </div>
        </div>

        {/* Prix de Revient Kilométrique (PRK) */}
        <div className="p-4 rounded-2xl bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent border border-purple-500/20 dark:border-purple-900/40 shadow-xs flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-800 dark:text-purple-300 flex items-center gap-1.5">
              <Route className="h-3.5 w-3.5 text-purple-600" /> PRK Moyen Réel
            </span>
            <span className="p-1.5 rounded-lg bg-purple-500/20 text-purple-700 dark:text-purple-300">
              <Route className="h-4 w-4" />
            </span>
          </div>
          <div>
            <div className="text-2xl sm:text-3xl font-extrabold text-purple-700 dark:text-purple-400 tabular-nums">
              {executiveKpis.prk.fcfPerKm != null ? `${formatPrice(Math.round(executiveKpis.prk.fcfPerKm))}` : "—"}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Coût total par km roulé sur missions
            </p>
          </div>
        </div>
      </div>

      {/* 2. Les 2 Grands Graphiques Financiers Exécutifs Google-like */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Graphique 1 (7/12) : Bilan CA vs Charges vs Marge */}
        <CardShell className="lg:col-span-7 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-600 border border-blue-500/20">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div>
                  <SectionLabel>Équilibre d'Exploitation : CA vs Charges vs Marge</SectionLabel>
                  <p className="text-xs text-muted-foreground">
                    Comparatif direct des flux financiers hors taxes sur la période
                  </p>
                </div>
              </div>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-muted-foreground">
                Base HT
              </span>
            </div>

            <div className="h-[260px] w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparisonData} margin={{ top: 10, right: 10, left: 0, bottom: 10 }}>
                  <defs>
                    <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.75} />
                    </linearGradient>
                    <linearGradient id="redGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ef4444" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#b91c1c" stopOpacity={0.75} />
                    </linearGradient>
                    <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.95} />
                      <stop offset="100%" stopColor="#047857" stopOpacity={0.75} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1_000_000
                        ? `${(v / 1_000_000).toFixed(1)}M`
                        : v >= 1_000
                        ? `${(v / 1_000).toFixed(0)}k`
                        : `${v}`
                    }
                  />
                  <Tooltip content={<GlassmorphicFinancialTooltip />} cursor={{ fill: "hsl(var(--muted)/0.2)" }} />
                  <Bar dataKey="montant" radius={[8, 8, 0, 0]} maxBarSize={64}>
                    <Cell fill="url(#blueGrad)" />
                    <Cell fill="url(#redGrad)" />
                    <Cell fill="url(#greenGrad)" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Note d'impact DG */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/60 dark:border-slate-800 text-xs text-muted-foreground flex items-center justify-between">
              <span>Ratio de rentabilité brute :</span>
              <span className="font-bold text-foreground">
                Pour 1 000 000 FCFA de CA HT → {formatPrice(Math.round(marginPerMillion))} de marge brute
              </span>
            </div>
          </div>
        </CardShell>

        {/* Graphique 2 (5/12) : Donut Chart Structure des Coûts */}
        <CardShell className="lg:col-span-5 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 border border-amber-500/20">
                  <PieIcon className="h-4 w-4" />
                </div>
                <div>
                  <SectionLabel>Structure des Charges Directes</SectionLabel>
                  <p className="text-xs text-muted-foreground">Ventilation par poste de coût</p>
                </div>
              </div>
            </div>

            <div className="relative h-[190px] w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<GlassmorphicFinancialTooltip />} />
                  <Pie
                    data={expensePieData}
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {expensePieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>

              {/* Montant total au centre du Donut */}
              <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                  Total
                </span>
                <span className="text-sm font-extrabold text-foreground tabular-nums">
                  {formatPrice(expenses.total)}
                </span>
              </div>
            </div>

            {/* Légende interactive sous le Donut */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {expensePieData.map((item, index) => {
                const percent = expenses.total > 0 ? (item.value / expenses.total) * 100 : 0;
                return (
                  <div
                    key={index}
                    className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-xs font-medium text-foreground truncate">{item.name}</span>
                    </div>
                    <span className="text-xs font-bold text-muted-foreground tabular-nums shrink-0">
                      {percent.toFixed(0)}%
                    </span>
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
