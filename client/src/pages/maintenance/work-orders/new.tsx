import React, { useEffect, useState } from "react";
import { WorkOrderForm } from "@/components/maintenance/work-order-form";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ArrowLeft, Plus } from "lucide-react";

const parsePositiveInt = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const getCreationParamsFromUrl = () => {
  if (typeof window === "undefined") {
    return {
      vehicleId: undefined as number | undefined,
      scheduleId: undefined as number | undefined,
      registration: undefined as string | undefined,
    };
  }

  const url = new URL(window.location.href);
  const registration =
    url.searchParams.get("registration") ||
    url.searchParams.get("registrationNumber") ||
    url.searchParams.get("vehicle") ||
    undefined;

  return {
    vehicleId: parsePositiveInt(url.searchParams.get("vehicleId")),
    scheduleId: parsePositiveInt(url.searchParams.get("scheduleId")),
    registration,
  };
};

export default function WorkOrderNew() {
  const [location] = useLocation();
  const [, setLocation] = useLocation();
  const [vehicleId, setVehicleId] = useState<number | undefined>(() => getCreationParamsFromUrl().vehicleId);
  const [scheduleId, setScheduleId] = useState<number | undefined>(() => getCreationParamsFromUrl().scheduleId);
  const [isFirstVisit, setIsFirstVisit] = useState<boolean>(false);
  const [initializing, setInitializing] = useState<boolean>(true);
  const { user } = useAuth();
  const canCreateWorkOrder = user?.role === "admin" || user?.role === "workshop_manager";

  useEffect(() => {
    let isMounted = true;
    const { vehicleId: parsedVehicleId, scheduleId: parsedScheduleId, registration } = getCreationParamsFromUrl();

    setInitializing(true);
    setVehicleId(parsedVehicleId);
    setScheduleId(parsedScheduleId);

    if (registration) {
      localStorage.setItem("currentVehicleRegistration", registration);
    }

    const checkFirstVisit = async () => {
      if (parsedVehicleId) {
        try {
          const response = await fetch(`/api/work-orders/vehicle/${parsedVehicleId}`);
          const data = await response.json();
          if (isMounted) {
            setIsFirstVisit(!data || data.length === 0);
          }
        } catch (error) {
          console.error("Error checking first visit:", error);
        } finally {
          if (isMounted) {
            setInitializing(false);
          }
        }
      } else if (isMounted) {
        setInitializing(false);
      }
    };

    checkFirstVisit();

    return () => {
      isMounted = false;
    };
  }, [location]);

  if (!canCreateWorkOrder) {
    return (
      <div className="container mx-auto py-6">
        <Alert className="max-w-md mx-auto">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Accès refusé</strong>
            <br />
            Vous n'êtes pas autorisé à créer des ordres de travail.
            Cette fonctionnalité est réservée aux administrateurs et gestionnaires d'atelier.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (initializing) {
    return (
      <div className="space-y-6">
        <div className="relative rounded-2xl overflow-hidden border border-green-100 bg-white">
          <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
          <div className="px-5 py-4 md:px-6 md:py-5 space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-7 w-64" />
          </div>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-6 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero Banner */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #bbf7d0 100%)" }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: "radial-gradient(circle, #16a34a 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative px-5 py-4 md:px-6 md:py-5">
          {/* Title */}
          <div className="flex items-center gap-3">
            {/* Sortie explicite: sans elle, quitter l'assistant passe par le
                bouton retour du navigateur ou le fil d'Ariane, deux gestes que
                personne ne fait quand un formulaire est a moitie rempli. */}
            <button
              type="button"
              onClick={() => setLocation("/maintenance/work-orders")}
              className="w-8 h-8 rounded-lg border border-green-200 bg-white/70 flex items-center justify-center shrink-0 text-green-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
              aria-label="Retour aux ordres de travail"
              title="Retour aux ordres de travail"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="w-8 h-8 rounded-lg bg-green-600/10 border border-green-200 flex items-center justify-center shrink-0">
              <Plus className="h-4 w-4 text-green-700" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-green-600">Maintenance</span>
              </div>
              <h1 className="text-lg font-bold text-green-950 leading-tight">
                Nouvel ordre de travail
              </h1>
            </div>
          </div>
        </div>
      </div>

      <WorkOrderForm
        preselectedVehicleId={vehicleId}
        initialData={scheduleId ? { maintenanceScheduleId: scheduleId, isPreventive: true } : undefined}
      />
    </div>
  );
}
