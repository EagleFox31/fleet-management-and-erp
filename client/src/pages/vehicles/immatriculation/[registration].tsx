import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { invalidateVehicleLifecycleQueries } from "@/lib/vehicle-lifecycle-cache";
import { useAuth } from "@/hooks/useAuth";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { VehicleDocuments } from "@/components/vehicles/vehicle-documents";
import { WorkOrderTable } from "@/components/maintenance/work-order-table";
import { FuelRecordTable } from "@/components/fuel/fuel-record-table";
import { formatDate, formatDistance, getStatusColor, translateStatus } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

export default function VehicleDetailsByRegistration({ params }: { params: { registration: string } }) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const registrationNumber = decodeURIComponent(params.registration);

  // Recherche serveur sur l'immatriculation (`search`). L'ancien paramètre `registrationNumber`
  // était ignoré par la route : la page cherchait dans les 10 véhicules les plus récents, et tout
  // autre véhicule restait en chargement sans fin. Une immatriculation complète ne correspond qu'à
  // quelques lignes ; la correspondance exacte est choisie côté client.
  const lookupQuery = useQuery<{ vehicles: Array<{ id: number; registrationNumber: string }>; total: number }>({
    queryKey: ["/api/vehicles", { search: registrationNumber, limit: 50 }],
    staleTime: 0,
    refetchOnMount: "always",
  });
  const vehicleId =
    lookupQuery.data?.vehicles?.find((v) => v.registrationNumber === registrationNumber)?.id ?? null;
  
  // Récupérer les détails du véhicule une fois que nous avons son ID
  const { data: vehicle, isLoading: isLoadingVehicle } = useQuery<any>({
    queryKey: [`/api/vehicles/${vehicleId}`],
    enabled: !!vehicleId,
    staleTime: 0,
    refetchOnMount: "always",
  });
  
  const { data: maintenanceSchedules } = useQuery<any>({
    queryKey: [`/api/maintenance-schedules/vehicle/${vehicleId}`],
    enabled: !!vehicleId,
  });
  
  // Récupérer les documents du véhicule
  const { data: documents } = useQuery<any>({
    queryKey: [`/api/vehicles/${vehicleId}/documents`],
    enabled: !!vehicleId,
    staleTime: 0,
    refetchOnMount: "always",
  });
  
  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/vehicles/${vehicleId}`, null);
    },
    onSuccess: () => {
      toast({
        title: "Véhicule supprimé",
        description: "Le véhicule a été supprimé avec succès.",
      });
      invalidateVehicleLifecycleQueries(queryClient, "vehicle_deleted", vehicleId);
      setLocation("/vehicles");
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Erreur lors de la suppression du véhicule."),
      });
    },
  });
  
  const handleDelete = () => {
    if (user?.role !== "admin") {
      return;
    }
    deleteMutation.mutate();
    setIsDeleteDialogOpen(false);
  };
  const canCreateWorkOrder = user?.role === "admin" || user?.role === "workshop_manager";
  
  // Chargement tant que la recherche, puis la fiche, sont en cours ; sans correspondance exacte,
  // « Véhicule non trouvé » (et non plus un chargement sans fin).
  const isLoading = lookupQuery.isLoading || (vehicleId !== null && isLoadingVehicle);

  if (lookupQuery.isError) {
    return (
      <div className="flex items-center justify-center h-64">
        <InlineQueryError
          error={lookupQuery.error}
          fallback="Le véhicule n'a pas pu être recherché. Réessayez."
          onRetry={() => lookupQuery.refetch()}
          isRetrying={lookupQuery.isFetching}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <span className="text-muted-foreground">Chargement...</span>
        </div>
      </div>
    );
  }
  
  if (!vehicle) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <h2 className="text-xl font-semibold">Véhicule non trouvé</h2>
        <p className="text-muted-foreground">Le véhicule avec l'immatriculation {registrationNumber} n'existe pas.</p>
        <Button 
          variant="outline" 
          onClick={() => setLocation("/vehicles")}
        >
          Retour à la liste
        </Button>
      </div>
    );
  }
  
  return (
    <div>
      <PageHeader 
        title={`${vehicle.brand} ${vehicle.model} - ${vehicle.registrationNumber}`}
        subtitle={`Année ${vehicle.year} • ${formatDistance(vehicle.mileage)}`}
        actions={
          <div className="flex space-x-2">
            {canCreateWorkOrder && (
              <Button
                variant="outline"
                onClick={() => setLocation(`/maintenance/work-orders/new?registrationNumber=${encodeURIComponent(vehicle.registrationNumber)}`)}
              >
                <i className="fas fa-tools mr-2"></i>
                Créer un OT
              </Button>
            )}
            
            <Button 
              variant="outline" 
              onClick={() => setLocation(`/fuel/new?registrationNumber=${encodeURIComponent(vehicle.registrationNumber)}`)}
            >
              <i className="fas fa-gas-pump mr-2"></i>
              Ajouter un plein
            </Button>
            
            {user?.role === "admin" && (
              <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive">
                    <i className="fas fa-trash-alt mr-2"></i>
                    Supprimer
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirmer la suppression</DialogTitle>
                    <DialogDescription>
                      Êtes-vous sûr de vouloir supprimer ce véhicule ? Cette action est irréversible.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
                      Annuler
                    </Button>
                    <Button 
                      variant="destructive" 
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? "Suppression..." : "Supprimer"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />
      
      <div className="mt-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="details">Détails</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
            <TabsTrigger value="fuel">Carburant</TabsTrigger>
          </TabsList>
          
          <TabsContent value="details">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Informations du véhicule</CardTitle>
                    <CardDescription>Détails et spécifications</CardDescription>
                  </div>
                  <Badge variant="outline" className={getStatusColor(vehicle.status)}>
                    {translateStatus(vehicle.status)}
                  </Badge>
                </div>
              </CardHeader>
              <Separator />
              <CardContent className="pt-6">
                <VehicleForm initialData={vehicle} isEdit />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="documents">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>Documents du véhicule</CardTitle>
                <CardDescription>Carte grise, assurance, et autres documents</CardDescription>
              </CardHeader>
              <Separator />
              <CardContent className="pt-6">
                <VehicleDocuments vehicleId={vehicle.id} />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="maintenance">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Maintenance</CardTitle>
                    <CardDescription>Historique et planification de la maintenance</CardDescription>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={() => setLocation(`/maintenance/schedules/new?registrationNumber=${encodeURIComponent(vehicle.registrationNumber)}`)}
                  >
                    <i className="fas fa-calendar-plus mr-2"></i>
                    Nouvelle planification
                  </Button>
                </div>
              </CardHeader>
              <Separator />
              <CardContent className="pt-6">
                <div className="space-y-6">
                  <div>
                    <h3 className="text-lg font-medium mb-4">Planification de maintenance</h3>
                    {maintenanceSchedules?.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {maintenanceSchedules.map((schedule: any) => (
                          <Card key={schedule.id}>
                            <CardContent className="p-4">
                              <div className="flex justify-between items-start mb-2">
                                <h4 className="font-medium">{schedule.title}</h4>
                                <Badge variant={
                                  new Date(schedule.dueDate) < new Date() ? "destructive" : "outline"
                                }>
                                  {new Date(schedule.dueDate) < new Date() ? "En retard" : "Planifié"}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mb-2">{schedule.description}</p>
                              <div className="text-sm mt-2">
                                <div className="flex justify-between py-1 border-b">
                                  <span className="font-medium">Date prévue:</span>
                                  <span>{formatDate(schedule.dueDate)}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                  <span className="font-medium">Kilométrage prévu:</span>
                                  <span>{schedule.dueMileage} km</span>
                                </div>
                                <div className="flex justify-between py-1">
                                  <span className="font-medium">Priorité:</span>
                                  <span className={`${
                                    schedule.priority === "high" ? "text-red-500" : 
                                    schedule.priority === "medium" ? "text-amber-500" : "text-green-500"
                                  }`}>
                                    {schedule.priority === "high" ? "Haute" : 
                                     schedule.priority === "medium" ? "Moyenne" : "Basse"}
                                  </span>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center p-6 bg-muted/50 rounded-lg">
                        <p className="text-muted-foreground">Aucune planification de maintenance trouvée</p>
                      </div>
                    )}
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-medium mb-4">Ordres de travail</h3>
                    <WorkOrderTable vehicleId={vehicle.id} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="fuel">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Historique de carburant</CardTitle>
                    <CardDescription>Enregistrements des pleins et consommation</CardDescription>
                  </div>
                  <Button 
                    variant="outline" 
                    onClick={() => setLocation(`/fuel/new?registrationNumber=${encodeURIComponent(vehicle.registrationNumber)}`)}
                  >
                    <i className="fas fa-gas-pump mr-2"></i>
                    Ajouter un plein
                  </Button>
                </div>
              </CardHeader>
              <Separator />
              <CardContent className="pt-6">
                <FuelRecordTable vehicleId={vehicle.id} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
