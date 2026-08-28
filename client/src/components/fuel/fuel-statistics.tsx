import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/utils";
import { Fuel, BarChart3, LineChart } from "lucide-react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart as RechartsLineChart,
  Line,
  Legend
} from "recharts";

interface ConsumptionData {
  date: string;
  quantity: number;
  cost: number;
  count: number;
}

export function FuelStatistics() {
  const [period, setPeriod] = useState<string>("month");

  const { data: fuelStatistics, isLoading: isLoadingStats } = useQuery<any>({
    queryKey: ["/api/fuel-records/statistics", { period }],
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchInterval: 30000,
  });

  const { data: consumptionHistory, isLoading: isLoadingHistory } = useQuery<any>({
    queryKey: ["/api/fuel-records/consumption-history", { period }],
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchInterval: 30000,
  });

  // Formater les données pour les graphiques
  const chartData = consumptionHistory?.map((item: ConsumptionData) => ({
    ...item,
    date: formatDate(item.date, period),
    quantityAvg: item.quantity / item.count, // Quantité moyenne par plein
    costAvg: item.cost / item.count, // Coût moyen par plein
  })) || [];

  // Fonction pour formater les dates selon la période
  function formatDate(dateStr: string, period: string) {
    const date = new Date(dateStr);

    switch (period) {
      case 'week':
      case 'month':
        return `${date.getDate()}/${date.getMonth() + 1}`;
      case 'quarter':
      case 'year':
        return `${date.getMonth() + 1}/${date.getFullYear()}`;
      default:
        return dateStr;
    }
  }

  // Fonction pour formater les nombres avec des espaces comme séparateurs de milliers
  function formatNumber(num: number) {
    return num.toLocaleString('fr-FR');
  }

  // Calculer le coût moyen par litre
  const totalFuel = fuelStatistics?.totalFuel ? parseFloat(fuelStatistics.totalFuel) : 0;
  const totalCost = fuelStatistics?.totalCost ? parseFloat(fuelStatistics.totalCost) : 0;
  const avgCostPerLiter = totalFuel > 0 ? totalCost / totalFuel : 0;

  // Trouver les véhicules avec la meilleure et la pire consommation
  const sortedVehicles = fuelStatistics?.vehicleStats?.slice() || [];
  sortedVehicles.sort((a, b) => a.avgConsumption - b.avgConsumption);

  const bestVehicle = sortedVehicles.length > 0 && sortedVehicles[0].avgConsumption > 0 
    ? sortedVehicles[0] 
    : null;

  const worstVehicle = sortedVehicles.length > 0 && sortedVehicles[sortedVehicles.length - 1].avgConsumption > 0 
    ? sortedVehicles[sortedVehicles.length - 1] 
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Statistiques de consommation</CardTitle>

          <Tabs defaultValue={period} className="w-[300px]" onValueChange={setPeriod}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="week">Semaine</TabsTrigger>
              <TabsTrigger value="month">Mois</TabsTrigger>
              <TabsTrigger value="quarter">Trimestre</TabsTrigger>
              <TabsTrigger value="year">Année</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent>
        {(isLoadingStats || isLoadingHistory) ? (
          <div className="flex items-center justify-center h-64">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-card border rounded-lg p-4 flex flex-col items-center justify-center text-center">
                <Fuel className="h-6 w-6 mb-2 text-primary" />
                <div className="text-sm text-muted-foreground mb-1">Total carburant</div>
                <div className="text-2xl font-bold">
                  {totalFuel > 0
                    ? `${totalFuel.toFixed(2)} L` 
                    : "0 L"}
                </div>
              </div>

              <div className="bg-card border rounded-lg p-4 flex flex-col items-center justify-center text-center">
                <div className="h-6 w-6 mb-2 flex items-center justify-center text-primary">F</div>
                <div className="text-sm text-muted-foreground mb-1">Coût total</div>
                <div className="text-2xl font-bold">
                  {totalCost > 0
                    ? formatCurrency(totalCost) 
                    : formatCurrency(0)}
                </div>
              </div>

              <div className="bg-card border rounded-lg p-4 flex flex-col items-center justify-center text-center">
                <BarChart3 className="h-6 w-6 mb-2 text-primary" />
                <div className="text-sm text-muted-foreground mb-1">Prix moyen/L</div>
                <div className="text-2xl font-bold">
                  {avgCostPerLiter > 0 
                    ? formatCurrency(avgCostPerLiter)
                    : "N/A"}
                </div>
              </div>

              <div className="bg-card border rounded-lg p-4 flex flex-col items-center justify-center text-center">
                <LineChart className="h-6 w-6 mb-2 text-primary" />
                <div className="text-sm text-muted-foreground mb-1">Nb de pleins</div>
                <div className="text-2xl font-bold">
                  {consumptionHistory?.reduce((total: number, current: ConsumptionData) => total + current.count, 0) || 0}
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium mb-3">Évolution des coûts</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                    <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                    <Tooltip 
                      formatter={(value: number, name: string) => [
                        `${formatNumber(value)} ${name === 'Coût total' ? 'F CFA' : 'L'}`, 
                        name
                      ]} 
                    />
                    <Bar yAxisId="left" dataKey="cost" name="Coût total" fill="#8884d8" />
                    <Bar yAxisId="right" dataKey="quantity" name="Litres" fill="#82ca9d" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-sm font-medium mb-3">Moyennes par plein</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                    <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                    <Tooltip 
                      formatter={(value: number, name: string) => [
                        name === 'Coût moyen/plein' 
                          ? `${formatNumber(value)} F CFA` 
                          : `${value.toFixed(2)} L`, 
                        name
                      ]} 
                    />
                    <Legend />
                    <Line 
                      yAxisId="left" 
                      type="monotone" 
                      dataKey="costAvg" 
                      name="Coût moyen/plein" 
                      stroke="#8884d8" 
                      activeDot={{ r: 8 }} 
                    />
                    <Line 
                      yAxisId="right" 
                      type="monotone" 
                      dataKey="quantityAvg" 
                      name="Quantité moyenne/plein" 
                      stroke="#82ca9d" 
                    />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {bestVehicle && (
                <div className="bg-card border rounded-lg p-4">
                  <h3 className="text-sm font-medium mb-2">Meilleure consommation</h3>
                  <div className="flex items-center">
                    <div className="bg-green-100 p-2 rounded-full mr-4">
                      <Fuel className="h-5 w-5 text-green-500" />
                    </div>
                    <div>
                      <div className="font-medium">{bestVehicle.registrationNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {bestVehicle.brand} {bestVehicle.model}
                      </div>
                      <div className="text-sm font-medium text-green-600 mt-1">
                        {bestVehicle.avgConsumption.toFixed(2)} L/100km
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {worstVehicle && (
                <div className="bg-card border rounded-lg p-4">
                  <h3 className="text-sm font-medium mb-2">Consommation la plus élevée</h3>
                  <div className="flex items-center">
                    <div className="bg-red-100 p-2 rounded-full mr-4">
                      <Fuel className="h-5 w-5 text-red-500" />
                    </div>
                    <div>
                      <div className="font-medium">{worstVehicle.registrationNumber}</div>
                      <div className="text-sm text-muted-foreground">
                        {worstVehicle.brand} {worstVehicle.model}
                      </div>
                      <div className="text-sm font-medium text-red-600 mt-1">
                        {worstVehicle.avgConsumption.toFixed(2)} L/100km
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}