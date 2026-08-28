import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocation } from "wouter";
import { formatDate, formatDistance, getStatusColor, translateStatus, cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Plus, Eye, Edit, Wrench, Search, ChevronLeft, ChevronRight, IdCard, Shield, ClipboardCheck } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { canManageFleetVehicles } from "@/lib/auth";
import { VehicleTiresUnregisteredBadge } from "@/components/vehicles/vehicle-tires-status-badge";
import { vehicleIdsWithRegisteredTires } from "@/lib/vehicle-tires-status";
import {
  PremiumDataTable,
  type PremiumDataTableColumn,
  type SortDirection,
} from "@/components/design-system";

interface Vehicle {
  id: number;
  registrationNumber: string;
  brand: string;
  model: string;
  vehicleType: "tracteur" | "porteur" | "semi_remorque" | "remorque" | "utilitaire" | "autre";
  year: number;
  mileage: number;
  status: "operational" | "maintenance" | "out_of_service";
  tonnage?: number;
  axleCount?: number;
  engineSpec?: string;
  vin?: string;
  fuelType: string;
  purchaseDate?: string;
  purchasePrice?: number;
  nextMaintenanceDate?: string;
  nextMaintenanceMileage?: number;
  licensePlateExpiry?: string;
  insuranceExpiry?: string;
  technicalInspectionDate?: string;
  notes?: string;
}

interface VehicleTableProps {
  onRowClick?: (vehicle: Vehicle) => void;
  hideToolbar?: boolean;
  statusFilter?: string;
  onStatusFilterChange?: (value: string) => void;
}

