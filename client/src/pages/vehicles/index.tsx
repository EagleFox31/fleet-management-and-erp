import React, { useRef, useState } from "react";
import { VehicleTable } from "@/components/vehicles/vehicle-table";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { VehicleExportButton, VehicleImportButton } from "@/components/vehicles/vehicle-export-import";
import { PageLayout } from "@/components/layout/page-layout";
import { WorkflowReminders } from "@/components/workflows/workflow-reminders";
import { MascotHelper } from "@/components/onboarding/mascot-helper";
import { Plus, Car, Wrench, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { canManageFleetVehicles } from "@/lib/auth";
import { HeaderCard, KpiGrid, KpiTile, CardShell, SectionLabel } from "@/components/design-system";
import { cn } from "@/lib/utils";

type FleetStatusFilter = "all" | "operational" | "maintenance" | "out_of_service";

export default function VehiclesIndex() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const canAddVehicle = canManageFleetVehicles(user);
  const tableSectionRef = useRef<HTMLDivElement>(null);
  const [statusFilter, setStatusFilter] = useState<FleetStatusFilter>("all");

  const { data: fleetStats } = useQuery<any>({
    queryKey: ["/api/statistics/fleet"],
  });

  const operational = Number(fleetStats?.operational || 0);
  const maintenance = Number(fleetStats?.maintenance || 0);
  const outOfService = Number(fleetStats?.outOfService || 0);
  const total = Number(fleetStats?.total || operational + maintenance + outOfService);

  const scrollToTable = () => {
    tableSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const focusStatus = (status: FleetStatusFilter) => {
    setStatusFilter((prev) => (prev === status ? "all" : status));
    scrollToTable();
  };
  
  const handleAddVehicle = () => {
    setLocation("/vehicles/new");
  };
  
  return (
    <PageLayout>
      <div className="space-y-5">
        <HeaderCard
          moduleLabel="Flotte"
          title="Gestion des véhicules"
          subtitle="Liste et détails des véhicules de la flotte"
          icon={<Car className="h-5 w-5" />}
          actions={
            canAddVehicle ? (
              <div className="flex items-center space-x-2">
                <VehicleImportButton />
                <VehicleExportButton />
                <Button onClick={handleAddVehicle} data-help-target="vehicle-add">
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter un véhicule
                </Button>
              </div>
            ) : (
              <div className="flex items-center space-x-2">
                <VehicleExportButton />
              </div>
            )
          }
        >
          <KpiGrid columns={4}>
            <KpiTile
              label="Véhicules total"
              value={total}
              subValue="Parc actif et inactif"
              icon={<Car className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
              className={cn(statusFilter === "all" && "ring-2 ring-blue-200 shadow-md")}
              onClick={() => focusStatus("all")}
              data-testid="kpi-fleet-total"
            />
            <KpiTile
              label="Opérationnels"
              value={operational}
              subValue="Disponibles mission"
              valueClassName="text-emerald-600"
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconWrapperClassName="bg-emerald-50 text-emerald-600"
              className={cn(statusFilter === "operational" && "ring-2 ring-emerald-200 shadow-md")}
              onClick={() => focusStatus("operational")}
              data-testid="kpi-fleet-operational"
            />
            <KpiTile
              label="En maintenance"
              value={maintenance}
              subValue="Interventions en cours"
              valueClassName="text-amber-600"
              icon={<Wrench className="h-4 w-4" />}
              iconWrapperClassName="bg-amber-50 text-amber-600"
              className={cn(statusFilter === "maintenance" && "ring-2 ring-amber-200 shadow-md")}
              onClick={() => focusStatus("maintenance")}
              data-testid="kpi-fleet-maintenance"
            />
            <KpiTile
              label="Hors service"
              value={outOfService}
              subValue="Action urgente requise"
              valueClassName="text-red-600"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName="bg-red-50 text-red-600"
              className={cn(statusFilter === "out_of_service" && "ring-2 ring-red-200 shadow-md")}
              onClick={() => focusStatus("out_of_service")}
              data-testid="kpi-fleet-out-of-service"
            />
          </KpiGrid>
        </HeaderCard>
        
        <WorkflowReminders compact />

        <div ref={tableSectionRef} className="scroll-mt-4">
        <CardShell>
          <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <SectionLabel>Inventaire flotte</SectionLabel>
              <h2 className="mt-0.5 text-base font-semibold text-gray-900">Liste des véhicules</h2>
            </div>
          </div>
          <div className="px-4 pb-4 pt-3" data-help-target="vehicle-table">
            <VehicleTable
              hideToolbar
              statusFilter={statusFilter}
              onStatusFilterChange={(value) => setStatusFilter(value as FleetStatusFilter)}
              onRowClick={(vehicle) => {
                setLocation(`/vehicles/${encodeURIComponent(vehicle.registrationNumber)}`);
              }}
            />
          </div>
        </CardShell>
        </div>
      </div>
      
      {/* Mascot Helper */}
      <MascotHelper currentPage="vehicles" />
    </PageLayout>
  );
}
