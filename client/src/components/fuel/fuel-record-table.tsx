import React, { useState } from "react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { formatDate, formatPrice, formatDistance, calculateFuelConsumption, formatFuelConsumption } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { FuelRecordDetailModal } from "./fuel-record-detail-modal";

interface FuelRecord {
  id: number;
  vehicleId: number;
  date: string;
  quantity: number;
  cost: number;
  mileage: number;
  fullTank: boolean;
  notes: string | null;
  vehicle?: {
    registrationNumber: string;
    brand: string;
    model: string;
  };
}

interface FuelRecordWithConsumption extends FuelRecord {
  consumption: number | null;
}

interface FuelRecordTableProps {
  onRowClick?: (record: FuelRecordWithConsumption) => void;
  vehicleId?: number;
  /** Véhicule retiré : historique consultable, pas de nouveau plein. */
  readOnly?: boolean;
}

export function FuelRecordTable({ onRowClick, vehicleId, readOnly = false }: FuelRecordTableProps) {
  const [, setLocation] = useLocation();
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedFuelRecordId, setSelectedFuelRecordId] = useState<number | null>(null);
  
  // Fetch records for the given vehicle or all records
  // Note: les bonnes pratiques client/serveur pour les URLs REST
  const { data, isLoading } = useQuery<any>({
    queryKey: vehicleId
      ? [`/api/fuel-records/vehicle/${vehicleId}`]
      : ["/api/fuel-records"]
  });
  
  // Pour le débogage
  console.log("Enregistrements carburant pour véhicule:", vehicleId, data);
  
  // Handle data structure differences between endpoints
  const records = Array.isArray(data) ? data : [];
  const previousRecords = [...records].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  
  // Calculate consumption for each record
  const recordsWithConsumption = records.map((record: FuelRecord, index: number) => {
    let consumption: number | null = null;
    
    // Find the previous record for the same vehicle to calculate consumption
    const prevRecordIndex = previousRecords.findIndex(r => 
      r.vehicleId === record.vehicleId && 
      new Date(r.date).getTime() < new Date(record.date).getTime() &&
      r.mileage < record.mileage
    );
    
    if (prevRecordIndex !== -1 && record.fullTank) {
      const prevRecord = previousRecords[prevRecordIndex];
      const distance = record.mileage - prevRecord.mileage;
      consumption = calculateFuelConsumption(record.quantity, distance);
    }
    
    return {
      ...record,
      consumption
    };
  });
  
  // Obtenir les détails du véhicule si un ID est fourni
  const { data: vehicleData, isLoading: isLoadingVehicle } = useQuery<any>({
    queryKey: [`/api/vehicles/${vehicleId}`],
    enabled: !!vehicleId
  });
  
  // Pour le débogage des données du véhicule
  console.log("Données du véhicule:", vehicleId, vehicleData);
  
  // Extraire l'immatriculation du véhicule 
  const registrationNumber = vehicleData && typeof vehicleData === 'object' && vehicleData !== null
    ? (vehicleData as any).registrationNumber || ""
    : "";

  const handleAddRecord = () => {
    const baseUrl = "/fuel/new";
    if (vehicleId && registrationNumber) {
      // Utiliser l'immatriculation dans l'URL pour préserver la navigation par immatriculation
      setLocation(`${baseUrl}?vehicleId=${vehicleId}&registration=${encodeURIComponent(registrationNumber)}`);
    } else if (vehicleId) {
      setLocation(`${baseUrl}?vehicleId=${vehicleId}`);
    } else {
      setLocation(baseUrl);
    }
  };
  
  // Définir un type pour les colonnes du tableau
  type DataTableColumnDef = {
    header: string;
    accessorKey: string;
    cell: (value: any, row?: any) => React.ReactNode;
    sortable?: boolean;
  };
  
  // Définir les colonnes du tableau
  const columns: DataTableColumnDef[] = [
    {
      header: "Date",
      accessorKey: "date",
      cell: (value: string) => <div className="text-sm">{formatDate(value)}</div>,
      sortable: true,
    },
    ...(!vehicleId ? [
      {
        header: "Véhicule",
        accessorKey: "vehicleId",
        cell: (value: number, row: FuelRecordWithConsumption) => (
          <div>
            <div className="text-sm">{row?.vehicle?.registrationNumber || `#${value}`}</div>
            {row?.vehicle && (
              <div className="text-xs text-muted-foreground">
                {row.vehicle.brand} {row.vehicle.model}
              </div>
            )}
          </div>
        ),
      }
    ] : []),
    {
      header: "Kilométrage",
      accessorKey: "mileage",
      cell: (value: number) => <div className="text-sm">{formatDistance(value)}</div>,
      sortable: true,
    },
    {
      header: "Quantité",
      accessorKey: "quantity",
      cell: (value: number) => <div className="text-sm">{value.toFixed(2)} L</div>,
      sortable: true,
    },
    {
      header: "Coût",
      accessorKey: "cost",
      cell: (value: number) => <div className="text-sm">{formatPrice(value)}</div>,
      sortable: true,
    },
    {
      header: "Consommation",
      accessorKey: "consumption",
      cell: (value: number | null) => (
        <div className="text-sm">
          {formatFuelConsumption(value)}
        </div>
      ),
    },
    {
      header: "Plein",
      accessorKey: "fullTank",
      cell: (value: boolean) => (
        <Badge className={value ? "bg-green-700 text-white hover:bg-green-800" : "bg-slate-700 text-white hover:bg-slate-800"}>
          {value ? "Complet" : "Partiel"}
        </Badge>
      ),
    },
    {
      header: "Actions",
      accessorKey: "id",
      cell: (value: number, row: FuelRecord) => (
        <div className="flex space-x-2">
          <Button
            variant="default"
            size="sm"
            className="bg-blue-500 text-white hover:bg-blue-600"
            onClick={(e) => {
              e.stopPropagation();
              // Ouvrir la fenêtre modale des détails
              setSelectedFuelRecordId(value);
            }}
          >
            <i className="fas fa-eye mr-1"></i> Détails
          </Button>
        </div>
      ),
    },
  ];
  
  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Historique des pleins</h2>
        {!readOnly && (
          <Button onClick={handleAddRecord}>
            <i className="fas fa-plus mr-2"></i>
            Ajouter un plein
          </Button>
        )}
      </div>
      
      {isLoading ? (
        <div className="flex justify-center items-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        </div>
      ) : records.length === 0 ? (
        <div className="text-center py-8 border rounded-md bg-muted/30">
          <p className="text-muted-foreground">Aucun plein de carburant enregistré</p>
        </div>
      ) : (
        <DataTable
          data={recordsWithConsumption}
          columns={columns as any}
          searchPlaceholder="Rechercher un enregistrement..."
          pagination={!vehicleId && records.length > itemsPerPage ? {
            totalItems: records.length,
            itemsPerPage,
            currentPage,
            onPageChange: setCurrentPage,
          } : undefined}
          onRowClick={onRowClick}
          isLoading={false}
        />
      )}

      {/* Modal de détails du plein */}
      {selectedFuelRecordId && (
        <FuelRecordDetailModal
          fuelRecordId={selectedFuelRecordId}
          isOpen={!!selectedFuelRecordId}
          onClose={() => setSelectedFuelRecordId(null)}
        />
      )}
    </div>
  );
}
