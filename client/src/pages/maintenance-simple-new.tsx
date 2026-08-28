import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Calendar, Clock, Edit, MoreVertical, Plus, Trash2, Truck, Link } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function MaintenanceSimplePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Chargement des planifications de maintenance
  const { data: schedules = [], isLoading, error } = useQuery<any>({
    queryKey: ['/api/maintenance-schedules'],
  }) as { data: any[], isLoading: boolean, error: any };

  // Chargement des véhicules pour afficher les détails
  const { data: vehiclesData } = useQuery<any>({
    queryKey: ['/api/vehicles'],
  }) as { data: { vehicles: any[] } };

  // Trouver le véhicule correspondant à un ID
  const findVehicle = (vehicleId: number) => {
    if (!vehiclesData?.vehicles) return null;
    return vehiclesData.vehicles.find((v: any) => v.id === vehicleId);
  };

  // Formater le texte de fréquence
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

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Planification des maintenances</h1>
          <p className="text-muted-foreground">
            Gérez les intervalles de maintenance pour votre flotte
          </p>
        </div>
        <Button onClick={() => window.location.href = '/maintenance'}>
          <Plus className="h-4 w-4 mr-2" />
          Ajouter une planification
        </Button>
      </div>

      {/* Filtres */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
        <TabsList>
          <TabsTrigger value="all">Toutes</TabsTrigger>
          <TabsTrigger value="active">Actives</TabsTrigger>
          <TabsTrigger value="upcoming">À venir</TabsTrigger>
          <TabsTrigger value="overdue">En retard</TabsTrigger>
          <TabsTrigger value="mileage">Kilométrage</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Recherche */}
      <div className="mb-6">
        <Input
          placeholder="Rechercher par titre ou description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full max-w-md"
        />
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
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4 mb-2" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-10 w-24 ml-auto" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-lg text-muted-foreground">
            Aucune planification de maintenance trouvée.
          </p>
          <Button 
            variant="outline" 
            className="mt-4"
            onClick={() => window.location.href = '/maintenance'}
          >
            <Plus className="h-4 w-4 mr-2" />
            Créer une planification
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {schedules.map((schedule: any) => {
            const vehicle = findVehicle(schedule.vehicleId);
            
            return (
              <Card key={schedule.id}>
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
                    <Badge className="bg-blue-500 hover:bg-blue-600">
                      {schedule.isActive ? "Active" : "Inactive"}
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
                  <Button 
                    variant="outline"
                    size="sm"
                    onClick={() => window.location.href = '/maintenance'}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Modifier
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}