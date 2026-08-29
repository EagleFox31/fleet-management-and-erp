import { useMemo } from "react";
import {
  ArrowDownCircle,
  ArrowDownRight,
  ArrowUpCircle,
  ArrowUpRight,
  CheckCircle2,
  DollarSign,
  Fuel,
  MinusCircle,
  Percent,
  Receipt,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
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
  PieChart,
  Pie,
} from "recharts";
import { CardShell, SectionLabel } from "@/components/design-system";
import { formatPrice } from "@/lib/utils";

type MoneyFlowPanelProps = {
  revenueTTC: number;
  collectedTTC: number;
  outstandingTTC: number;
  expensesTotal: number;
  grossHT: number;
  marginPercent: number;
  expenseBreakdown: {
    fuel: number;
    maintenance: number;
    suppliers: number;
    roadExpenses: number;
  };
};

function GlassmorphicMoneyTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const item = payload[0];
    return (
      <div className="bg-slate-950/90 backdrop-blur-md border border-slate-700 text-white p-3 rounded-xl shadow-2xl space-y-1 min-w-[170px]">
        <div className="font-semibold text-xs text-slate-300 border-b border-slate-800 pb-1">
          {item.payload.name}
        </div>
        <div className="flex items-baseline justify-between gap-3 pt-0.5">
          <span className="text-[11px] text-slate-400">Montant :</span>
          <span className="text-sm font-bold text-white tabular-nums">
            {formatPrice(item.value)}
          </span>
        </div>
        {item.payload.percent != null && (
          <div className="text-[10px] text-emerald-400 font-semibold">
            {item.payload.percent.toFixed(1)}% des charges
          </div>
        )}
      </div>
    );
  }
  return null;
}

