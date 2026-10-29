import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { 
  Truck, 
  Wrench, 
  CheckCircle, 
  AlertTriangle, 
  Clock,
  Calendar,
  TrendingUp,
  Users,
  Package,
  Fuel,
  Euro,
  BarChart3,
  Activity,
  Bell,
  Wifi,
  WifiOff,
  RefreshCw
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { useRealTimeSync } from "@/hooks/useRealTimeSync";
import { useAuth } from "@/hooks/useAuth";
import { isApiError } from "@/lib/api-error";

export default function FleetTechnicianPWA() {
  const [isOnline, setIsOnline] = useState(navigator.onLine !== false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Système WebSocket temps réel avec ID utilisateur dynamique
  const { user } = useAuth();
  const { isConnected, lastUpdate, forceSync } = useRealTimeSync(user?.id);

  // Gestion du statut de connexion et rafraîchissement automatique
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Source de données unifiée - même API que "Mes Ordres de Travail"
  const { data: technicianData, isLoading: dataLoading, refetch: refetchData, error: dataError } = useQuery<any>({
    queryKey: ['/api/technician/work-orders', user?.id],
    queryFn: async () => {
      const response = await fetch(`/api/technician/work-orders/${user?.id}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response.json();
    },
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
    retry: isOnline ? 3 : 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true
  });

  // Données supplémentaires nécessaires pour le dashboard
  const { data: vehicles, isLoading: vehiclesLoading, refetch: refetchVehicles } = useQuery<any>({
    queryKey: ['/api/vehicles'],
    staleTime: 0,
    gcTime: 0,
    retry: isOnline ? 3 : 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true
  });

  const { data: maintenanceSchedules, isLoading: maintenanceLoading, refetch: refetchMaintenance } = useQuery<any>({
    queryKey: ['/api/maintenance-schedules'],
    staleTime: 0,
    gcTime: 0,
    retry: isOnline ? 3 : 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true
  });

  const { data: parts, isLoading: partsLoading } = useQuery<any>({
    queryKey: ['/api/parts'],
    staleTime: 0,
    gcTime: 0,
    retry: isOnline ? 3 : 0,
    refetchOnWindowFocus: true
  });

  const { data: fuelRecords, isLoading: fuelLoading } = useQuery<any>({
    queryKey: ['/api/fuel-records'],
    staleTime: 0,
    gcTime: 0,
    retry: isOnline ? 3 : 0,
    refetchOnWindowFocus: true
  });

  // Fonction de rafraîchissement manuel 
  const handleRefresh = async () => {
    if (!isOnline) return;

    await Promise.all([
      refetchData(),
      refetchVehicles(),
      refetchMaintenance()
    ]);
    forceSync();
  };

  // Gestion des erreurs d'authentification
  if (isApiError(dataError, 401)) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-4">
        <AlertTriangle className="h-12 w-12 text-orange-600 mb-4" />
        <div className="text-lg font-medium text-center">Authentification requise</div>
        <div className="text-sm text-muted-foreground mt-2 text-center">
          Veuillez vous connecter pour accéder à l'état de la flotte
        </div>
        <Button 
          onClick={() => window.location.href = '/login'} 
          className="mt-4"
        >
          Se connecter
        </Button>
      </div>
    );
  }

  if (dataLoading || vehiclesLoading || maintenanceLoading || partsLoading || fuelLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <div className="text-lg font-medium">Chargement du tableau de bord...</div>
        <div className="text-sm text-muted-foreground mt-2">Chargement en cours…</div>
      </div>
    );
  }

  // Extraire les données depuis la source unifiée
  const workOrdersList = (technicianData as any)?.workOrders || [];
  const technicianStatsFromAPI = (technicianData as any)?.stats || {};
  
  // Debug des données reçues sur État de la Flotte
  console.log('🔍 [FLEET] Données technicien unifiées reçues:', technicianData);
  console.log('🔍 [FLEET] User ID:', user?.id);
  console.log('🔍 [FLEET] Ordres extraits:', workOrdersList.length);
  console.log('🔍 [FLEET] Stats reçues de l\'API:', technicianStatsFromAPI);
  console.log('🔍 [FLEET] Erreur API:', dataError);
  console.log('🔍 [FLEET] Loading state:', dataLoading);

  // Calculer les statistiques des véhicules depuis l'API véhicules
  const vehiclesList = (vehicles as any)?.vehicles || [];
  const vehicleStats = {
    total: vehiclesList.length,
    operational: vehiclesList.filter((v: any) => v.status === 'operational').length,
    maintenance: vehiclesList.filter((v: any) => v.status === 'maintenance').length,
    inactive: vehiclesList.filter((v: any) => v.status === 'inactive').length
  };

  // Utiliser directement les statistiques de l'API unifiée
  const workOrderStats = {
    pending: technicianStatsFromAPI.pending || 0,
    in_progress: technicianStatsFromAPI.inProgress || 0,
    completed: technicianStatsFromAPI.completed || 0,
    total: technicianStatsFromAPI.total || 0,
    overdue: technicianStatsFromAPI.overdue || 0
  };

  // Calculer le temps moyen de completion basé sur les vraies données
  const calculateAverageCompletionTime = () => {
    const completedOrdersWithDates = workOrdersList.filter((wo: any) => 
      wo.status === 'completed' && wo.createdAt && wo.endDate
    );
    
    if (completedOrdersWithDates.length === 0) return 0;
    
    const totalDays = completedOrdersWithDates.reduce((sum: number, wo: any) => {
      const created = new Date(wo.createdAt);
      const completed = new Date(wo.endDate);
      const durationDays = (completed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
      return sum + durationDays;
    }, 0);
    
    return Math.round(totalDays / completedOrdersWithDates.length * 10) / 10; // Arrondir à 1 décimale
  };

  console.log('🔍 [FLEET] Stats ordres calculées:', workOrderStats);
  console.log('🔍 [FLEET] Stats API brutes:', technicianStatsFromAPI);
  console.log('🔍 [FLEET] Temps moyen calculé:', calculateAverageCompletionTime(), 'jours');

  // Affichage d'information si aucune donnée n'est disponible
  const hasNoData = !technicianData || Object.keys(technicianStatsFromAPI).length === 0;
  if (hasNoData && !dataLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen p-4">
        <Activity className="h-12 w-12 text-gray-400 mb-4" />
        <div className="text-lg font-medium text-center">Aucun ordre de travail assigné</div>
        <div className="text-sm text-muted-foreground mt-2 text-center">
          Vos ordres de travail apparaîtront ici dès qu'un responsable vous en aura assigné.
        </div>
      </div>
    );
  }

  // Statistiques de performance du technicien
  const performanceStats = {
    ordersCompletedLast30Days: workOrderStats.completed,
    averageCompletionTime: calculateAverageCompletionTime(),
    totalCost: workOrdersList.reduce((sum: number, wo: any) => sum + (wo.totalCost || 0), 0)
  };

  // Calculer les maintenances des 7 prochains jours depuis les données réelles
  const getUpcomingMaintenanceList = () => {
    if (!Array.isArray(maintenanceSchedules) || !Array.isArray((vehicles as any)?.vehicles)) return [];

    const now = new Date();
    const sevenDaysFromNow = new Date(now);
    sevenDaysFromNow.setDate(now.getDate() + 7);

    const vehiclesList = (vehicles as any).vehicles;

    return maintenanceSchedules.filter((schedule: any) => {
      if (!schedule.scheduledDate) return false;
      const scheduleDate = new Date(schedule.scheduledDate);
      return scheduleDate >= now && scheduleDate <= sevenDaysFromNow && schedule.isActive;
    }).map((schedule: any) => {
      const vehicle = vehiclesList.find((v: any) => v.id === schedule.vehicleId);
      return {
        ...schedule,
        vehicleRegistration: vehicle?.registrationNumber || `Véhicule ${schedule.vehicleId}`
      };
    });
  };

  const upcomingMaintenanceList = getUpcomingMaintenanceList();
  const urgentTasks = workOrderStats.overdue + upcomingMaintenanceList.filter((m: any) => {
    const scheduleDate = new Date(m.scheduledDate);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return scheduleDate <= tomorrow;
  }).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-safe">
      {/* Header avec statut de connexion */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center justify-between p-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">État de la Flotte</h1>
            <p className="text-sm text-gray-600 hidden sm:block">Vue technicien mobile</p>
          </div>
          <div className="flex items-center space-x-3">
            {/* Indicateur de tâches urgentes */}
            {urgentTasks > 0 && (
              <div className="relative">
                <Bell className="h-5 w-5 text-red-600" />
                <span className="absolute -top-1 -right-1 bg-red-600 text-white text-xs rounded-full h-4 w-4 flex items-center justify-center">
                  {urgentTasks}
                </span>
              </div>
            )}

            {/* Bouton de rafraîchissement */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={!isOnline}
              className="p-2"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Statut de connexion */}
            <div className="flex items-center space-x-1">
              {isOnline ? (
                <Wifi className="h-4 w-4 text-green-600" />
              ) : (
                <WifiOff className="h-4 w-4 text-red-600" />
              )}
              <span className="text-xs text-gray-500 hidden sm:inline">
                {isOnline ? 'En ligne' : 'Hors ligne'}
              </span>
            </div>
          </div>
        </div>

        {/* Indicateur de fraîcheur des données */}
        <div className="px-4 pb-2">
          <p className="text-xs text-gray-500">
            {isOnline && isConnected
              ? `Informations à jour · ${lastUpdate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
              : isOnline
                ? "Actualisation en cours…"
                : "Hors ligne — reconnectez-vous au réseau pour actualiser"}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* KPI Véhicules - Responsive Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">Total</CardTitle>
              <Truck className="h-4 w-4 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold">{vehicleStats.total}</div>
              <p className="text-xs text-gray-500">véhicules</p>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">En Service</CardTitle>
              <CheckCircle className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold text-green-600">{vehicleStats.operational}</div>
              <p className="text-xs text-gray-500">
                {vehicleStats.total > 0 ? ((vehicleStats.operational / vehicleStats.total) * 100).toFixed(0) : 0}% dispo
              </p>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">Maintenance</CardTitle>
              <Wrench className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold text-orange-600">{vehicleStats.maintenance}</div>
              <p className="text-xs text-gray-500">en cours</p>
            </CardContent>
          </Card>

          <Card className="bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs sm:text-sm font-medium">Mes Tâches</CardTitle>
              <Activity className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-xl sm:text-2xl font-bold text-blue-600">{workOrderStats.pending + workOrderStats.in_progress}</div>
              <p className="text-xs text-gray-500">actives</p>
            </CardContent>
          </Card>
        </div>

        {/* Alertes urgentes - Mobile First */}
        {urgentTasks > 0 && (
          <Card className="bg-red-50 border-red-200">
            <CardContent className="pt-4">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <span className="font-medium text-red-900">
                  {urgentTasks} tâche{urgentTasks > 1 ? 's' : ''} urgente{urgentTasks > 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-sm text-red-700 mt-1">
                Maintenances dues ou ordres en retard
              </p>
            </CardContent>
          </Card>
        )}

        {/* Mes Activités - Version Mobile */}
        <Card className="bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Mes Activités</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center space-x-2">
                <Clock className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium">En attente</span>
              </div>
              <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                {workOrderStats.pending}
              </Badge>
            </div>

            <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
              <div className="flex items-center space-x-2">
                <Wrench className="h-4 w-4 text-blue-600" />
                <span className="text-sm font-medium">En cours</span>
              </div>
              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                {workOrderStats.in_progress}
              </Badge>
            </div>

            <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">Terminés</span>
              </div>
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                {workOrderStats.completed}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Maintenance Programmée - Optimisée Mobile */}
        <Card className="bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-base sm:text-lg">
              <Calendar className="h-4 w-4" />
              <span>Prochaines Maintenances</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingMaintenanceList.length > 0 ? (
              <div className="space-y-3">
                {upcomingMaintenanceList.slice(0, 3).map((schedule: any) => {
                  const scheduleDate = new Date(schedule.scheduledDate);
                  const isUrgent = scheduleDate <= new Date(Date.now() + 24 * 60 * 60 * 1000);

                  return (
                    <div key={schedule.id} className={`p-3 border rounded-lg ${isUrgent ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <Truck className="h-4 w-4 text-blue-600 flex-shrink-0" />
                            <span className="font-medium text-sm truncate">{schedule.vehicleRegistration}</span>
                            {isUrgent && <AlertTriangle className="h-4 w-4 text-red-600 flex-shrink-0" />}
                          </div>
                          <p className="text-sm text-gray-600 truncate">{schedule.title || schedule.maintenanceType}</p>
                        </div>
                        <div className="flex flex-col items-end ml-2">
                          <span className="text-xs text-gray-500">
                            {scheduleDate.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                          </span>
                          <span className="text-xs text-gray-500">
                            {scheduleDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {upcomingMaintenanceList.length > 3 && (
                  <div className="text-center pt-2">
                    <Button variant="ghost" size="sm" className="text-blue-600">
                      Voir toutes ({upcomingMaintenanceList.length - 3} de plus)
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">
                  Aucune maintenance programmée
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions Rapides - Mobile Optimized */}
        <Card className="bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Actions Rapides</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="flex flex-col items-center p-4 h-auto space-y-2">
                <Truck className="h-6 w-6" />
                <span className="text-xs text-center leading-tight">Mes Véhicules</span>
              </Button>
              <Button variant="outline" className="flex flex-col items-center p-4 h-auto space-y-2">
                <Wrench className="h-6 w-6" />
                <span className="text-xs text-center leading-tight">Ordres de Travail</span>
              </Button>
              <Button variant="outline" className="flex flex-col items-center p-4 h-auto space-y-2">
                <Calendar className="h-6 w-6" />
                <span className="text-xs text-center leading-tight">Planning</span>
              </Button>
              <Button variant="outline" className="flex flex-col items-center p-4 h-auto space-y-2">
                <Package className="h-6 w-6" />
                <span className="text-xs text-center leading-tight">Stock Pièces</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Informations de performance - Cachées sur très petit écran */}
        <div className="hidden sm:block">
          <Card className="bg-white shadow-sm">
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Ma Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{performanceStats.ordersCompletedLast30Days}</div>
                  <p className="text-xs text-gray-500">Ordres terminés (30j)</p>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{performanceStats.averageCompletionTime || '--'}</div>
                  <p className="text-xs text-gray-500">Temps moyen (j)</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}