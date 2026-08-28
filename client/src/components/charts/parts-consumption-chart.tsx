import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface PartsConsumption {
  partName: string;
  quantity: number;
  totalValue: number;
}

export function PartsConsumptionChart() {
  const { data: consumption, isLoading } = useQuery<PartsConsumption[]>({
    queryKey: ["/api/warehouse/top-consumed-parts"],
    queryFn: async () => {
      const response = await fetch('/api/warehouse/top-consumed-parts', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        console.error('Failed to fetch parts consumption:', response.status);
        throw new Error('Failed to fetch');
      }
      return response.json();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-[350px] w-full" />;
  }

  if (!consumption || consumption.length === 0) {
    return (
      <div className="h-[350px] flex items-center justify-center text-gray-500">
        Aucune donnée de consommation disponible
      </div>
    );
  }

  const chartData = consumption.slice(0, 10).map(item => ({
    name: item.partName.length > 20 ? item.partName.substring(0, 20) + '...' : item.partName,
    fullName: item.partName,
    quantité: item.quantity,
    valeur: Math.round(item.totalValue / 1000)
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-4 border rounded-lg shadow-lg">
          <p className="font-semibold mb-2">{data.fullName}</p>
          <p className="text-sm text-blue-600">
            Quantité: <span className="font-bold">{data.quantité}</span> unités
          </p>
          <p className="text-sm text-green-600">
            Valeur: <span className="font-bold">{data.valeur}K</span> FCFA
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full" data-testid="chart-parts-consumption">
      <ResponsiveContainer width="100%" height={350}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="name" 
            angle={-45}
            textAnchor="end"
            height={100}
            tick={{ fontSize: 11 }}
          />
          <YAxis 
            yAxisId="left"
            label={{ value: 'Quantité', angle: -90, position: 'insideLeft' }}
          />
          <YAxis 
            yAxisId="right"
            orientation="right"
            label={{ value: 'Valeur (K FCFA)', angle: 90, position: 'insideRight' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            verticalAlign="top"
            wrapperStyle={{ paddingBottom: '20px' }}
          />
          <Bar 
            yAxisId="left"
            dataKey="quantité" 
            fill="#3b82f6" 
            name="Quantité consommée"
            radius={[8, 8, 0, 0]}
          />
          <Bar 
            yAxisId="right"
            dataKey="valeur" 
            fill="#10b981" 
            name="Valeur (K FCFA)"
            radius={[8, 8, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
