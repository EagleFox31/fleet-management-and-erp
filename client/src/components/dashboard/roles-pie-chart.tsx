import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface User {
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  admin:            'Admin',
  workshop_manager: 'Chef atelier',
  technician:       'Technicien',
  secretary:        'Secrétaire',
  logistics:        'Logisticien',
  warehouse:        'Magasinier',
  client:           'Client',
  user:             'Utilisateur',
};

const ROLE_COLORS: Record<string, string> = {
  admin:            '#ef4444',
  workshop_manager: '#3b82f6',
  technician:       '#f97316',
  secretary:        '#a855f7',
  logistics:        '#06b6d4',
  warehouse:        '#22c55e',
  client:           '#6366f1',
  user:             '#94a3b8',
};

interface RolesPieChartProps {
  users: User[];
  isLoading: boolean;
}

export function RolesPieChart({ users, isLoading }: RolesPieChartProps) {
  const roleCounts = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  const chartData = Object.entries(roleCounts)
    .map(([role, count]) => ({
      name: ROLE_LABELS[role] || role,
      value: count,
      color: ROLE_COLORS[role] || '#94a3b8',
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Répartition des rôles</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="45%"
                innerRadius={45}
                outerRadius={70}
                paddingAngle={3}
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <text x="50%" y="43%" textAnchor="middle" dominantBaseline="middle">
                <tspan x="50%" dy="-6" fontSize="20" fontWeight="700" fill="hsl(var(--foreground))">
                  {users.length}
                </tspan>
                <tspan x="50%" dy="16" fontSize="11" fill="hsl(var(--muted-foreground))">
                  users
                </tspan>
              </text>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                formatter={(value: any) => [`${value} utilisateur${value > 1 ? 's' : ''}`, '']}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                formatter={(value) => value}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">
            Aucun utilisateur
          </div>
        )}
      </CardContent>
    </Card>
  );
}
