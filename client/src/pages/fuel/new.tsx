import React, { useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { FuelRecordForm } from "@/components/fuel/fuel-record-form";
import { useLocation } from "wouter";

export default function FuelNew() {
  const [location] = useLocation();
  const [vehicleId, setVehicleId] = useState<number | undefined>(undefined);
  
  useEffect(() => {
    // Parse URL parameters
    const url = new URL(window.location.href);
    const vehicleIdParam = url.searchParams.get("vehicleId");
    const registrationParam = url.searchParams.get("registration");
    
    // Stocker les paramètres pour le formulaire
    if (vehicleIdParam && !isNaN(parseInt(vehicleIdParam))) {
      setVehicleId(parseInt(vehicleIdParam));
    }
    
    // Si l'immatriculation est fournie, elle sera transmise au composant de formulaire
    if (registrationParam) {
      sessionStorage.setItem('selected_vehicle_registration', registrationParam);
    }
  }, [location]);
  
  return (
    <div>
      <PageHeader 
        title="Enregistrer un plein" 
        subtitle="Ajout d'un nouveau plein de carburant"
      />
      
      <FuelRecordForm vehicleId={vehicleId} />
    </div>
  );
}
