import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

export function TopPartsChart() {
  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["/api/warehouse/top-consumed-parts"],
    queryFn: async () => {
      const res = await fetch("/api/warehouse/top-consumed-parts?limit=8");
      return res.json();
    },
  });

  const chartData = (Array.isArray(data) ? data : []).map((p: any) => ({
    name: (p.name || p.partName || '')?.length > 14
      ? (p.name || p.partName || '').substring(0, 14) + '…'
      : (p.name || p.partName || ''),
    fullName: p.name || p.partName || '',
    quantité: p.totalConsumed || p.consumed || p.quantity || 0,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Top Pièces Consommées</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                axisLine={false}
                tickLine={false}
                width={90}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: any) => [`${value} unités`, 'Consommé']}
                labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.fullName || ''}
              />
              <Bar dataKey="quantité" fill="#22c55e" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
            Aucune donnée disponible
          </div>
        )}
      </CardContent>
    </Card>
  );
}
