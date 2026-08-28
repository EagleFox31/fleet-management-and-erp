import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

const COLORS = ['#22c55e', '#f59e0b', '#ef4444'];

interface VehicleStatusPieChartProps {
  data?: { operational?: number; maintenance?: number; outOfService?: number };
  isLoading?: boolean;
}

export function VehicleStatusPieChart({ data, isLoading }: VehicleStatusPieChartProps) {
  const chartData = [
    { name: 'Opérationnel', value: parseInt(data?.operational as any) || 0 },
    { name: 'En maintenance', value: parseInt(data?.maintenance as any) || 0 },
    { name: 'Hors service', value: parseInt(data?.outOfService as any) || 0 },
  ].filter(d => d.value > 0);

  const total = chartData.reduce((sum, d) => sum + d.value, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Statut de la Flotte</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[250px] w-full" />
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="45%"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={4}
                dataKey="value"
              >
                {chartData.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <text x="50%" y="43%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground">
                <tspan x="50%" dy="-8" fontSize="22" fontWeight="700" fill="hsl(var(--foreground))">{total}</tspan>
                <tspan x="50%" dy="18" fontSize="11" fill="hsl(var(--muted-foreground))">véhicules</tspan>
              </text>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: any) => [`${value} véhicule(s)`, '']}
              />
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
            </PieChart>
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
