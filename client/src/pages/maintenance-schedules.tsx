import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useLocation } from "wouter";

// UI Components
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Calendar, Clock, Edit, MoreVertical, Plus, Trash2, Truck, Link } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { MaintenanceScheduleForm } from "@/components/maintenance/maintenance-schedule-form";
import { getMaintenanceScheduleStatus } from "@/lib/maintenance-schedule-status";

// Types
interface MaintenanceSchedule {
  id: number;
  vehicleId: number;
  title: string;
  description?: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "mileage";
  frequencyValue: number;
  scheduledDate?: Date;
  scheduledMileage?: number;
  isActive: boolean;
  createdAt: Date;
}

interface Vehicle {
  id: number;
  registrationNumber: string;
  brand: string;
  model: string;
  year: number;
  status: string;
}

// Fonctions utilitaires
function getFrequencyText(frequency: string, value: number) {
  switch (frequency) {
    case "daily":
      return `Tous les ${value} jour${value > 1 ? 's' : ''}`;
    case "weekly":
      return `Toutes les ${value} semaine${value > 1 ? 's' : ''}`;
    case "monthly":
      return `Tous les ${value} mois`;
    case "quarterly":
      return `Tous les ${value * 3} mois`;
    case "yearly":
      return `Tous les ${value} an${value > 1 ? 's' : ''}`;
    case "mileage":
      return `Tous les ${value} kilomètres`;
    default:
      return "";
  }
}

// Status des maintenances préventives

