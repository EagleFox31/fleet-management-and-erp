import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Fuel, Plus, Calendar, TrendingUp, Droplets, Truck, MapPin } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { formatPrice, cn } from "@/lib/utils";
import { HeaderCard, KpiGrid, KpiTile, CardShell, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";

export default function TechnicianFuelPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("");
  const [mileage, setMileage] = useState<string>("");
  const [pricePerLiter, setPricePerLiter] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [fullTank, setFullTank] = useState<boolean>(true);

  const { data: fuelRecords, isLoading: fuelLoading } = useQuery<any>({
    queryKey: ['/api/fuel-records'],
  });

  const { data: vehiclesData, isLoading: vehiclesLoading } = useQuery<any>({
    queryKey: ['/api/vehicles'],
  });

  const addFuelMutation = useMutation({
    mutationFn: async (fuelData: any) => {
      const response = await fetch('/api/fuel-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fuelData)
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erreur lors de l'ajout du plein");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Plein ajouté", description: "Le plein de carburant a été enregistré avec succès." });
      queryClient.invalidateQueries({ queryKey: ['/api/fuel-records'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vehicles'] });
      resetForm();
      setIsAddModalOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Erreur", description: error.message || "Impossible d'ajouter le plein.", variant: "destructive" });
    }
  });

  const resetForm = () => {
    setSelectedVehicleId("");
    setQuantity("");
    setMileage("");
    setPricePerLiter("");
    setLocation("");
    setFullTank(true);
  };

  const handleAddFuel = () => {
    if (!selectedVehicleId || !quantity || !mileage || !pricePerLiter) {
      toast({ title: "Champs requis", description: "Veuillez remplir tous les champs obligatoires.", variant: "destructive" });
      return;
    }
    addFuelMutation.mutate({
      vehicleId: parseInt(selectedVehicleId),
      quantity: parseFloat(quantity),
      mileage: parseInt(mileage),
      pricePerLiter: parseFloat(pricePerLiter),
      location: location.trim() || undefined,
      fullTank,
      date: new Date().toISOString()
    });
  };

  const vehicles = Array.isArray(vehiclesData?.vehicles) ? vehiclesData.vehicles : [];
  const allFuelRecords = Array.isArray(fuelRecords) ? fuelRecords : [];
  const myFuelRecords = allFuelRecords.filter((record: any) => record.createdBy === user?.id);

  const totalLiters = myFuelRecords.reduce((sum: number, record: any) => sum + record.quantity, 0);
  const totalCost = myFuelRecords.reduce((sum: number, record: any) => sum + (record.quantity * record.pricePerLiter), 0);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const recentFuelRecords = myFuelRecords.filter((record: any) => new Date(record.createdAt) >= sevenDaysAgo);

  const FuelRecordCard = ({ record }: { record: any }) => {
    const vehicle = vehicles.find((v: any) => v.id === record.vehicleId);
    const cost = record.quantity * record.pricePerLiter;
    return (
      <CardShell>
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Truck className="h-4 w-4 text-gray-400 shrink-0" />
                <p className="text-sm font-bold text-gray-900 truncate">
                  {vehicle?.registrationNumber || `Véhicule #${record.vehicleId}`}
                </p>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {vehicle?.brand} {vehicle?.model} • {new Date(record.createdAt).toLocaleDateString('fr-FR')}
              </p>
            </div>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0",
              record.fullTank ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
            )}>
              {record.fullTank ? "Complet" : "Partiel"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Volume</p>
              <p className="text-sm font-bold text-gray-800 flex items-center gap-1">
                <Droplets className="h-3.5 w-3.5 text-blue-500" />
                {record.quantity.toFixed(1)} L
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Kilométrage</p>
              <p className="text-sm font-bold text-gray-800">{record.mileage.toLocaleString()} km</p>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Prix/L</p>
              <p className="text-sm font-bold text-gray-800">{formatPrice(record.pricePerLiter || 0)}</p>
            </div>
            <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-green-600">Coût total</p>
              <p className="text-sm font-bold text-green-700">{formatPrice(cost)}</p>
            </div>
          </div>

          {record.location && (
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              <MapPin className="h-3 w-3" />
              <span>{record.location}</span>
            </div>
          )}
        </div>
      </CardShell>
    );
  };

  const EmptyState = ({ icon: Icon, title, description, onAction }: { icon: any; title: string; description: string; onAction?: () => void }) => (
    <CardShell>
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
          <Icon className="h-6 w-6 text-gray-400" />
        </div>
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        <p className="text-xs text-gray-400 mt-1 mb-4">{description}</p>
        {onAction && (
          <Button size="sm" onClick={onAction} className="gap-2">
            <Plus className="h-3.5 w-3.5" />
            Ajouter un plein
          </Button>
        )}
      </div>
    </CardShell>
  );

  if (fuelLoading || vehiclesLoading) {
    return (
      <div className="space-y-5">
        <div className="h-32 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl border border-gray-100 bg-gray-50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Technicien · Carburant"
        title="Gestion Carburant"
        subtitle="Enregistrez et suivez les pleins de carburant"
        icon={<Fuel className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => setIsAddModalOpen(true)} className="gap-2 text-xs h-8">
            <Plus className="h-3.5 w-3.5" />
            Nouveau plein
          </Button>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            label="Mes pleins"
            value={myFuelRecords.length}
            subValue="Total enregistré"
            icon={<Fuel className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            label="Volume total"
            value={`${totalLiters.toFixed(0)} L`}
            subValue="Carburant ajouté"
            icon={<Droplets className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
          />
          <KpiTile
            label="Coût total"
            value={formatPrice(totalCost)}
            subValue="Montant dépensé"
            icon={<TrendingUp className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
          />
          <KpiTile
            label="Cette semaine"
            value={recentFuelRecords.length}
            subValue="Pleins récents"
            icon={<Calendar className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
          />
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="all">
        <PremiumTabsNav tabs={[
          { value: "all", label: `Tous mes pleins (${myFuelRecords.length})`, icon: <TabIcon icon={Fuel} /> },
          { value: "recent", label: `Cette semaine (${recentFuelRecords.length})`, icon: <TabIcon icon={Calendar} /> },
        ]} />

        <TabsContent value="all" className="space-y-3">
          {myFuelRecords.length === 0 ? (
            <EmptyState
              icon={Fuel}
              title="Aucun plein enregistré"
              description="Commencez par ajouter votre premier plein de carburant"
              onAction={() => setIsAddModalOpen(true)}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {myFuelRecords
                .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((record: any) => <FuelRecordCard key={record.id} record={record} />)}
            </div>
          )}
        </TabsContent>

        <TabsContent value="recent" className="space-y-3">
          {recentFuelRecords.length === 0 ? (
            <EmptyState icon={Calendar} title="Aucun plein cette semaine" description="Les pleins ajoutés cette semaine apparaîtront ici" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {recentFuelRecords
                .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((record: any) => <FuelRecordCard key={record.id} record={record} />)}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Modal d'ajout de plein */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Ajouter un plein de carburant</DialogTitle>
            <DialogDescription>Enregistrez un nouveau plein de carburant pour un véhicule</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="vehicle">Véhicule *</Label>
              <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sélectionnez un véhicule" />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((vehicle: any) => (
                    <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                      {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="quantity">Quantité (L) *</Label>
                <Input id="quantity" type="number" step="0.1" placeholder="Ex: 50.5" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mileage">Kilométrage *</Label>
                <Input id="mileage" type="number" placeholder="Ex: 125000" value={mileage} onChange={(e) => setMileage(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="price">Prix/L (FCFA) *</Label>
                <Input id="price" type="number" step="1" placeholder="Ex: 615" value={pricePerLiter} onChange={(e) => setPricePerLiter(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="location">Station</Label>
                <Input id="location" placeholder="Ex: Station Shell Plateau" value={location} onChange={(e) => setLocation(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox id="fullTank" checked={fullTank} onCheckedChange={(checked) => setFullTank(checked as boolean)} />
              <Label htmlFor="fullTank">Plein complet</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddModalOpen(false)}>Annuler</Button>
            <Button onClick={handleAddFuel} disabled={addFuelMutation.isPending}>
              {addFuelMutation.isPending ? (
                <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current mr-2" />Ajout...</>
              ) : (
                'Ajouter le plein'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
