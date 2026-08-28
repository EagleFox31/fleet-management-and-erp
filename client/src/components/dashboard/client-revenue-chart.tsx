import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPrice } from "@/lib/utils";

const CLIENT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'];

export function ClientRevenueChart() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/billing/statistics"],
    queryFn: async () => {
      const res = await fetch("/api/billing/statistics");
      return res.json();
    },
  });

  const raw = Array.isArray(data) ? data : (data?.byClient || data?.clients || []);

  const chartData = raw.map((c: any) => ({
    name: c.clientName || c.name || 'Inconnu',
    montant: parseFloat(c.totalAmountTTC || c.totalAmount || c.total || c.amount || 0),
    factures: c.totalInvoices || c.invoiceCount || c.count || 0,
  })).filter((c: any) => c.montant > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Chiffre d'Affaires par Client</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
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
                tickFormatter={(v) => v >= 1000000 ? `${(v / 1000000).toFixed(0)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: any, name: string) => [
                  name === 'montant' ? formatPrice(value) : `${value} factures`,
                  name === 'montant' ? 'CA Total' : 'Factures',
                ]}
              />
              <Bar dataKey="montant" name="montant" radius={[4, 4, 0, 0]}>
                {chartData.map((_: any, index: number) => (
                  <Cell key={index} fill={CLIENT_COLORS[index % CLIENT_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[250px] flex items-center justify-center text-muted-foreground text-sm">
            Aucune donnée de facturation disponible
          </div>
        )}
      </CardContent>
    </Card>
  );
}
