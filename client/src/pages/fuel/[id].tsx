import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useRoute } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { canDeleteFuelRecord } from "@shared/constants/fuel-record-delete";
import { Button } from "@/components/ui/button";
import { formatDate, formatPrice, formatDistance } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ArrowLeft, Fuel, Droplets, Gauge, Edit, Trash2, MapPin, Truck, User, Calendar } from "lucide-react";
import { FuelRecordForm } from "@/components/fuel/fuel-record-form";

export default function FuelRecordDetail() {
  const [, params] = useRoute("/fuel/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const id = params ? parseInt(params.id) : null;

  const { data: currentUser } = useQuery<any>({
    queryKey: ["/api/auth/me"],
  });

  const { data: fuelRecord, isLoading } = useQuery<any>({
    queryKey: [`/api/fuel-records/${id}`],
    enabled: !!id,
  });

  const { data: vehicle } = useQuery<any>({
    queryKey: [`/api/vehicles/${fuelRecord?.vehicleId}`],
    enabled: !!fuelRecord?.vehicleId,
  });

  const canEdit = currentUser && (
    currentUser.role === "admin" ||
    currentUser.id === fuelRecord?.createdBy
  );

  const deleteFuelRecord = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/fuel-records/${id}`);
    },
    onSuccess: () => {
      toast({ title: "Plein supprimé", description: "L'enregistrement de carburant a été supprimé avec succès." });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/history"] });
      if (fuelRecord?.vehicleId) {
        queryClient.invalidateQueries({ queryKey: [`/api/fuel-records/vehicle/${fuelRecord.vehicleId}`] });
      }
      setLocation("/fuel");
    },
    onError: (error: Error) => {
      toast({ variant: "destructive", title: "Erreur", description: userMessageOf(error, "Erreur lors de la suppression.") });
    },
  });

  const submitDelete = useSingleFlightMutate(deleteFuelRecord.mutate);

  const handleDelete = () => {
    submitDelete();
    setIsDeleteDialogOpen(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-48 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
        <div className="h-40 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
      </div>
    );
  }

  if (!fuelRecord) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
          <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
          <div className="p-6 text-center">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Enregistrement non trouvé</h2>
            <p className="text-sm text-gray-400 mb-4">L'enregistrement de carburant que vous recherchez n'existe pas ou a été supprimé.</p>
            <Button onClick={() => setLocation("/fuel")}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Retour à la liste
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const totalCost = fuelRecord.cost ?? (fuelRecord.quantity * (fuelRecord.pricePerLiter ?? 0));
  const pricePerLiter = fuelRecord.cost != null
    ? fuelRecord.cost / fuelRecord.quantity
    : (fuelRecord.pricePerLiter ?? 0);

  const vehicleTitle = vehicle
    ? `${vehicle.brand} ${vehicle.model} — ${vehicle.registrationNumber}`
    : `Plein #${fuelRecord.id}`;

  return (
    <div className="space-y-5">
      {/* ── Header card ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          {/* Back + actions */}
          <div className="flex items-start justify-between mb-4">
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground" onClick={() => setLocation("/fuel")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Carburant
            </Button>
            {canEdit && (
              <div className="flex gap-2">
                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-2 h-8 text-xs">
                      <Edit className="h-3.5 w-3.5" /> Modifier
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>Modifier le plein</DialogTitle>
                      <DialogDescription>Modifier les informations de ce plein de carburant.</DialogDescription>
                    </DialogHeader>
                    <FuelRecordForm
                      initialData={fuelRecord}
                      isEdit={true}
                      fuelRecordId={fuelRecord.id}
                      onSuccess={() => {
                        setIsEditDialogOpen(false);
                        queryClient.invalidateQueries({ queryKey: [`/api/fuel-records/${id}`] });
                        if (fuelRecord.vehicleId) {
                          queryClient.invalidateQueries({ queryKey: [`/api/fuel-records/vehicle/${fuelRecord.vehicleId}`] });
                        }
                      }}
                    />
                  </DialogContent>
                </Dialog>

                {canDeleteFuelRecord(currentUser?.role, fuelRecord) && (
                <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="destructive" className="gap-2 h-8 text-xs">
                      <Trash2 className="h-3.5 w-3.5" /> Supprimer
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Confirmer la suppression</DialogTitle>
                      <DialogDescription>Êtes-vous sûr de vouloir supprimer cet enregistrement de carburant ? Cette action est irréversible.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>Annuler</Button>
                      <Button variant="destructive" onClick={handleDelete} disabled={deleteFuelRecord.isPending}>
                        {deleteFuelRecord.isPending ? "Suppression..." : "Supprimer"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                )}
              </div>
            )}
          </div>

          {/* Type de plein badge */}
          <div className="flex gap-2 mb-4">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${fuelRecord.fullTank ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
              {fuelRecord.fullTank ? "Plein complet" : "Plein partiel"}
            </span>
          </div>

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
              <Fuel className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Carburant · Plein</span>
              <h1 className="text-xl font-bold text-gray-900">{vehicleTitle}</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(fuelRecord.date)} · {formatDistance(fuelRecord.mileage)}</p>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Droplets className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Volume</p>
              <p className="text-[15px] font-bold text-gray-800">{fuelRecord.quantity.toFixed(2)} L</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-green-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-green-100 flex items-center justify-center">
                <Fuel className="h-4 w-4 text-green-600" />
              </div>
              <p className="text-[11px] font-medium text-green-600 mt-1">Coût total</p>
              <p className="text-[15px] font-bold text-green-700">{formatPrice(totalCost)}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                <Droplets className="h-4 w-4 text-purple-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Prix / L</p>
              <p className="text-[15px] font-bold text-gray-800">{formatPrice(pricePerLiter)}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                <Gauge className="h-4 w-4 text-orange-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Kilométrage</p>
              <p className="text-[15px] font-bold text-gray-800">{formatDistance(fuelRecord.mileage)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Details card ── */}
      <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
            <Fuel className="h-3.5 w-3.5 text-green-600" />
          </div>
          <span className="text-sm font-semibold text-gray-800">Détails du plein</span>
        </div>
        <div className="px-5 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                <Calendar className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-400">Date</p>
                <p className="text-sm font-medium text-gray-800">{formatDate(fuelRecord.date)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                <Truck className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-400">Véhicule</p>
                {vehicle ? (
                  <button
                    className="text-sm font-medium text-green-600 hover:text-green-700 transition-colors"
                    onClick={() => setLocation(`/vehicles/${encodeURIComponent(vehicle.registrationNumber)}`)}
                  >
                    {vehicle.registrationNumber} ({vehicle.brand} {vehicle.model})
                  </button>
                ) : (
                  <p className="text-sm font-medium text-gray-800">ID: {fuelRecord.vehicleId}</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                <Gauge className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-400">Kilométrage</p>
                <p className="text-sm font-medium text-gray-800">{formatDistance(fuelRecord.mileage)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                <Fuel className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-400">Type de plein</p>
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${fuelRecord.fullTank ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
                  {fuelRecord.fullTank ? "Complet" : "Partiel"}
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-3.5 w-3.5 text-gray-400" />
              </div>
              <div>
                <p className="text-xs text-gray-400">Ajouté par</p>
                <p className="text-sm font-medium text-gray-800">
                  {fuelRecord.createdBy ? `Utilisateur #${fuelRecord.createdBy}` : "Système"}
                </p>
              </div>
            </div>

            {fuelRecord.location && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                  <MapPin className="h-3.5 w-3.5 text-gray-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">Station</p>
                  <p className="text-sm font-medium text-gray-800">{fuelRecord.location}</p>
                </div>
              </div>
            )}
          </div>

          {fuelRecord.notes && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-1">Notes</p>
              <p className="text-sm text-gray-700">{fuelRecord.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