export default function MaintenanceSchedulesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [scheduleToDelete, setScheduleToDelete] = useState<number | null>(null);
  const [scheduleToEdit, setScheduleToEdit] = useState<MaintenanceSchedule | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  // Charger les données des planifications de maintenance
  const { data: schedules = [], isLoading, error } = useQuery<any>({
    queryKey: ['/api/maintenance-schedules'],
    select: (data) => data as MaintenanceSchedule[],
  });

  // Charger les véhicules pour le filtrage
  const { data: vehiclesData } = useQuery<any>({
    queryKey: ['/api/vehicles'],
    select: (data) => data as { vehicles: Vehicle[], total: number },
  });

  // Mutation pour supprimer une planification
  const deleteMutation = useMutation({
    mutationFn: (scheduleId: number) => {
      return apiRequest("DELETE", `/api/maintenance-schedules/${scheduleId}`);
    },
    onSuccess: () => {
      toast({
        title: "Planification supprimée",
        description: "La planification de maintenance a été supprimée avec succès.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/maintenance-schedules'] });
      setIsDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Erreur lors de la suppression."),
      });
    },
  });

  // Gestion de la suppression
  const handleDelete = () => {
    if (scheduleToDelete) {
      deleteMutation.mutate(scheduleToDelete);
    }
  };

  // Filtrer les planifications
  const filteredSchedules = React.useMemo(() => {
    let filtered = [...schedules];

    // Filtre par recherche (titre ou description)
    if (searchTerm) {
      const lowerSearch = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (schedule) =>
          schedule.title.toLowerCase().includes(lowerSearch) ||
          (schedule.description && schedule.description.toLowerCase().includes(lowerSearch))
      );
    }

    // Filtre par véhicule
    if (vehicleFilter && vehicleFilter !== "tous") {
      filtered = filtered.filter((schedule) => schedule.vehicleId.toString() === vehicleFilter);
    }

    // Filtre par status
    if (statusFilter && statusFilter !== "tous") {
      filtered = filtered.filter((schedule) => {
        const status = getMaintenanceScheduleStatus(schedule);
        return status.label === statusFilter;
      });
    }

    // Filtre par onglet
    if (activeTab === "upcoming") {
      filtered = filtered.filter((schedule) => {
        const status = getMaintenanceScheduleStatus(schedule);
        return status.label === "À venir";
      });
    } else if (activeTab === "overdue") {
      filtered = filtered.filter((schedule) => {
        const status = getMaintenanceScheduleStatus(schedule);
        return status.label === "En retard";
      });
    } else if (activeTab === "mileage") {
      filtered = filtered.filter((schedule) => schedule.frequency === "mileage");
    }

    return filtered;
  }, [schedules, searchTerm, vehicleFilter, statusFilter, activeTab]);

  // Trouver le véhicule correspondant
  const findVehicle = (vehicleId: number) => {
    if (!vehiclesData?.vehicles) return null;
    return vehiclesData.vehicles.find((v) => v.id === vehicleId);
  };

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Maintenances Préventives</h1>
          <p className="text-muted-foreground">
            Gérez les intervalles de maintenance pour votre flotte
          </p>
        </div>
        <Button onClick={() => setIsCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> Ajouter une planification
        </Button>
      </div>

      {/* Onglets de filtrage rapide */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList>
          <TabsTrigger value="all">Toutes</TabsTrigger>
          <TabsTrigger value="upcoming">À venir</TabsTrigger>
          <TabsTrigger value="overdue">En retard</TabsTrigger>
          <TabsTrigger value="mileage">Kilométrage</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Filtres et recherche */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <Input
            placeholder="Rechercher par titre ou description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full"
          />
        </div>
        <div>
          <div className="flex items-center space-x-2 px-4 py-2 border rounded-md">
            <span className="text-muted-foreground">Véhicule:</span>
            <select 
              className="flex-1 bg-transparent outline-none"
              value={vehicleFilter} 
              onChange={(e) => setVehicleFilter(e.target.value)}
            >
              <option value="tous">Tous les véhicules</option>
              {vehiclesData?.vehicles?.map((vehicle) => (
                <option key={vehicle.id} value={vehicle.id.toString()}>
                  {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <div className="flex items-center space-x-2 px-4 py-2 border rounded-md">
            <span className="text-muted-foreground">Statut:</span>
            <select 
              className="flex-1 bg-transparent outline-none"
              value={statusFilter} 
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="tous">Tous les statuts</option>
              <option value="Planifiée">Planifiée</option>
              <option value="À venir">À venir</option>
              <option value="En retard">En retard</option>
              <option value="À vérifier">À vérifier (kilométrage)</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
        </div>
      </div>

      {/* Message d'erreur si nécessaire */}
      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Erreur</AlertTitle>
          <AlertDescription>
            Une erreur est survenue lors du chargement des planifications: {(error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* Indicateur de chargement */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full mb-4" />
                <div className="flex justify-between">
                  <Skeleton className="h-6 w-1/3" />
                  <Skeleton className="h-6 w-1/3" />
                </div>
              </CardContent>
              <CardFooter>
                <Skeleton className="h-10 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Liste des planifications */}
      {!isLoading && filteredSchedules.length === 0 && (
        <div className="bg-slate-50 p-10 rounded-lg text-center">
          <h3 className="text-lg font-medium">Aucune planification trouvée</h3>
          <p className="mt-2 text-slate-500">
            {searchTerm || vehicleFilter || statusFilter || activeTab !== "all"
              ? "Essayez de modifier vos filtres ou d'effectuer une autre recherche."
              : "Commencez par ajouter une nouvelle planification de maintenance."}
          </p>
          <Button className="mt-4" onClick={() => setIsCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Ajouter une planification
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSchedules.map((schedule) => {
          const vehicle = findVehicle(schedule.vehicleId);
          const status = getMaintenanceScheduleStatus(schedule);
          return (
            <Card key={schedule.id} className={`${!schedule.isActive ? 'opacity-70' : ''}`}>
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle>{schedule.title}</CardTitle>
                    <CardDescription>
                      {vehicle ? (
                        <span className="flex items-center mt-1">
                          <Truck className="h-3 w-3 mr-1" />
                          {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                        </span>
                      ) : (
                        "Véhicule inconnu"
                      )}
                    </CardDescription>
                  </div>
                  <Badge className={status.color}>
                    {status.label}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600 mb-4">
                  {schedule.description || "Aucune description fournie."}
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center">
                    <Calendar className="h-3 w-3 mr-1 text-slate-400" />
                    <span>
                      Intervalle: {getFrequencyText(schedule.frequency, schedule.frequencyValue)}
                    </span>
                  </div>
                  {schedule.scheduledDate && (
                    <div className="flex items-center">
                      <Clock className="h-3 w-3 mr-1 text-slate-400" />
                      <span>
                        Début: {format(new Date(schedule.scheduledDate), "dd/MM/yyyy", { locale: fr })}
                      </span>
                    </div>
                  )}
                  {schedule.scheduledMileage && (
                    <div className="flex items-center">
                      <Link className="h-3 w-3 mr-1 text-slate-400" />
                      <span>
                        Kilométrage: {schedule.scheduledMileage.toLocaleString()} km
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
              <CardFooter className="justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem 
                      onClick={() => {
                        setScheduleToEdit(schedule);
                        setIsEditDialogOpen(true);
                      }}
                    >
                      <Edit className="h-4 w-4 mr-2" />
                      Modifier
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={() => {
                        setScheduleToDelete(schedule.id);
                        setIsDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Supprimer
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* Dialog de création */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Nouvelle planification de maintenance</DialogTitle>
            <DialogDescription>
              Créez une nouvelle planification de maintenance préventive pour un véhicule.
            </DialogDescription>
          </DialogHeader>
          <MaintenanceScheduleForm
            onSuccess={() => setIsCreateDialogOpen(false)}
            onCancel={() => setIsCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog d'édition */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Modifier la planification</DialogTitle>
            <DialogDescription>
              Modifiez les détails de la planification de maintenance.
            </DialogDescription>
          </DialogHeader>
          {scheduleToEdit && (
            <MaintenanceScheduleForm
              initialData={scheduleToEdit}
              isEdit={true}
              scheduleId={scheduleToEdit.id}
              vehicleId={scheduleToEdit.vehicleId}
              onSuccess={() => {
                setIsEditDialogOpen(false);
                setScheduleToEdit(null);
              }}
              onCancel={() => {
                setIsEditDialogOpen(false);
                setScheduleToEdit(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog de confirmation de suppression */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Confirmer la suppression</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer cette planification de maintenance ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
            >
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
    </div>
  );
}