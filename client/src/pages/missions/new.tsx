import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Stepper } from "@/components/workflow/stepper";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Package, MapPin, Truck, CheckCircle, ArrowLeft, ArrowRight, Save, AlertTriangle } from "lucide-react";
import { formatPrice } from "@/lib/utils";
import { userMessageOf } from "@/lib/api-error";
import { getMissionEligibility } from "@shared/constants/vehicle-eligibility";
import { getDriverCpcEligibility, normalizeCpcStatus } from "@shared/constants/driver-cpc-eligibility";
import { CPC_BLOCK_PREFIX, driverCpcStatusOf, getCpcBlockGuidance, getStepBlockReason } from "@/lib/mission-wizard-rules";

const WORKFLOW_STEPS = [
  { number: 1, title: "Client & Mission", description: "Informations de base" },
  { number: 2, title: "Trajet & Cargo", description: "Détails transport" },
  { number: 3, title: "Affectation", description: "Véhicule & Chauffeur" },
  { number: 4, title: "Validation", description: "Récapitulatif" },
];

export default function NewMission() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  
  // Form state
  const [formData, setFormData] = useState({
    // Step 1: Client & Mission
    clientId: "",
    orderNumber: "",
    missionType: "delivery",
    specialInstructions: "",
    
    // Step 2: Trajet & Cargo
    pickupAddress: "",
    pickupDate: "",
    pickupTime: "",
    deliveryAddress: "",
    deliveryDate: "",
    deliveryTime: "",
    cargoDescription: "",
    weight: "",
    volume: "",
    estimatedDistance: "",
    
    // Step 3: Affectation
    vehicleId: "",
    driverId: "",
  });

  // Fetch clients
  const { data: clients, isLoading: clientsLoading } = useQuery<any>({
    queryKey: ["/api/clients"],
  });

  // On ne filtre plus la liste: un véhicule inéligible reste visible mais
  // désactivé, avec son motif. Le masquer laissait le logisticien chercher un
  // camion qu'il voit dans la cour sans comprendre pourquoi il a disparu.
  // Même règle que le serveur, via `getMissionEligibility`.
  const { data: vehicles, isLoading: vehiclesLoading } = useQuery<any>({
    queryKey: ["/api/vehicles/all"],
    select: (data: any[]) =>
      (data || []).map((v) => ({ ...v, eligibilite: getMissionEligibility(v) })),
  });

  // Fetch active drivers
  const { data: drivers, isLoading: driversLoading } = useQuery<any>({
    queryKey: ["/api/drivers"],
    select: (data: any[]) => data?.filter(d => d.isActive) || [],
  });

  // Create mission mutation
  const createMission = useMutation({
    mutationFn: async (data: any) => {
      return await apiRequest("POST", "/api/missions", data);
    },
    onSuccess: () => {
      toast({
        title: "Mission créée !",
        description: "La mission a été planifiée avec succès.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      setLocation("/missions");
    },
    onError: (error: unknown) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible de créer la mission."),
        variant: "destructive",
      });
    },
  });

  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleNext = () => {
    if (stepBlockReason) {
      toast({
        title: "Étape incomplète",
        description: stepBlockReason,
        variant: "destructive",
      });
      return;
    }

    if (currentStep < 4) {
      setCurrentStep(prev => prev + 1);
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(prev => prev - 1);
    }
  };

  const handleSubmit = () => {
    if (formData.vehicleId && !isWeightCompatible) {
      toast({
        title: "Véhicule incompatible",
        description: `Le poids cargo (${formData.weight}T) dépasse le tonnage du véhicule (${selectedVehicle?.tonnage ?? "N/A"}T).`,
        variant: "destructive",
      });
      return;
    }

    if (formData.driverId && !isDriverCpcCompatible) {
      toast({
        title: "Chauffeur non éligible",
        description: driverCpc.reason,
        variant: "destructive",
      });
      return;
    }

    // Combine date and time
    const pickupDateTime = formData.pickupDate && formData.pickupTime 
      ? new Date(`${formData.pickupDate}T${formData.pickupTime}`)
      : null;
    
    const deliveryDateTime = formData.deliveryDate && formData.deliveryTime
      ? new Date(`${formData.deliveryDate}T${formData.deliveryTime}`)
      : null;

    const missionData = {
      clientId: parseInt(formData.clientId),
      orderNumber: formData.orderNumber,
      missionType: formData.missionType,
      pickupAddress: formData.pickupAddress,
      pickupDate: pickupDateTime?.toISOString(),
      deliveryAddress: formData.deliveryAddress,
      deliveryDate: deliveryDateTime?.toISOString(),
      cargo: { description: formData.cargoDescription },
      weight: formData.weight ? parseFloat(formData.weight) : null,
      volume: formData.volume ? parseFloat(formData.volume) : null,
      estimatedDistance: formData.estimatedDistance ? parseInt(formData.estimatedDistance) : null,
      specialInstructions: formData.specialInstructions,
      status: "planned",
      currentStep: 4,
      assignment: formData.vehicleId && formData.driverId ? {
        vehicleId: parseInt(formData.vehicleId),
        driverId: parseInt(formData.driverId),
      } : null,
    };

    createMission.mutate(missionData);
  };

  const selectedClient = (clients as any)?.find((c: any) => c.id === parseInt(formData.clientId));
  const selectedVehicle = (vehicles as any)?.find((v: any) => v.id === parseInt(formData.vehicleId));
  const selectedDriver = (drivers as any)?.find((d: any) => d.id === parseInt(formData.driverId));
  const cargoWeight = formData.weight !== "" ? Number(formData.weight) : null;
  const vehicleTonnage = selectedVehicle?.tonnage !== undefined && selectedVehicle?.tonnage !== null
    ? Number(selectedVehicle.tonnage)
    : null;
  const isWeightCompatible = !formData.vehicleId
    || cargoWeight === null
    || Number.isNaN(cargoWeight)
    || vehicleTonnage === null
    || Number.isNaN(vehicleTonnage)
    || cargoWeight <= vehicleTonnage;
  // Même règle que la garde d'affectation du serveur, sur le statut enregistré.
  const driverCpcStatus = driverCpcStatusOf(selectedDriver);
  const driverCpc = getDriverCpcEligibility({
    cpcStatus: driverCpcStatus,
    cpcTrainingDate: selectedDriver?.cpcTrainingDate,
  });
  const isDriverCpcCompatible = !formData.driverId || driverCpc.eligible;
  const cpcGuidance = formData.driverId ? getCpcBlockGuidance(selectedDriver, user?.role) : null;
  const stepBlockReason = getStepBlockReason({
    step: currentStep,
    clientId: formData.clientId,
    orderNumber: formData.orderNumber,
    pickupAddress: formData.pickupAddress,
    deliveryAddress: formData.deliveryAddress,
    vehicleId: formData.vehicleId,
    driverId: formData.driverId,
    weightCompatible: isWeightCompatible,
    cargoWeight: formData.weight,
    vehicleTonnage: selectedVehicle?.tonnage,
    selectedDriver,
  });

  const isInitialLoading = clientsLoading || vehiclesLoading || driversLoading;

  if (isInitialLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
        <Card className="p-8 mt-8 space-y-5">
          <Skeleton className="h-7 w-80" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-24 w-full md:col-span-2" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Planifier une Mission"
        subtitle="Créez une nouvelle mission de transport étape par étape"
      />

      <div className="max-w-5xl mx-auto">
        <Stepper currentStep={currentStep} steps={WORKFLOW_STEPS} />

        <Card className="p-8 mt-8">
          {/* STEP 1: Client & Mission */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <Package className="w-8 h-8 text-primary" />
                <h2 className="text-2xl font-bold">Informations Client & Mission</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="client">Client *</Label>
                  <Select
                    value={formData.clientId}
                    onValueChange={(value) => updateFormData("clientId", value)}
                  >
                    <SelectTrigger id="client" data-testid="select-client">
                      <SelectValue placeholder="Sélectionner un client" />
                    </SelectTrigger>
                    <SelectContent>
                      {(clients as any)?.map((client: any) => (
                        <SelectItem key={client.id} value={client.id.toString()}>
                          {client.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="orderNumber">N° Commande / BL *</Label>
                  <Input
                    id="orderNumber"
                    value={formData.orderNumber}
                    onChange={(e) => updateFormData("orderNumber", e.target.value)}
                    placeholder="BL-2025-001"
                    data-testid="input-order-number"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="missionType">Type de Mission *</Label>
                  <Select
                    value={formData.missionType}
                    onValueChange={(value) => updateFormData("missionType", value)}
                  >
                    <SelectTrigger id="missionType" data-testid="select-mission-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="delivery">Livraison</SelectItem>
                      <SelectItem value="pickup">Récupération</SelectItem>
                      <SelectItem value="round_trip">Aller-Retour</SelectItem>
                      <SelectItem value="other">Autre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="specialInstructions">Instructions Spéciales</Label>
                  <Textarea
                    id="specialInstructions"
                    value={formData.specialInstructions}
                    onChange={(e) => updateFormData("specialInstructions", e.target.value)}
                    placeholder="Précisions, contraintes horaires, contacts..."
                    rows={3}
                    data-testid="textarea-instructions"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Trajet & Cargo */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <MapPin className="w-8 h-8 text-primary" />
                <h2 className="text-2xl font-bold">Trajet & Cargo</h2>
              </div>

              {/* Enlèvement */}
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <h3 className="font-semibold mb-4 text-blue-700 dark:text-blue-300">Point de départ</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-3 space-y-2">
                    <Label htmlFor="pickupAddress">Adresse d&apos;enlèvement *</Label>
                    <Input
                      id="pickupAddress"
                      value={formData.pickupAddress}
                      onChange={(e) => updateFormData("pickupAddress", e.target.value)}
                      placeholder="Port de Douala, Zone 4C"
                      data-testid="input-pickup-address"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pickupDate">Date d&apos;enlèvement <span className="text-xs text-gray-500">(facultative)</span></Label>
                    <Input
                      id="pickupDate"
                      type="date"
                      value={formData.pickupDate}
                      onChange={(e) => updateFormData("pickupDate", e.target.value)}
                      data-testid="input-pickup-date"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pickupTime">Heure d&apos;enlèvement <span className="text-xs text-gray-500">(facultative)</span></Label>
                    <Input
                      id="pickupTime"
                      type="time"
                      value={formData.pickupTime}
                      onChange={(e) => updateFormData("pickupTime", e.target.value)}
                      data-testid="input-pickup-time"
                    />
                  </div>
                </div>
              </div>

              {/* Delivery */}
              <div className="bg-success/10 p-4 rounded-lg">
                <h3 className="font-semibold mb-4 text-success">Destination</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="md:col-span-3 space-y-2">
                    <Label htmlFor="deliveryAddress">Adresse Livraison *</Label>
                    <Input
                      id="deliveryAddress"
                      value={formData.deliveryAddress}
                      onChange={(e) => updateFormData("deliveryAddress", e.target.value)}
                      placeholder="MAERSK Yaoundé, Rue de l'industrie"
                      data-testid="input-delivery-address"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="deliveryDate">Date Livraison <span className="text-xs text-gray-500">(facultative)</span></Label>
                    <Input
                      id="deliveryDate"
                      type="date"
                      value={formData.deliveryDate}
                      onChange={(e) => updateFormData("deliveryDate", e.target.value)}
                      data-testid="input-delivery-date"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="deliveryTime">Heure Livraison <span className="text-xs text-gray-500">(facultative)</span></Label>
                    <Input
                      id="deliveryTime"
                      type="time"
                      value={formData.deliveryTime}
                      onChange={(e) => updateFormData("deliveryTime", e.target.value)}
                      data-testid="input-delivery-time"
                    />
                  </div>
                </div>
              </div>

              {/* Cargo */}
              <div className="border-t pt-6">
                <h3 className="font-semibold mb-4">📦 Détails Cargo</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2 space-y-2">
                    <Label htmlFor="cargoDescription">Description Cargo</Label>
                    <Textarea
                      id="cargoDescription"
                      value={formData.cargoDescription}
                      onChange={(e) => updateFormData("cargoDescription", e.target.value)}
                      placeholder="2 conteneurs 40 pieds, marchandise générale..."
                      rows={2}
                      data-testid="textarea-cargo"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="weight">Poids (tonnes)</Label>
                    <Input
                      id="weight"
                      type="number"
                      step="0.1"
                      value={formData.weight}
                      onChange={(e) => updateFormData("weight", e.target.value)}
                      placeholder="18.5"
                      data-testid="input-weight"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="volume">Volume (m³)</Label>
                    <Input
                      id="volume"
                      type="number"
                      step="0.1"
                      value={formData.volume}
                      onChange={(e) => updateFormData("volume", e.target.value)}
                      placeholder="75.2"
                      data-testid="input-volume"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="estimatedDistance">Distance estimée (km)</Label>
                    <Input
                      id="estimatedDistance"
                      type="number"
                      value={formData.estimatedDistance}
                      onChange={(e) => updateFormData("estimatedDistance", e.target.value)}
                      placeholder="250"
                      data-testid="input-distance"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Affectation */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <Truck className="w-8 h-8 text-primary" />
                <h2 className="text-2xl font-bold">Affectation Ressources</h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Vehicle Selection */}
                <div className="space-y-4">
                  <Label>Véhicule Disponible</Label>
                  <Select
                    value={formData.vehicleId}
                    onValueChange={(value) => updateFormData("vehicleId", value)}
                  >
                    <SelectTrigger data-testid="select-vehicle">
                      <SelectValue placeholder="Sélectionner un véhicule" />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles?.map((vehicle: any) => (
                        <SelectItem
                          key={vehicle.id}
                          value={vehicle.id.toString()}
                          disabled={!vehicle.eligibilite.eligible}
                        >
                          {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model} ({vehicle.tonnage}T)
                          {!vehicle.eligibilite.eligible && (
                            <span className="ml-2 text-xs text-warning-text">
                              — {vehicle.eligibilite.blockers.map((b: any) => b.reason).join(" ; ")}
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  {selectedVehicle && (
                    <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Type:</span>
                          <p className="font-medium">{selectedVehicle.vehicleType}</p>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Tonnage:</span>
                          <p className="font-medium">{selectedVehicle.tonnage}T</p>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Kilométrage:</span>
                          <p className="font-medium">{selectedVehicle.mileage?.toLocaleString()} km</p>
                        </div>
                        <div>
                          <span className="text-gray-600 dark:text-gray-400">Carburant:</span>
                          <p className="font-medium">{selectedVehicle.fuelType}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Driver Selection */}
                <div className="space-y-4">
                  <Label>Chauffeur Disponible</Label>
                  <Select
                    value={formData.driverId}
                    onValueChange={(value) => updateFormData("driverId", value)}
                  >
                    <SelectTrigger data-testid="select-driver">
                      <SelectValue placeholder="Sélectionner un chauffeur" />
                    </SelectTrigger>
                    <SelectContent>
                      {drivers?.map((driver: any) => (
                        <SelectItem key={driver.id} value={driver.id.toString()}>
                          {driver.firstName} {driver.lastName} ({driver.employeeNumber})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedDriver && (
                    <div className="bg-muted p-4 rounded-lg">
                      <div className="space-y-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Statut CPC:</span>
                          <p className={`font-medium inline-block ml-2 px-2 py-1 rounded ${
                            driverCpc.eligible ? 'bg-success/10 text-success' :
                            normalizeCpcStatus(driverCpcStatus) === 'A FORMER' ? 'bg-warning/10 text-warning-text' :
                            'bg-destructive/10 text-destructive'
                          }`}>
                            {driverCpcStatus ?? "Non défini"}
                          </p>
                        </div>
                        {selectedDriver.licenseNumber ? (
                          <div>
                            <span className="text-muted-foreground">Permis N°:</span>
                            <p className="font-medium">{selectedDriver.licenseNumber}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-warning/10 p-4 rounded-lg border border-warning/30">
                <p className="text-sm text-foreground">
                  <strong>Astuce :</strong> Vérifiez que le tonnage du véhicule correspond au poids du cargo et que le chauffeur a une formation CPC valide pour ce type de mission.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`rounded-lg border p-4 ${
                  isWeightCompatible
                    ? "bg-success/10 text-success border-success/30"
                    : "bg-destructive/10 text-destructive-text border-destructive/30"
                }`}>
                  <p className="text-xs uppercase tracking-wide mb-1 font-semibold">Contrôle tonnage</p>
                  {!formData.vehicleId ? (
                    <p className="text-sm">Sélectionnez un véhicule pour lancer le contrôle automatique.</p>
                  ) : cargoWeight === null || Number.isNaN(cargoWeight) ? (
                    <p className="text-sm">Aucun poids cargo saisi: contrôle non bloquant.</p>
                  ) : (
                    <p className="text-sm">
                      Cargo {cargoWeight}T / Véhicule {selectedVehicle?.tonnage ?? "N/A"}T
                      {isWeightCompatible ? " - Compatible" : " - Incompatible"}
                    </p>
                  )}
                </div>

                <div className={`rounded-lg border p-4 ${
                  isDriverCpcCompatible
                    ? "bg-success/10 text-success border-success/30"
                    : "bg-destructive/10 text-destructive-text border-destructive/30"
                }`}>
                  <p className="text-xs uppercase tracking-wide mb-1 font-semibold">Contrôle CPC</p>
                  {!formData.driverId ? (
                    <p className="text-sm">Sélectionnez un chauffeur pour lancer le contrôle automatique.</p>
                  ) : (
                    <p className="text-sm">
                      Statut CPC: {driverCpcStatus ?? "Non défini"}
                      {isDriverCpcCompatible ? " - Valide" : " - Non valide (FORMÉ requis)"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Validation */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-6">
                <CheckCircle className="w-8 h-8 text-primary" />
                <h2 className="text-2xl font-bold">Récapitulatif & Validation</h2>
              </div>

              <div className="space-y-6">
                {/* Client Info */}
                <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Package className="w-5 h-5" /> Informations Client
                  </h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Client:</span>
                      <p className="font-medium">{selectedClient?.name}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">N° Commande:</span>
                      <p className="font-medium">{formData.orderNumber}</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Type Mission:</span>
                      <p className="font-medium">
                        {formData.missionType === 'delivery' ? 'Livraison' :
                         formData.missionType === 'pickup' ? 'Récupération' :
                         formData.missionType === 'round_trip' ? 'Aller-Retour' : 'Autre'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Trajet */}
                <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <MapPin className="w-5 h-5" /> Itinéraire
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">A</div>
                      <div className="flex-1">
                        <p className="font-medium">{formData.pickupAddress}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {formData.pickupDate} à {formData.pickupTime}
                        </p>
                      </div>
                    </div>
                    <div className="ml-4 border-l-2 border-dashed border-gray-300 h-8"></div>
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-success rounded-full flex items-center justify-center text-success-foreground font-bold">B</div>
                      <div className="flex-1">
                        <p className="font-medium">{formData.deliveryAddress}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {formData.deliveryDate} à {formData.deliveryTime}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Poids:</span>
                      <p className="font-medium">{formData.weight || 'N/A'} T</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Volume:</span>
                      <p className="font-medium">{formData.volume || 'N/A'} m³</p>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Distance:</span>
                      <p className="font-medium">{formData.estimatedDistance || 'N/A'} km</p>
                    </div>
                  </div>
                </div>

                {/* Ressources */}
                <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Truck className="w-5 h-5" /> Ressources Affectées
                  </h3>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 block mb-2">Véhicule:</span>
                      {selectedVehicle ? (
                        <div className="bg-white dark:bg-gray-700 p-3 rounded">
                          <p className="font-medium">{selectedVehicle.registrationNumber}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {selectedVehicle.brand} {selectedVehicle.model} - {selectedVehicle.tonnage}T
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">Non assigné</p>
                      )}
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400 block mb-2">Chauffeur:</span>
                      {selectedDriver ? (
                        <div className="bg-white dark:bg-gray-700 p-3 rounded">
                          <p className="font-medium">{selectedDriver.firstName} {selectedDriver.lastName}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {selectedDriver.employeeNumber} - {driverCpcStatus ?? "Non défini"}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">Non assigné</p>
                      )}
                    </div>
                  </div>
                </div>

                {formData.specialInstructions && (
                  <div className="bg-warning/10 p-4 rounded-lg">
                    <h4 className="font-medium mb-2">Instructions Spéciales:</h4>
                    <p className="text-sm">{formData.specialInstructions}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && cpcGuidance && (
            <div
              role="alert"
              data-testid="cpc-block-guidance"
              className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="font-semibold">{cpcGuidance.title}</p>
                <p>{cpcGuidance.why}</p>
                <p>{cpcGuidance.action}</p>
              </div>
            </div>
          )}

          {stepBlockReason && !(cpcGuidance && stepBlockReason.startsWith(CPC_BLOCK_PREFIX)) && (
            <div
              role="alert"
              data-testid="step-block-reason"
              className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p>{stepBlockReason}</p>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t">
            <div>
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  onClick={handlePrevious}
                  data-testid="btn-previous"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Précédent
                </Button>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setLocation("/missions")}
                data-testid="btn-cancel"
              >
                Annuler
              </Button>
              
              {currentStep < 4 ? (
                <Button
                  onClick={handleNext}
                  data-testid="btn-next"
                >
                  Suivant
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={createMission.isPending}
                  data-testid="btn-submit"
                  className="bg-success text-success-foreground hover:bg-success/90"
                >
                  {createMission.isPending ? (
                    "Création..."
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Planifier la Mission
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
