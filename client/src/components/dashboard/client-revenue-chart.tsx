import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
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
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/utils";
import { Building2, TrendingUp } from "lucide-react";

// Palette raffinée Emerald & Cyan pour Yaro FleetOS
const GRADIENT_COLORS = [
  { start: "#10b981", end: "#059669" }, // Émeraude profond
  { start: "#06b6d4", end: "#0891b2" }, // Cyan dynamique
  { start: "#3b82f6", end: "#2563eb" }, // Bleu cobalt
  { start: "#8b5cf6", end: "#7c3aed" }, // Violet moderne
  { start: "#f59e0b", end: "#d97706" }, // Ambre chaleureux
];

function CustomGlassmorphicTooltip({ active, payload }: any) {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-950/90 backdrop-blur-md border border-emerald-500/30 text-white p-3 rounded-xl shadow-2xl space-y-1.5 min-w-[180px]">
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5">
          <span className="font-semibold text-xs text-emerald-400 truncate max-w-[150px]">
            {data.name}
          </span>
          <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded-full">
            {data.factures} fact.
          </span>
        </div>
        <div className="flex items-baseline justify-between gap-3 pt-0.5">
          <span className="text-[11px] text-slate-400">CA Facturé :</span>
          <span className="text-sm font-bold text-white tabular-nums">
            {formatPrice(data.montant)}
          </span>
        </div>
      </div>
    );
  }
  return null;
}

export function ClientRevenueChart() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/statistics"],
    queryFn: async () => {
      const res = await fetch("/api/billing/statistics");
      return res.json();
    },
  });

  const raw = Array.isArray(data) ? data : (data?.byClient || data?.clients || []);

  const chartData = raw
    .map((c: any) => ({
      name: c.clientName || c.name || "Inconnu",
      montant: parseFloat(c.totalAmountTTC || c.totalAmount || c.total || c.amount || 0),
      factures: c.totalInvoices || c.invoiceCount || c.count || 0,
    }))
    .filter((c: any) => c.montant > 0);

  const totalRevenue = chartData.reduce((acc: number, curr: any) => acc + curr.montant, 0);

  return (
    <Card className="border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
      <CardHeader className="pb-3 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-foreground">
                Répartition du Chiffre d'Affaires par Client
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Volume facturé TTC et concentration du portefeuille
              </p>
            </div>
          </div>

          {chartData.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" />
                Total : {formatPrice(totalRevenue)}
              </span>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                ({chartData.length} clients actifs)
              </span>
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {isLoading ? (
          <Skeleton className="h-[260px] w-full rounded-xl" />
        ) : chartData.length > 0 ? (
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 10, left: 0, bottom: 20 }}
              >
                <defs>
                  {GRADIENT_COLORS.map((color, index) => (
                    <linearGradient
                      key={`grad-${index}`}
                      id={`clientGradient-${index}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={color.start} stopOpacity={0.95} />
                      <stop offset="100%" stopColor={color.end} stopOpacity={0.7} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="hsl(var(--border))"
                  opacity={0.4}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  dy={8}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  dx={-4}
                  tickFormatter={(v) =>
                    v >= 1_000_000
                      ? `${(v / 1_000_000).toFixed(1)}M`
                      : v >= 1_000
                      ? `${(v / 1_000).toFixed(0)}k`
                      : `${v}`
                  }
                />
                <Tooltip content={<CustomGlassmorphicTooltip />} cursor={{ fill: "hsl(var(--muted)/0.3)" }} />
                <Bar
                  dataKey="montant"
                  name="montant"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={48}
                >
                  {chartData.map((_: any, index: number) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={`url(#clientGradient-${index % GRADIENT_COLORS.length})`}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-[260px] flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
            <Building2 className="h-8 w-8 text-muted-foreground/40" />
            <p>Aucune donnée de facturation enregistrée sur la période.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