export function VehicleTable({
  onRowClick,
  hideToolbar = false,
  statusFilter: statusFilterProp,
  onStatusFilterChange,
}: VehicleTableProps) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [internalStatusFilter, setInternalStatusFilter] = useState("all");
  const statusFilter = statusFilterProp ?? internalStatusFilter;
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<string>("registrationNumber");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const itemsPerPage = 10;

  const handleStatusFilterChange = (value: string) => {
    if (onStatusFilterChange) {
      onStatusFilterChange(value);
    } else {
      setInternalStatusFilter(value);
    }
    setCurrentPage(1);
  };

  const handleSortChange = (columnId: string) => {
    if (sortColumn === columnId) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(columnId);
      setSortDirection("asc");
    }
    setCurrentPage(1);
  };
  
  const { data, isLoading } = useQuery<any>({
    queryKey: [
      "/api/vehicles", 
      {
        search: searchTerm,
        status: statusFilter !== "all" ? statusFilter : undefined,
        vehicle_type: vehicleTypeFilter !== "all" ? vehicleTypeFilter : undefined,
        sort_by: sortColumn,
        sort_order: sortDirection,
        limit: itemsPerPage,
        offset: (currentPage - 1) * itemsPerPage
      }
    ],
  });

  const { data: allVehicleTires } = useQuery<unknown[]>({
    queryKey: ["/api/vehicle-tires"],
    staleTime: 60_000,
  });

  const vehicleIdsWithTires = vehicleIdsWithRegisteredTires(allVehicleTires);
  
  const vehicles = data?.vehicles || [];
  const totalVehicles = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(totalVehicles / itemsPerPage));
  const firstItem = totalVehicles === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const lastItem = Math.min(currentPage * itemsPerPage, totalVehicles);
  const canCreateWorkOrder = user?.role === "admin" || user?.role === "workshop_manager";
  const canAddVehicle = canManageFleetVehicles(user);

  const handleAddVehicle = () => {
    setLocation("/vehicles/new");
  };

  const vehicleTypeLabel = (vehicleType: Vehicle["vehicleType"]) => {
    if (vehicleType === "tracteur") return "Tracteur";
    if (vehicleType === "porteur") return "Porteur";
    if (vehicleType === "semi_remorque") return "Semi-remorque";
    if (vehicleType === "remorque") return "Remorque";
    if (vehicleType === "utilitaire") return "Utilitaire";
    return "Autre";
  };

  const fuelTypeLabel = (fuelType: Vehicle["fuelType"]) => {
    if (fuelType === "diesel") return "Diesel";
    if (fuelType === "petrol") return "Essence";
    if (fuelType === "electric") return "Electrique";
    if (fuelType === "hybrid") return "Hybride";
    return "Autre";
  };
  
  const columns: PremiumDataTableColumn<Vehicle>[] = [
    {
      id: "registrationNumber",
      header: "Immatriculation",
      sortable: true,
      widthClassName: "w-[118px]",
      cell: (row) => (
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-mono font-semibold text-gray-700 whitespace-nowrap">
          {row.registrationNumber}
        </span>
      ),
    },
    {
      id: "model",
      header: "Type / Modèle",
      sortable: true,
      widthClassName: "w-[min(220px,18vw)]",
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-800">
            {row.model}
            <span className="ml-1 font-normal text-gray-500">
              · {row.brand} {row.year}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
            <Badge variant="outline" size="sm" className="px-1.5 py-0 text-[10px]">
              {vehicleTypeLabel(row.vehicleType)}
            </Badge>
            {row.tonnage ? <span>{row.tonnage} t</span> : null}
            {row.axleCount ? <span>{row.axleCount} ess.</span> : null}
          </div>
        </div>
      ),
    },
    {
      id: "engineSpec",
      header: "Spécifications",
      sortable: true,
      widthClassName: "w-[min(180px,14vw)]",
      cell: (row) => (
        <div className="min-w-0 text-[12px] leading-snug">
          <div className="truncate text-gray-700">{row.engineSpec || "Non spécifié"}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-gray-500">
            <span>{fuelTypeLabel(row.fuelType)}</span>
            <span className="font-medium text-blue-600">{formatDistance(row.mileage)}</span>
          </div>
        </div>
      ),
    },
    {
      id: "licensePlateExpiry",
      header: "Documents",
      sortable: true,
      widthClassName: "w-[min(156px,12vw)]",
      cell: (row) => (
        <div className="space-y-1 text-[11px] leading-tight text-gray-600">
          {row.licensePlateExpiry ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <IdCard className="h-3 w-3 shrink-0 text-blue-600" />
              <span className="truncate">CG {formatDate(row.licensePlateExpiry)}</span>
            </div>
          ) : null}
          {row.insuranceExpiry ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <Shield className="h-3 w-3 shrink-0 text-emerald-600" />
              <span className="truncate">Ass. {formatDate(row.insuranceExpiry)}</span>
            </div>
          ) : null}
          {row.technicalInspectionDate ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <ClipboardCheck className="h-3 w-3 shrink-0 text-amber-600" />
              <span className="truncate">VT {formatDate(row.technicalInspectionDate)}</span>
            </div>
          ) : null}
          {!row.licensePlateExpiry && !row.insuranceExpiry && !row.technicalInspectionDate ? (
            <span className="text-gray-400">—</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "status",
      header: "Statut",
      sortable: true,
      widthClassName: "w-[108px]",
      cell: (row) => (
        <div className="flex flex-col gap-1.5">
          <Badge variant="outline" className={cn(getStatusColor(row.status), "whitespace-nowrap text-[11px]")}>
            {translateStatus(row.status)}
          </Badge>
          {!vehicleIdsWithTires.has(row.id) && <VehicleTiresUnregisteredBadge compact />}
        </div>
      ),
    },
    {
      id: "nextMaintenanceDate",
      header: "Maintenance",
      sortable: true,
      widthClassName: "w-[120px]",
      cell: (row) => (
        <div className="text-[12px] leading-snug">
          <div className="text-gray-700">{formatDate(row.nextMaintenanceDate || "") || "—"}</div>
          {(row.nextMaintenanceMileage ?? 0) > 0 ? (
            <div className="text-[11px] text-gray-500">ou {formatDistance(row.nextMaintenanceMileage ?? 0)}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      widthClassName: "w-[92px] whitespace-nowrap",
      cell: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              setLocation(`/vehicles/${encodeURIComponent(row.registrationNumber)}`);
            }}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={(e) => {
              e.stopPropagation();
              setLocation(`/vehicles/${encodeURIComponent(row.registrationNumber)}`);
            }}
          >
            <Edit className="h-3.5 w-3.5" />
          </Button>
          {canCreateWorkOrder ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px] border-amber-200 text-amber-700 hover:bg-amber-50"
              onClick={(e) => {
                e.stopPropagation();
                setLocation(`/maintenance/work-orders/new?vehicleId=${row.id}`);
              }}
              title="Créer un ordre de travail"
            >
              <Wrench className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
  
  return (
    <div className="space-y-4">
      {!hideToolbar && (
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-semibold">Véhicules</h2>
          {canAddVehicle ? (
            <Button onClick={handleAddVehicle}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter un véhicule
            </Button>
          ) : null}
        </div>
      )}

      <PremiumDataTable
        columns={columns}
        rows={isLoading ? [] : vehicles}
        rowKey={(row) => row.id}
        excelHeader
        tableClassName="table-fixed"
        tableContainerClassName="overflow-x-auto"
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        onRowClick={(row) => {
          if (onRowClick) {
            onRowClick(row);
          } else {
            setLocation(`/vehicles/${encodeURIComponent(row.registrationNumber)}`);
          }
        }}
        emptyState={isLoading ? "Chargement des vehicules..." : "Aucun vehicule trouve."}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Rechercher un vehicule..."
                className="pl-9 bg-gray-50 border-gray-100 h-9"
              />
            </div>
            <Select
              value={statusFilter}
              onValueChange={handleStatusFilterChange}
            >
              <SelectTrigger className="w-full sm:w-[158px] bg-gray-50 border-gray-100 h-9">
                <SelectValue placeholder="Statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                <SelectItem value="operational">Operationnel</SelectItem>
                <SelectItem value="maintenance">En maintenance</SelectItem>
                <SelectItem value="out_of_service">Hors service</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={vehicleTypeFilter}
              onValueChange={(value) => {
                setVehicleTypeFilter(value);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-[168px] bg-gray-50 border-gray-100 h-9">
                <SelectValue placeholder="Type de vehicule" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les types</SelectItem>
                <SelectItem value="tracteur">Tracteur</SelectItem>
                <SelectItem value="porteur">Porteur</SelectItem>
                <SelectItem value="semi_remorque">Semi-remorque</SelectItem>
                <SelectItem value="remorque">Remorque</SelectItem>
                <SelectItem value="utilitaire">Utilitaire</SelectItem>
                <SelectItem value="autre">Autre</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
        footer={
          <div className="w-full flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">
              {firstItem}-{lastItem} sur {totalVehicles}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-gray-600 font-medium px-2">
                {currentPage} / {totalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        }
      />
    </div>
  );
}
