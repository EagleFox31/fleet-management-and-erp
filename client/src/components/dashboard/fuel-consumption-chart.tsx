import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

export function FuelConsumptionChart() {
  const year = new Date().getFullYear();

  const { data: history, isLoading } = useQuery<any[]>({
    queryKey: ["/api/fuel-card/history", year],
    queryFn: async () => {
      const res = await fetch(`/api/fuel-card/history?year=${year}`);
      return res.json();
    },
  });

  const chartData = MONTHS.map((name, idx) => {
    const month = idx + 1;
    const records = (Array.isArray(history) ? history : []).filter((r: any) => {
      const debit = parseFloat(r.debitAmount ?? r.debit_amount ?? 0);
      if (debit <= 0) return false;
      const recordMonth = r.month ?? (r.date ? new Date(r.date).getMonth() + 1 : null);
      return recordMonth === month;
    });
    const litres = records.reduce((sum: number, r: any) => sum + (parseFloat(r.quantity || r.liters || 0)), 0);
    return { name, litres: Math.round(litres) };
  });

  const hasData = chartData.some(d => d.litres > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Consommation Carburant {year}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : hasData ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v > 0 ? `${v}L` : '0'}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: any) => [`${value} L`, 'Litres consommés']}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line
                type="monotone"
                dataKey="litres"
                name="Litres"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3, fill: '#22c55e' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
            Aucune donnée pour {year}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
