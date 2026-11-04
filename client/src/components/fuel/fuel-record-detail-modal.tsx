import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { formatDate, formatPrice, formatDistance } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FuelRecordForm } from "@/components/fuel/fuel-record-form";
import { Separator } from "@/components/ui/separator";
import { useLocation } from "wouter";

interface FuelRecordDetailModalProps {
  fuelRecordId: number;
  isOpen: boolean;
  onClose: () => void;
}

export function FuelRecordDetailModal({ 
  fuelRecordId, 
  isOpen, 
  onClose 
}: FuelRecordDetailModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  
  // Récupérer l'utilisateur connecté
  const { data: currentUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });
  
  // Récupérer les détails du plein depuis la liste des pleins
  const { data: allFuelRecords, isLoading: isLoadingAllRecords } = useQuery<any>({
    queryKey: ["/api/fuel-records"],
    enabled: isOpen && !!fuelRecordId,
  });
  
  // Récupérer les détails du plein spécifique
  const fuelRecord = allFuelRecords?.find(record => record.id === fuelRecordId);
  const isLoading = isLoadingAllRecords;
  
  // Récupérer les détails du véhicule
  const { data: vehicle } = useQuery<any>({
    queryKey: [`/api/vehicles/${fuelRecord?.vehicleId}`],
    enabled: isOpen && !!fuelRecord?.vehicleId,
  });
  
  // Droits d'édition/suppression: admin ou le créateur du plein
  const canEdit = currentUser && (
    currentUser.role === 'admin' || 
    currentUser.id === fuelRecord?.createdBy
  );
  
  const deleteFuelRecord = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/fuel-records/${fuelRecordId}`);
    },
    onSuccess: () => {
      toast({
        title: "Plein supprimé",
        description: "L'enregistrement de carburant a été supprimé avec succès.",
      });
      // Invalider les requêtes pour rafraîchir les données
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/history"] });
      if (fuelRecord?.vehicleId) {
        queryClient.invalidateQueries({ 
          queryKey: [`/api/fuel-records/vehicle/${fuelRecord.vehicleId}`] 
        });
      }
      onClose();
      setIsDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Erreur lors de la suppression."),
      });
      setIsDeleteDialogOpen(false);
    },
  });
  
  const submitDelete = useSingleFlightMutate(deleteFuelRecord.mutate);

  const handleDelete = () => {
    submitDelete();
  };
  
  const handleEditSuccess = () => {
    setIsEditMode(false);
    // Invalider les requêtes pour rafraîchir les données
    queryClient.invalidateQueries({ 
      queryKey: [`/api/fuel-records/${fuelRecordId}`] 
    });
    if (fuelRecord?.vehicleId) {
      queryClient.invalidateQueries({ 
        queryKey: [`/api/fuel-records/vehicle/${fuelRecord.vehicleId}`] 
      });
    }
    queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });
    
    toast({
      title: "Plein modifié",
      description: "L'enregistrement de carburant a été modifié avec succès.",
    });
  };
  
  if (!isOpen) return null;
  
  if (isEditMode && fuelRecord) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Modifier le plein</DialogTitle>
            <DialogDescription>
              Modifier les informations de ce plein de carburant.
            </DialogDescription>
          </DialogHeader>
          <FuelRecordForm 
            initialData={fuelRecord} 
            isEdit={true} 
            recordId={fuelRecord.id}
            onSuccess={handleEditSuccess}
            onCancel={() => setIsEditMode(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }
  
  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {vehicle ? `${vehicle.brand} ${vehicle.model} - ${vehicle.registrationNumber}` : `Plein #${fuelRecordId}`}
            </DialogTitle>
            <DialogDescription>
              {fuelRecord && `Enregistré le ${formatDate(fuelRecord.date)} - ${formatDistance(fuelRecord.mileage)}`}
            </DialogDescription>
          </DialogHeader>
          
          {isLoading ? (
            <div className="flex justify-center items-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            </div>
          ) : !fuelRecord ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                Impossible de charger les informations du plein
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Informations générales</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Date</div>
                      <div className="font-medium">{formatDate(fuelRecord.date)}</div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-muted-foreground">Véhicule</div>
                      <div className="font-medium">
                        {vehicle ? (
                          <span 
                            className="cursor-pointer hover:underline" 
                            onClick={() => {
                              onClose();
                              setLocation(`/vehicles/${encodeURIComponent(vehicle.registrationNumber)}`);
                            }}
                          >
                            {vehicle.registrationNumber} ({vehicle.brand} {vehicle.model})
                          </span>
                        ) : (
                          `ID: ${fuelRecord.vehicleId}`
                        )}
                      </div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-muted-foreground">Kilométrage</div>
                      <div className="font-medium">{formatDistance(fuelRecord.mileage)}</div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-muted-foreground">Type de plein</div>
                      <Badge className={fuelRecord.fullTank ? "bg-green-700 text-white hover:bg-green-800" : "bg-slate-700 text-white hover:bg-slate-800"}>
                        {fuelRecord.fullTank ? "Complet" : "Partiel"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Détails du carburant</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Quantité</div>
                      <div className="font-medium">{fuelRecord.quantity.toFixed(2)} L</div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-muted-foreground">Coût</div>
                      <div className="font-medium">{formatPrice(fuelRecord.cost)}</div>
                    </div>
                    
                    <div>
                      <div className="text-xs text-muted-foreground">Prix unitaire</div>
                      <div className="font-medium">
                        {formatPrice(fuelRecord.cost / fuelRecord.quantity)} / L
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Consommation & Notes</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {fuelRecord.notes && (
                      <div>
                        <div className="text-xs text-muted-foreground">Notes</div>
                        <div className="font-medium">{fuelRecord.notes}</div>
                      </div>
                    )}
                    
                    <div>
                      <div className="text-xs text-muted-foreground">Ajouté par</div>
                      <div className="font-medium">{fuelRecord.createdBy ? `Utilisateur #${fuelRecord.createdBy}` : "Système"}</div>
                    </div>
                  </CardContent>
                </Card>
              </div>
              
              <Separator className="my-4" />
              
              <DialogFooter>
                {canEdit && (
                  <div className="flex space-x-2 flex-1 justify-start">
                    <Button 
                      variant="outline" 
                      onClick={() => setIsEditMode(true)}
                    >
                      <i className="fas fa-edit mr-2"></i>
                      Modifier
                    </Button>
                    
                    <Button 
                      variant="destructive" 
                      onClick={() => setIsDeleteDialogOpen(true)}
                    >
                      <i className="fas fa-trash-alt mr-2"></i>
                      Supprimer
                    </Button>
                  </div>
                )}
                
                <Button 
                  variant="outline" 
                  onClick={onClose}
                >
                  Fermer
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      
      {/* Dialog de confirmation de suppression */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmer la suppression</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer cet enregistrement de carburant ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Annuler
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDelete}
              disabled={deleteFuelRecord.isPending}
            >
              {deleteFuelRecord.isPending ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}