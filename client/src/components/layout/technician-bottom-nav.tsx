import React from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Wrench,
  Truck,
  Fuel,
  User,
  WifiOff,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { usePwaInstall } from "@/hooks/use-pwa-install";
import { TECHNICIAN_MY_WORK_ORDERS_KEY } from "@/lib/technician-work-orders-query";

interface NavItem {
  id: "dashboard" | "work_orders" | "vehicles" | "fuel" | "profile";
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  showBadge?: boolean;
}

const TECH_NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Accueil", href: "/dashboard", icon: LayoutDashboard },
  { id: "work_orders", label: "Mes OT", href: "/technician/my-work-orders", icon: Wrench, showBadge: true },
  { id: "vehicles", label: "Véhicules", href: "/technician/vehicles", icon: Truck },
  { id: "fuel", label: "Carburant", href: "/technician/fuel", icon: Fuel },
  { id: "profile", label: "Profil", href: "/technician/profile", icon: User },
];

export function TechnicianBottomNav() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { isOnline } = usePwaInstall();

  // Décompte dynamique des OT assignés au technicien
  const { data: workOrdersData } = useQuery<{
    workOrders?: Array<{ status: string }>;
    stats?: { inProgress: number; pending: number };
  }>({
    queryKey: TECHNICIAN_MY_WORK_ORDERS_KEY,
    enabled: !!user?.id && user?.role === "technician",
    staleTime: 15_000,
  });

  const activeWorkOrdersCount =
    (workOrdersData?.stats?.inProgress ?? 0) + (workOrdersData?.stats?.pending ?? 0) ||
    workOrdersData?.workOrders?.filter(
      (wo) => wo.status === "pending" || wo.status === "in_progress"
    ).length ||
    0;

  const isTabActive = (item: NavItem) => {
    switch (item.id) {
      case "dashboard":
        return location === "/" || location === "/dashboard" || location === "/technician/dashboard";
      case "work_orders":
        return location.startsWith("/technician/my-work-orders");
      case "vehicles":
        return location.startsWith("/technician/vehicles") || location.startsWith("/technician/fleet-status");
      case "fuel":
        return location.startsWith("/technician/fuel");
      case "profile":
        return location.startsWith("/technician/profile");
      default:
        return location === item.href;
    }
  };

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 select-none">
      {/* Alerte mode hors-ligne subtile */}
      {!isOnline && (
        <div className="bg-amber-500/95 text-slate-950 font-bold text-[11px] py-1 px-3 flex items-center justify-center gap-1.5 shadow-md">
          <WifiOff className="h-3.5 w-3.5" />
          <span>Mode Hors-Ligne Atelier · Données locales synchronisées dès reconnexion</span>
        </div>
      )}

      {/* Barre de navigation mobile PWA (Ordre ergonomique) */}
      <nav className="bg-slate-950/95 backdrop-blur-xl border-t border-slate-800/80 px-2 py-1.5 shadow-2xl flex items-center justify-around">
        {TECH_NAV_ITEMS.map((item) => {
          const active = isTabActive(item);
          const Icon = item.icon;

          return (
            <Link
              key={item.id}
              href={item.href}
              className={`relative flex flex-col items-center justify-center py-1 px-2.5 rounded-2xl transition-all duration-200 min-w-[56px] min-h-[48px] ${
                active
                  ? "text-emerald-400 bg-emerald-500/15 font-semibold"
                  : "text-slate-400 hover:text-slate-200 active:scale-95"
              }`}
            >
              <div className="relative">
                <Icon className={`h-5 w-5 ${active ? "text-emerald-400 stroke-[2.5]" : "stroke-[1.75]"}`} />
                {item.showBadge && activeWorkOrdersCount > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-emerald-500 text-slate-950 text-[10px] font-black w-4 h-4 rounded-full flex items-center justify-center shadow-xs">
                    {activeWorkOrdersCount > 9 ? "9+" : activeWorkOrdersCount}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-1 tracking-tight ${active ? "text-emerald-400 font-bold" : "text-slate-400"}`}>
                {item.label}
              </span>
              {active && (
                <span className="absolute -bottom-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
