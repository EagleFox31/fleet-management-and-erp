import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

interface FleetStatusChartProps {
  data?: any[];
  title?: string;
  className?: string;
  period?: "week" | "month" | "quarter" | "year";
}

export function FleetStatusChart({ data: initialData = [], title = "Statut de la flotte", className, period: externalPeriod }: FleetStatusChartProps) {
  const [period, setPeriod] = useState<"week" | "month" | "quarter" | "year">(externalPeriod || "week");
  
  // Récupération des données historiques
  const { data = initialData, isLoading } = useQuery<any>({
    queryKey: ["/api/statistics/fleet-history", period],
    queryFn: async () => {
      const response = await fetch(`/api/statistics/fleet-history?period=${period}`);
      const result = await response.json();
      console.log(`=== FRONTEND DEBUG ===`);
      console.log(`Période demandée: ${period}`);
      console.log(`Données reçues:`, result);
      console.log(`Nombre d'éléments:`, result?.length || 0);
      console.log(`=== END FRONTEND DEBUG ===`);
      return result;
    },
    enabled: !!period,
  });
  
  const handlePeriodChange = (newPeriod: "week" | "month" | "quarter" | "year") => {
    setPeriod(newPeriod);
  };
  
  return (
    <Card className={cn(className)}>
      <CardHeader className="px-6 pb-0">
        <div className="flex items-center justify-between mb-4">
          <CardTitle className="text-lg font-semibold">{title}</CardTitle>
          <div className="flex space-x-2 text-sm">
            <Button
              size="sm"
              variant={period === "week" ? "default" : "ghost"}
              onClick={() => handlePeriodChange("week")}
            >
              Semaine
            </Button>
            <Button
              size="sm"
              variant={period === "month" ? "default" : "ghost"}
              onClick={() => handlePeriodChange("month")}
            >
              Mois
            </Button>
            <Button
              size="sm"
              variant={period === "quarter" ? "default" : "ghost"}
              onClick={() => handlePeriodChange("quarter")}
            >
              Trimestre
            </Button>
            <Button
              size="sm"
              variant={period === "year" ? "default" : "ghost"}
              onClick={() => handlePeriodChange("year")}
            >
              Année
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        {isLoading ? (
          <div className="h-[300px] w-full flex items-center justify-center">
            <div className="text-center text-muted-foreground">Chargement des données...</div>
          </div>
        ) : data && data.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis 
                dataKey="date" 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                domain={[0, 'dataMax + 1']}
              />
              <Tooltip 
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px'
                }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
              />
              <Legend 
                wrapperStyle={{ fontSize: '12px', paddingTop: '20px' }}
              />
              <Bar 
                name="Opérationnel" 
                dataKey="operational" 
                stackId="a" 
                fill="#22c55e" 
                radius={[0, 0, 0, 0]}
              />
              <Bar 
                name="En maintenance" 
                dataKey="maintenance" 
                stackId="a" 
                fill="#f59e0b" 
                radius={[0, 0, 0, 0]}
              />
              <Bar 
                name="Hors service" 
                dataKey="outOfService" 
                stackId="a" 
                fill="#ef4444" 
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[300px] w-full flex items-center justify-center bg-muted/30 rounded-lg">
            <div className="text-center">
              <div className="text-muted-foreground text-sm">Graphique: Évolution du statut de la flotte</div>
              <div className="mt-2 flex justify-center space-x-4">
                <div className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-primary mr-2"></div>
                  <span className="text-xs text-muted-foreground">Opérationnel</span>
                </div>
                <div className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-warning mr-2"></div>
                  <span className="text-xs text-muted-foreground">En maintenance</span>
                </div>
                <div className="flex items-center">
                  <div className="w-3 h-3 rounded-full bg-destructive mr-2"></div>
                  <span className="text-xs text-muted-foreground">Hors service</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
