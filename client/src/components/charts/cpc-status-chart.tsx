import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface CPCStatistics {
  total: number;
  forme: number;
  aFormer: number;
  nonForme: number;
  inactiveDrivers: number;
}

const COLORS = {
  FORMÉ: "#10b981", // Green
  "À FORMER": "#f59e0b", // Orange
  "NON FORMÉ": "#ef4444", // Red
};

export function CPCStatusChart() {
  const { data: stats, isLoading } = useQuery<CPCStatistics>({
    queryKey: ["/api/drivers/cpc-statistics"],
  });

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full" />;
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        Aucun chauffeur disponible
      </div>
    );
  }

  const chartData = [
    { name: "FORMÉ", value: stats.forme, color: COLORS.FORMÉ },
    { name: "À FORMER", value: stats.aFormer, color: COLORS["À FORMER"] },
    { name: "NON FORMÉ", value: stats.nonForme, color: COLORS["NON FORMÉ"] },
  ].filter(item => item.value > 0); // Only show non-zero values

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const percentage = ((data.value / stats.total) * 100).toFixed(1);
      return (
        <div className="bg-white dark:bg-gray-800 p-4 border rounded-lg shadow-lg">
          <p className="font-semibold mb-1">{data.name}</p>
          <p className="text-sm">
            <span className="font-bold">{data.value}</span> chauffeur(s)
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {percentage}% du total
          </p>
        </div>
      );
    }
    return null;
  };

  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent < 0.05) return null; // Don't show label if too small

    return (
      <text
        x={x}
        y={y}
        fill="white"
        textAnchor={x > cx ? 'start' : 'end'}
        dominantBaseline="central"
        className="text-sm font-bold"
      >
        {`${(percent * 100).toFixed(0)}%`}
      </text>
    );
  };

  return (
    <div className="w-full" data-testid="chart-cpc-status">
      <ResponsiveContainer width="100%" height={300}>
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={renderCustomizedLabel}
            outerRadius={100}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            verticalAlign="bottom" 
            height={36}
            iconType="square"
          />
        </PieChart>
      </ResponsiveContainer>
      
      {/* Statistiques résumées */}
      <div className="mt-6 grid grid-cols-3 gap-4 text-center">
        <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {stats.forme}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Formés</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {((stats.forme / stats.total) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="p-3 bg-orange-50 dark:bg-orange-950 rounded-lg">
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
            {stats.aFormer}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">À Former</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {((stats.aFormer / stats.total) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {stats.nonForme}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Non Formés</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {((stats.nonForme / stats.total) * 100).toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}
