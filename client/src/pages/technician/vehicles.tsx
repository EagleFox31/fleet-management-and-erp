import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Truck, Search, AlertTriangle, CheckCircle, Wrench, Fuel, Calendar } from "lucide-react";
import { Link } from "wouter";
import { ALL_VEHICLES_UNREADABLE, useAllVehicles } from "@/hooks/use-all-vehicles";
import { ALL_WORK_ORDERS_UNREADABLE, useAllWorkOrders } from "@/hooks/use-all-work-orders";
import { InlineQueryError } from "@/components/ui/inline-query-error";

export default function TechnicianVehiclesPage() {
  const [searchTerm, setSearchTerm] = React.useState("");
  
  // Flotte et OT complets : sans `limit`, `/api/vehicles` rend 10 véhicules et
  // `/api/work-orders` 50 OT. La liste du technicien s'arrêtait aux 10 véhicules les plus
  // récents, et l'OT ouvert d'un véhicule n'était pas vu s'il était plus ancien que les 50 derniers.
  const vehiclesQuery = useAllVehicles();
  const isLoading = vehiclesQuery.isLoading;

  const { data: maintenanceSchedules } = useQuery<any>({
    queryKey: ['/api/maintenance-schedules'],
  });

  const workOrdersQuery = useAllWorkOrders();

  const vehicles = vehiclesQuery.data ?? [];
  const workOrders = workOrdersQuery.data ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const filteredVehicles = Array.isArray(vehicles) ? vehicles.filter((vehicle: any) =>
    vehicle.registrationNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vehicle.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
    vehicle.model.toLowerCase().includes(searchTerm.toLowerCase())
  ) : [];

  const getVehicleStatus = (vehicle: any) => {
    switch (vehicle.status) {
      case 'operational':
        return { label: 'En Service', color: 'bg-green-100 text-green-800', icon: CheckCircle };
      case 'maintenance':
        return { label: 'En Maintenance', color: 'bg-orange-100 text-orange-800', icon: Wrench };
      case 'inactive':
        return { label: 'Hors Service', color: 'bg-red-100 text-red-800', icon: AlertTriangle };
      default:
        return { label: 'Hors Service', color: 'bg-red-100 text-red-800', icon: AlertTriangle };
    }
  };

  const getUpcomingMaintenance = (vehicleId: number) => {
    return Array.isArray(maintenanceSchedules) ? maintenanceSchedules.filter((schedule: any) => 
      schedule.vehicleId === vehicleId && 
      new Date(schedule.scheduledDate) > new Date()
    ).sort((a: any, b: any) => 
      new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()
    )[0] : null;
  };

  const getTotalPreventiveMaintenance = (vehicleId: number) => {
    return Array.isArray(maintenanceSchedules) ? maintenanceSchedules.filter((schedule: any) => 
      schedule.vehicleId === vehicleId && 
      schedule.isActive === true
    ).length : 0;
  };

  const getPendingWorkOrder = (vehicleId: number) => {
    return workOrders?.find((wo: any) => 
      wo.vehicleId === vehicleId && 
      (wo.status === 'pending' || wo.status === 'in_progress')
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Véhicules de la flotte</h1>
        <p className="text-muted-foreground">
          Vue d'ensemble des véhicules et de leur état de maintenance
        </p>
      </div>

      {/* Barre de recherche */}
      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par immatriculation, marque..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {vehiclesQuery.isError && (
        <InlineQueryError
          error={vehiclesQuery.error}
          fallback={ALL_VEHICLES_UNREADABLE}
          onRetry={() => vehiclesQuery.refetch()}
          isRetrying={vehiclesQuery.isFetching}
        />
      )}
      {workOrdersQuery.isError && (
        <InlineQueryError
          error={workOrdersQuery.error}
          fallback={ALL_WORK_ORDERS_UNREADABLE}
          onRetry={() => workOrdersQuery.refetch()}
          isRetrying={workOrdersQuery.isFetching}
        />
      )}

      {/* Liste des véhicules */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredVehicles.map((vehicle: any) => {
          const status = getVehicleStatus(vehicle);
          const StatusIcon = status.icon;
          const upcomingMaintenance = getUpcomingMaintenance(vehicle.id);
          const pendingWorkOrder = getPendingWorkOrder(vehicle.id);

          return (
            <Card key={vehicle.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <Truck className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <CardTitle className="text-lg">{vehicle.registrationNumber}</CardTitle>
                      <CardDescription>
                        {vehicle.brand} {vehicle.model}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge className={status.color}>
                    <StatusIcon className="h-3 w-3 mr-1" />
                    {status.label}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent className="space-y-4">
                {/* Informations du véhicule */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Année:</span>
                    <p className="font-medium">{vehicle.year}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Kilométrage:</span>
                    <p className="font-medium">{vehicle.mileage?.toLocaleString()} km</p>
                  </div>
                </div>

                {/* Maintenance préventive planifiée */}
                <div className="p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-gray-700">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm font-medium">Maintenances préventives actives</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {getTotalPreventiveMaintenance(vehicle.id)} actives
                    </Badge>
                  </div>
                </div>

                {/* Prochaine maintenance */}
                {upcomingMaintenance && (
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <div className="flex items-center space-x-2 text-blue-800">
                      <Calendar className="h-4 w-4" />
                      <span className="text-sm font-medium">Prochaine maintenance</span>
                    </div>
                    <p className="text-sm text-blue-700 mt-1">
                      {upcomingMaintenance.maintenanceType} - {' '}
                      {new Date(upcomingMaintenance.scheduledDate).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                )}

                {/* Ordre de travail en cours */}
                {pendingWorkOrder && (
                  <div className="p-3 bg-orange-50 rounded-lg">
                    <div className="flex items-center space-x-2 text-orange-800">
                      <Wrench className="h-4 w-4" />
                      <span className="text-sm font-medium">Intervention en cours</span>
                    </div>
                    <p className="text-sm text-orange-700 mt-1">
                      {pendingWorkOrder.title}
                    </p>
                    <Badge variant="outline" className="mt-2">
                      {pendingWorkOrder.status === 'pending' ? 'En attente' : 'En cours'}
                    </Badge>
                  </div>
                )}

                {/* Actions */}
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm" asChild className="flex-1">
                    <Link href={`/vehicles/${vehicle.registrationNumber}`}>
                      Voir détails
                    </Link>
                  </Button>
                  {vehicle.status === 'operational' && (
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/technician/my-work-orders`}>
                        <Wrench className="h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!vehiclesQuery.isError && filteredVehicles.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Truck className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">Aucun véhicule trouvé</h3>
            <p className="text-muted-foreground">
              {searchTerm ? "Essayez de modifier votre recherche" : "Aucun véhicule dans la flotte"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}