export function MoneyFlowPanel({
  revenueTTC,
  collectedTTC,
  outstandingTTC,
  expensesTotal,
  grossHT,
  marginPercent,
  expenseBreakdown,
}: MoneyFlowPanelProps) {
  const collectionRate = revenueTTC > 0 ? (collectedTTC / revenueTTC) * 100 : 0;

  // Pourcentages des charges
  const fuelPercent = expensesTotal > 0 ? (expenseBreakdown.fuel / expensesTotal) * 100 : 0;
  const maintenancePercent = expensesTotal > 0 ? (expenseBreakdown.maintenance / expensesTotal) * 100 : 0;
  const suppliersPercent = expensesTotal > 0 ? (expenseBreakdown.suppliers / expensesTotal) * 100 : 0;
  const roadExpensesPercent = expensesTotal > 0 ? (expenseBreakdown.roadExpenses / expensesTotal) * 100 : 0;

  // Données pour le BarChart des Dépenses
  const expensesChartData = useMemo(() => {
    return [
      { name: "Carburant", montant: expenseBreakdown.fuel, color: "#f59e0b", percent: fuelPercent },
      { name: "Fournisseurs", montant: expenseBreakdown.suppliers, color: "#3b82f6", percent: suppliersPercent },
      { name: "Atelier", montant: expenseBreakdown.maintenance, color: "#ef4444", percent: maintenancePercent },
      { name: "FDR Route", montant: expenseBreakdown.roadExpenses, color: "#8b5cf6", percent: roadExpensesPercent },
    ];
  }, [expenseBreakdown, fuelPercent, suppliersPercent, maintenancePercent, roadExpensesPercent]);

  // Données de Cash Recouvré vs Impayés
  const cashPieData = useMemo(() => {
    return [
      { name: "Encaissé (Disponible)", value: collectedTTC, color: "#10b981" },
      { name: "Créances (Impayés)", value: Math.max(0, outstandingTTC), color: "#f59e0b" },
    ].filter((d) => d.value > 0);
  }, [collectedTTC, outstandingTTC]);

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. BENTO HERO : Résultat Brut d'Exploitation (HT)                          */}
      {/* ========================================================================= */}
      <div
        className={`p-6 sm:p-7 rounded-3xl border shadow-sm transition-all relative overflow-hidden ${
          grossHT >= 0
            ? "bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-slate-900/10 border-emerald-500/30 dark:border-emerald-800/50"
            : "bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-slate-900/10 border-rose-500/30 dark:border-rose-800/50"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 relative z-10">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div
                className={`p-2 rounded-xl text-white ${
                  grossHT >= 0 ? "bg-emerald-600 shadow-md shadow-emerald-500/20" : "bg-rose-600 shadow-md shadow-rose-500/20"
                }`}
              >
                {grossHT >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Performance Nette
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-foreground">
                  Résultat Brut d'Exploitation (HT)
                </h3>
              </div>
            </div>
            <p className="text-xs text-muted-foreground max-w-xl leading-relaxed">
              Marge réelle conservée après déduction intégrale des charges directes d&apos;exploitation (Carburant, Achats Fournisseurs, Atelier &amp; Frais de Route).
            </p>
          </div>

          <div className="flex flex-col items-start md:items-end justify-center shrink-0 space-y-1">
            <div
              className={`text-3xl sm:text-4xl lg:text-5xl font-black tabular-nums tracking-tight ${
                grossHT >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {formatPrice(grossHT)}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1 rounded-full text-xs font-extrabold flex items-center gap-1 ${
                  grossHT >= 0
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300/40"
                    : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300/40"
                }`}
              >
                <Percent className="h-3 w-3" />
                Marge brute : {marginPercent.toFixed(1)} % du CA HT
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. BENTO GRID : Trésorerie Cash Flow vs Structure des Sorties             */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Bento Cell A (5/12) : Santé de Trésorerie & Recouvrement */}
        <CardShell className="lg:col-span-5 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <Wallet className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Trésorerie &amp; Recouvrement</h4>
                  <p className="text-xs text-muted-foreground">Cash réellement encaissé en banque</p>
                </div>
              </div>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                {collectionRate.toFixed(0)}% encaissé
              </span>
            </div>

            {/* Donut Cash Flow */}
            <div className="relative h-[160px] w-full flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip content={<GlassmorphicMoneyTooltip />} />
                  <Pie
                    data={cashPieData}
                    innerRadius={45}
                    outerRadius={65}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {cashPieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>

              <div className="absolute flex flex-col items-center justify-center text-center pointer-events-none">
                <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                  Facturé TTC
                </span>
                <span className="text-xs font-extrabold text-foreground tabular-nums">
                  {formatPrice(revenueTTC)}
                </span>
              </div>
            </div>

            {/* Détail Cash */}
            <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
              <div className="p-2.5 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60 dark:border-emerald-900/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs font-medium text-foreground">Encaissé sur compte</span>
                </div>
                <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {formatPrice(collectedTTC)}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-medium text-foreground">Créances à recouvrer</span>
                </div>
                <span className="text-sm font-bold text-amber-700 dark:text-amber-400 tabular-nums">
                  {formatPrice(outstandingTTC)}
                </span>
              </div>
            </div>
          </div>
        </CardShell>

        {/* Bento Cell B (7/12) : Graphique Google-like de Ventilation des Dépenses */}
        <CardShell className="lg:col-span-7 border border-slate-200/80 dark:border-slate-800 shadow-xs">
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/20">
                  <ArrowDownCircle className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-foreground">Ventilation des Charges Directes</h4>
                  <p className="text-xs text-muted-foreground">Poids comparé de chaque poste de coût</p>
                </div>
              </div>
              <span className="text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 px-2.5 py-0.5 rounded-full border border-rose-500/20">
                Total : {formatPrice(expensesTotal)}
              </span>
            </div>

            {/* Graphique en barres horizontales Google-like */}
            <div className="h-[220px] w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={expensesChartData}
                  layout="vertical"
                  margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
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
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "hsl(var(--foreground))", fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<GlassmorphicMoneyTooltip />} cursor={{ fill: "hsl(var(--muted)/0.2)" }} />
                  <Bar dataKey="montant" radius={[0, 6, 6, 0]} maxBarSize={24}>
                    {expensesChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Jauge segmentée d'un coup d'œil */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex gap-0.5">
                <div style={{ width: `${fuelPercent}%` }} className="bg-amber-500 rounded-xs" title={`Gasoil ${fuelPercent.toFixed(0)}%`} />
                <div style={{ width: `${suppliersPercent}%` }} className="bg-blue-500 rounded-xs" title={`Fournisseurs ${suppliersPercent.toFixed(0)}%`} />
                <div style={{ width: `${maintenancePercent}%` }} className="bg-rose-500 rounded-xs" title={`Atelier ${maintenancePercent.toFixed(0)}%`} />
                <div style={{ width: `${roadExpensesPercent}%` }} className="bg-purple-500 rounded-xs" title={`FDR ${roadExpensesPercent.toFixed(0)}%`} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Gasoil ({fuelPercent.toFixed(0)}%)</span>
                <span>Fournisseurs ({suppliersPercent.toFixed(0)}%)</span>
                <span>Atelier ({maintenancePercent.toFixed(0)}%)</span>
                <span>FDR ({roadExpensesPercent.toFixed(0)}%)</span>
              </div>
            </div>
          </div>
        </CardShell>
      </div>

      {/* ========================================================================= */}
      {/* 3. BENTO POSTES DE SORTIE DÉTAILLÉS                                       */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Carburant */}
        <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-700 dark:text-amber-300">
              <Fuel className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-foreground block">Carburant</span>
              <span className="text-[10px] text-muted-foreground">{fuelPercent.toFixed(1)}% des charges</span>
            </div>
          </div>
          <span className="text-sm font-extrabold text-amber-700 dark:text-amber-400 tabular-nums">
            {formatPrice(expenseBreakdown.fuel)}
          </span>
        </div>

        {/* Fournisseurs */}
        <div className="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-700 dark:text-blue-300">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-foreground block">Fournisseurs</span>
              <span className="text-[10px] text-muted-foreground">{suppliersPercent.toFixed(1)}% des charges</span>
            </div>
          </div>
          <span className="text-sm font-extrabold text-blue-700 dark:text-blue-400 tabular-nums">
            {formatPrice(expenseBreakdown.suppliers)}
          </span>
        </div>

        {/* Atelier */}
        <div className="p-4 rounded-2xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/20 text-rose-700 dark:text-rose-300">
              <Wrench className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-foreground block">Atelier</span>
              <span className="text-[10px] text-muted-foreground">{maintenancePercent.toFixed(1)}% des charges</span>
            </div>
          </div>
          <span className="text-sm font-extrabold text-rose-700 dark:text-rose-400 tabular-nums">
            {formatPrice(expenseBreakdown.maintenance)}
          </span>
        </div>

        {/* Frais de Route */}
        <div className="p-4 rounded-2xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200/60 dark:border-purple-900/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-700 dark:text-purple-300">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-semibold text-foreground block">FDR Missions</span>
              <span className="text-[10px] text-muted-foreground">{roadExpensesPercent.toFixed(1)}% des charges</span>
            </div>
          </div>
          <span className="text-sm font-extrabold text-purple-700 dark:text-purple-400 tabular-nums">
            {formatPrice(expenseBreakdown.roadExpenses)}
          </span>
        </div>
      </div>
    </div>
  );
}
