import React from "react";
import { VehicleForm } from "@/components/vehicles/vehicle-form";
import { PageLayout } from "@/components/layout/page-layout";
import { HeaderCard } from "@/components/design-system";
import { Car, Clock3 } from "lucide-react";

export default function VehicleNew() {
  return (
    <PageLayout>
      <div className="space-y-5">
        <HeaderCard
          moduleLabel="Flotte / Acquisition"
          title="Acquisition de vehicule - Etape 1"
          subtitle="Saisie des informations de base du vehicule en cours d'integration"
          icon={<Car className="h-5 w-5" />}
          actions={
            <span className="inline-flex items-center gap-1.5 shrink-0 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-[11px] font-semibold text-orange-800">
              <Clock3 className="h-3.5 w-3.5 text-orange-600" />
              Workflow actif · En cours d'acquisition
            </span>
          }
        />

        <VehicleForm />
      </div>
    </PageLayout>
  );
}
