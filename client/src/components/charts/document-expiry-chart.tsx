import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface DocumentStats {
  total: number;
  withCarteGrise: number;
  expiringCarteGrise: number;
  expiredCarteGrise: number;
  validCarteGrise: number;
  withAssurance: number;
  expiringAssurance: number;
  expiredAssurance: number;
  validAssurance: number;
  withVisiteTechnique: number;
  expiringVisiteTechnique: number;
  expiredVisiteTechnique: number;
  validVisiteTechnique: number;
}

export function DocumentExpiryChart() {
  const { data: stats, isLoading } = useQuery<DocumentStats>({
    queryKey: ["/api/vehicles/document-stats"],
  });

  if (isLoading) {
    return <Skeleton className="h-[300px] w-full" />;
  }

  if (!stats) {
    return (
      <div className="h-[300px] flex items-center justify-center text-gray-500">
        Aucune donnée disponible
      </div>
    );
  }

  const chartData = [
    {
      name: "Carte Grise",
      valides: stats.validCarteGrise,
      expirantBientot: stats.expiringCarteGrise,
      expires: stats.expiredCarteGrise,
    },
    {
      name: "Assurance",
      valides: stats.validAssurance,
      expirantBientot: stats.expiringAssurance,
      expires: stats.expiredAssurance,
    },
    {
      name: "Visite Technique",
      valides: stats.validVisiteTechnique,
      expirantBientot: stats.expiringVisiteTechnique,
      expires: stats.expiredVisiteTechnique,
    },
  ];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white dark:bg-gray-800 p-4 border rounded-lg shadow-lg">
          <p className="font-semibold mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: <span className="font-bold">{entry.value}</span>
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full" data-testid="chart-document-expiry">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
          <XAxis 
            dataKey="name" 
            className="text-sm"
            tick={{ fill: 'currentColor' }}
          />
          <YAxis 
            className="text-sm"
            tick={{ fill: 'currentColor' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="square"
          />
          <Bar 
            dataKey="valides" 
            fill="#10b981" 
            name="Valides" 
            radius={[4, 4, 0, 0]}
            data-testid="bar-valides"
          />
          <Bar 
            dataKey="expirantBientot" 
            fill="#f59e0b" 
            name="Expirant bientôt" 
            radius={[4, 4, 0, 0]}
            data-testid="bar-expiring"
          />
          <Bar 
            dataKey="expires" 
            fill="#ef4444" 
            name="Expirés" 
            radius={[4, 4, 0, 0]}
            data-testid="bar-expired"
          />
        </BarChart>
      </ResponsiveContainer>
      
      {/* Statistiques résumées */}
      <div className="mt-6 grid grid-cols-3 gap-4 text-center">
        <div className="p-3 bg-green-50 dark:bg-green-950 rounded-lg">
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">
            {stats.validCarteGrise + stats.validAssurance + stats.validVisiteTechnique}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Documents valides</p>
        </div>
        <div className="p-3 bg-orange-50 dark:bg-orange-950 rounded-lg">
          <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
            {stats.expiringCarteGrise + stats.expiringAssurance + stats.expiringVisiteTechnique}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">À renouveler bientôt</p>
        </div>
        <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg">
          <p className="text-2xl font-bold text-red-600 dark:text-red-400">
            {stats.expiredCarteGrise + stats.expiredAssurance + stats.expiredVisiteTechnique}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">Documents expirés</p>
        </div>
      </div>
    </div>
  );
}
