import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/utils";

interface StockValueHistory {
  date: string;
  totalValue: number;
  itemCount: number;
}

export function StockValueChart() {
  const { data: history, isLoading } = useQuery<StockValueHistory[]>({
    queryKey: ["/api/warehouse/stock-value-history"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    queryFn: async () => {
      const response = await fetch('/api/warehouse/stock-value-history', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        console.error('Failed to fetch stock value history:', response.status);
        throw new Error('Failed to fetch');
      }
      return response.json();
    },
  });

  if (isLoading) {
    return <Skeleton className="h-[350px] w-full" />;
  }

  if (!history || history.length === 0) {
    return (
      <div className="h-[350px] flex items-center justify-center text-gray-500">
        Aucun historique de valeur de stock disponible
      </div>
    );
  }

  const maxValue = Math.max(...history.map((item) => Number(item.totalValue || 0)), 0);
  const divisor = maxValue >= 1_000_000 ? 1_000_000 : maxValue >= 1_000 ? 1_000 : 1;
  const unitLabel = divisor === 1_000_000 ? "M FCFA" : divisor === 1_000 ? "K FCFA" : "FCFA";

  const formatScaledValue = (value: number) => {
    if (divisor === 1_000_000) return value.toFixed(2);
    if (divisor === 1_000) return value.toFixed(1);
    return Math.round(value).toString();
  };

  const parseDateOnly = (dateValue: string) => {
    const [year, month, day] = dateValue.split("-").map((item) => Number(item));
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      year > 1900 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return new Date(year, month - 1, day, 12, 0, 0);
    }
    const fallback = new Date(dateValue);
    return Number.isNaN(fallback.getTime()) ? new Date() : fallback;
  };

  const chartData = history.map(item => ({
    date: parseDateOnly(item.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
    fullDate: parseDateOnly(item.date).toLocaleDateString('fr-FR'),
    valeur: Number(item.totalValue || 0) / divisor,
    valeurBrute: Number(item.totalValue || 0),
    articles: item.itemCount
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white dark:bg-gray-800 p-4 border rounded-lg shadow-lg">
          <p className="font-semibold mb-2">{data.fullDate}</p>
          <p className="text-sm text-blue-600">
            Valeur: <span className="font-bold">{formatScaledValue(data.valeur)} {unitLabel}</span>
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Exact: <span className="font-bold">{formatPrice(Math.round(data.valeurBrute))}</span>
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Articles: <span className="font-bold">{data.articles}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full" data-testid="chart-stock-value">
      <ResponsiveContainer width="100%" height={350}>
        <LineChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis 
            dataKey="date"
            tick={{ fontSize: 12 }}
            interval="preserveStartEnd"
          />
          <YAxis 
            label={{ value: `Valeur (${unitLabel})`, angle: -90, position: 'insideLeft' }}
            tickFormatter={(value: number) => formatScaledValue(Number(value))}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <Line 
            type="monotone" 
            dataKey="valeur" 
            stroke="#3b82f6" 
            strokeWidth={3}
            name={`Valeur Stock (${unitLabel})`}
            dot={{ fill: '#3b82f6', r: 5 }}
            activeDot={{ r: 8 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
