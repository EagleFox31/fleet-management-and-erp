import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { PrintPreview } from "@/components/ui/print-preview";
import { formatDate, formatCurrency } from "@/lib/utils";

interface Vehicle {
  id: number;
  registrationNumber: string;
  brand: string;
  model: string;
  year: number;
  mileage: number;
  vehicleType: string;
  status: string;
  nextMaintenanceDate?: string;
}

interface VehicleExportProps {
  vehicles: Vehicle[];
}

export function VehicleExport({ vehicles }: VehicleExportProps) {
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
  
  const currentDate = new Date().toLocaleDateString('fr-FR');
  const fileName = `export_vehicules_${currentDate.replace(/\//g, '-')}`;
  
  const PrintContent = () => (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold mb-2">Liste des Véhicules</h2>
        <p className="text-sm text-gray-500">Total: {vehicles.length} véhicules</p>
        <p className="text-sm text-gray-500">Date d'exportation: {currentDate}</p>
      </div>
      
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-4 py-2 text-left">Immatriculation</th>
            <th className="border px-4 py-2 text-left">Marque</th>
            <th className="border px-4 py-2 text-left">Modèle</th>
            <th className="border px-4 py-2 text-left">Année</th>
            <th className="border px-4 py-2 text-left">Kilométrage</th>
            <th className="border px-4 py-2 text-left">Type</th>
            <th className="border px-4 py-2 text-left">Statut</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => (
            <tr key={vehicle.id}>
              <td className="border px-4 py-2">{vehicle.registrationNumber}</td>
              <td className="border px-4 py-2">{vehicle.brand}</td>
              <td className="border px-4 py-2">{vehicle.model}</td>
              <td className="border px-4 py-2">{vehicle.year}</td>
              <td className="border px-4 py-2">{vehicle.mileage} km</td>
              <td className="border px-4 py-2">{vehicle.vehicleType}</td>
              <td className="border px-4 py-2">{vehicle.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  
  return (
    <>
      <Button 
        variant="outline" 
        onClick={() => setIsPrintPreviewOpen(true)}
        className="flex items-center gap-2"
      >
        <i className="fas fa-file-export"></i>
        Exporter
      </Button>
      
      <PrintPreview
        title="Liste des Véhicules"
        content={<PrintContent />}
        open={isPrintPreviewOpen}
        onOpenChange={setIsPrintPreviewOpen}
      />
    </>
  );
}