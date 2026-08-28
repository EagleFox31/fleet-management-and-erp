import { useQuery } from "@tanstack/react-query";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface VehicleStats {
  operational: string;
  maintenance: string;
  outOfService: string;
  total: string;
}

const STATUS_COLORS = {
  Opérationnel: "#10b981",
  Maintenance: "#f59e0b",
  "Hors Service": "#ef4444",
};

export function VehicleStatusChart() {
  const { data: stats, isLoading } = useQuery<VehicleStats>({
    queryKey: ["/api/statistics/fleet"],
  });

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full" />;
  }

  if (!stats) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        Aucune donnée de flotte disponible
      </div>
    );
  }

  const operational = parseInt(stats.operational) || 0;
  const maintenance = parseInt(stats.maintenance) || 0;
  const outOfService = parseInt(stats.outOfService) || 0;
  const total = operational + maintenance + outOfService;

  if (total === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        Aucun véhicule disponible
      </div>
    );
  }

  const chartData = [
    { name: "Opérationnel", value: operational, color: STATUS_COLORS.Opérationnel },
    { name: "Maintenance", value: maintenance, color: STATUS_COLORS.Maintenance },
    { name: "Hors Service", value: outOfService, color: STATUS_COLORS["Hors Service"] },
  ].filter(item => item.value > 0);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0];
      const percentage = ((data.value / total) * 100).toFixed(1);
      return (
        <div className="bg-white dark:bg-gray-800 p-4 border rounded-lg shadow-lg">
          <p className="font-semibold mb-1">{data.name}</p>
          <p className="text-sm">
            <span className="font-bold">{data.value}</span> véhicule(s)
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {percentage}% de la flotte
          </p>
        </div>
      );
    }
    return null;
  };

  const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) => {
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);

    if (percent < 0.05) return null;

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
    <div className="w-full" data-testid="chart-vehicle-status">
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
      
      <div className="mt-6 grid grid-cols-3 gap-4 text-center">
        <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {operational}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Opérationnels</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {((operational / total) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="p-3 bg-orange-50 dark:bg-orange-950 rounded-lg">
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
            {maintenance}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Maintenance</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {((maintenance / total) * 100).toFixed(1)}%
          </p>
        </div>
        <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {outOfService}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Hors Service</p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {((outOfService / total) * 100).toFixed(1)}%
          </p>
        </div>
      </div>
    </div>
  );
}
