import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertTriangle, XCircle, GraduationCap } from "lucide-react";

interface CPCStatistics {
  total: number;
  forme: number;
  aFormer: number;
  nonForme: number;
  inactiveDrivers: number;
}

const COLORS = {
  FORMÉ: "#059669", // Emerald-600
  "À FORMER": "#d97706", // Amber-600
  "NON FORMÉ": "#dc2626", // Red-600
};

export function CPCStatusChart() {
  const { data: stats, isLoading } = useQuery<CPCStatistics>({
    queryKey: ["/api/drivers/cpc-statistics"],
  });

  if (isLoading) {
    return <Skeleton className="h-[280px] w-full rounded-2xl" />;
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="h-[280px] flex flex-col items-center justify-center text-muted-foreground gap-2">
        <GraduationCap className="h-8 w-8 text-slate-300 dark:text-slate-600" />
        <p className="text-xs font-medium">Aucun chauffeur enregistré pour les certifications CPC</p>
      </div>
    );
  }

  const chartData = [
    { name: "FORMÉ", label: "Certifié & À jour", value: stats.forme, color: COLORS.FORMÉ },
    { name: "À FORMER", label: "À recycler / échéance", value: stats.aFormer, color: COLORS["À FORMER"] },
    { name: "NON FORMÉ", label: "Non certifié", value: stats.nonForme, color: COLORS["NON FORMÉ"] },
  ].filter((item) => item.value > 0);

  const compliancePercent = stats.total > 0 ? ((stats.forme / stats.total) * 100).toFixed(0) : "0";

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const percentage = ((data.value / stats.total) * 100).toFixed(1);
      return (
        <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-md">
          <p className="font-bold text-xs text-foreground">{data.label}</p>
          <p className="text-xs font-semibold text-foreground mt-0.5">
            <span className="tabular-nums">{data.value}</span> chauffeur(s)
          </p>
          <p className="text-[11px] text-muted-foreground">{percentage}% du parc chauffeurs</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full space-y-4" data-testid="chart-cpc-status">
      <div className="relative h-[200px] w-full flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData.length > 0 ? chartData : [{ name: "VIDE", value: 1, color: "#e2e8f0" }]}
              cx="50%"
              cy="50%"
              innerRadius={62}
              outerRadius={88}
              paddingAngle={chartData.length > 1 ? 3 : 0}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>

        {/* Jauge Centrale de Conformité */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-black tracking-tight text-foreground tabular-nums">
            {compliancePercent}%
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            Conforme
          </span>
        </div>
      </div>

      {/* Résumé des 3 Piliers de Statut */}
      <div className="grid grid-cols-3 gap-2.5 text-center pt-1">
        <div className="p-3 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/60">
          <div className="flex items-center justify-center gap-1 text-emerald-700 dark:text-emerald-300 mb-0.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-xs font-bold">Formés</span>
          </div>
          <p className="text-xl font-black text-emerald-700 dark:text-emerald-400 tabular-nums">
            {stats.forme}
          </p>
          <span className="text-[10px] text-muted-foreground">
            {((stats.forme / stats.total) * 100).toFixed(0)}%
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/60">
          <div className="flex items-center justify-center gap-1 text-amber-700 dark:text-amber-300 mb-0.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span className="text-xs font-bold">À Recycler</span>
          </div>
          <p className="text-xl font-black text-amber-700 dark:text-amber-400 tabular-nums">
            {stats.aFormer}
          </p>
          <span className="text-[10px] text-muted-foreground">
            {((stats.aFormer / stats.total) * 100).toFixed(0)}%
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200/60">
          <div className="flex items-center justify-center gap-1 text-rose-700 dark:text-rose-300 mb-0.5">
            <XCircle className="h-3.5 w-3.5" />
            <span className="text-xs font-bold">Non Formés</span>
          </div>
          <p className="text-xl font-black text-rose-700 dark:text-rose-400 tabular-nums">
            {stats.nonForme}
          </p>
          <span className="text-[10px] text-muted-foreground">
            {((stats.nonForme / stats.total) * 100).toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}
