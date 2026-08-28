import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface FuelConsumption {
  date: string;
  totalLiters: number;
  totalAmount: number;
  transactionCount: number;
}

export function FuelConsumptionChart() {
  const { data: consumption, isLoading } = useQuery<FuelConsumption[]>({
    queryKey: ["/api/fuel-card/consumption-history"],
  });

  if (isLoading) {
    return <Skeleton className="h-[350px] w-full" />;
  }

  if (!consumption || consumption.length === 0) {
    return (
      <div className="h-[350px] flex items-center justify-center text-gray-500">
        Aucune donnée de consommation carburant disponible
      </div>
    );
  }

  const chartData = consumption.map(item => ({
    date: new Date(item.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
    fullDate: new Date(item.date).toLocaleDateString('fr-FR'),
    litres: Math.round(item.totalLiters),
    montant: Math.round(item.totalAmount / 1000),
    transactions: item.transactionCount
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-4 border rounded-lg shadow-lg">
          <p className="font-semibold mb-2">{data.fullDate}</p>
          <p className="text-sm text-blue-600">
            Litres: <span className="font-bold">{data.litres}L</span>
          </p>
          <p className="text-sm text-green-600">
            Montant: <span className="font-bold">{data.montant}K</span> FCFA
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Transactions: <span className="font-bold">{data.transactions}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full" data-testid="chart-fuel-consumption">
      <ResponsiveContainer width="100%" height={350}>
        <LineChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="date"
            tick={{ fontSize: 12 }}
          />
          <YAxis 
            yAxisId="left"
            label={{ value: 'Litres', angle: -90, position: 'insideLeft' }}
          />
          <YAxis 
            yAxisId="right"
            orientation="right"
            label={{ value: 'Montant (K FCFA)', angle: 90, position: 'insideRight' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Line 
            yAxisId="left"
            type="monotone" 
            dataKey="litres" 
            stroke="#3b82f6" 
            strokeWidth={3}
            name="Litres consommés"
            dot={{ fill: '#3b82f6', r: 5 }}
            activeDot={{ r: 8 }}
          />
          <Line 
            yAxisId="right"
            type="monotone" 
            dataKey="montant" 
            stroke="#10b981" 
            strokeWidth={3}
            name="Montant (K FCFA)"
            dot={{ fill: '#10b981', r: 5 }}
            activeDot={{ r: 8 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
