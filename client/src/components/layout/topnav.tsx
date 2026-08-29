import React from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Bell, Settings, User, LogOut, ChevronDown, ChevronRight, Wrench, Package, ClipboardList, Fuel, AlertTriangle, Menu } from "lucide-react";
import { ContextualHelpButton } from "@/components/help";

interface TopnavProps {
  className?: string;
  onMenuClick?: () => void;
}

export const Topnav: React.FC<TopnavProps> = ({ className, onMenuClick }) => {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();

  const getBreadcrumbs = (path: string): string[] => {
    if (path === "/dashboard" && user?.role === "warehouse") {
      return ["Tableau de bord du magasinier"];
    }

    const routes: Record<string, string[]> = {
      "/dashboard": ["Tableau de bord"],
      "/vehicles": ["Flotte", "Véhicules"],
      "/fuel": ["Flotte", "Carburant"],
      "/maintenance": ["Maintenance", "Tableau"],
      "/maintenance/work-orders": ["Maintenance", "Ordres de travail"],
      "/maintenance/preventive": ["Maintenance", "Préventive"],
      "/maintenance/date-alerts": ["Maintenance", "Conformité docs"],
      "/inventory": ["Stock", "Inventaire"],
      "/inventory-requests": ["Stock", "Demandes de pièces"],
      "/inventory/tires": ["Stock", "Pneus"],
      "/procurement/suppliers": ["Approvisionnement", "Fournisseurs"],
      "/procurement/orders": ["Approvisionnement", "Commandes"],
      "/procurement/invoices": ["Approvisionnement", "Facture fournisseur"],
      "/procurement/supplier-invoices": ["Approvisionnement", "Facture fournisseur"],
      "/operations/invoices": ["Facturation client", "Factures clients"],
      "/operations": ["Facturation client"],
      "/missions": ["Missions transport"],
      "/reports": ["Analyse", "Rapports"],
      "/alerts": ["Alertes"],
      "/admin/users": ["Administration", "Utilisateurs"],
      "/workflows": ["Administration", "Workflows"],
      "/settings": ["Administration", "Paramètres"],
      "/technicians": ["Techniciens"],
      "/technician/my-work-orders": ["Mes interventions"],
      "/technician/fuel": ["Carburant"],
      "/technician/profile": ["Mon profil"],
      "/profile": ["Mon profil"],
    };

    if (routes[path]) return routes[path];

    // Routes dynamiques (ex: /procurement/suppliers/42)
    const prefixMatch = Object.entries(routes)
      .filter(([route]) => path.startsWith(route + "/"))
      .sort((a, b) => b[0].length - a[0].length)[0];

    if (prefixMatch) {
      // Une page de création n'est pas un détail: annoncer « Détail » sur
      // `/maintenance/work-orders/new` désoriente autant que ça informe.
      const dernierSegment = path.split("/").filter(Boolean).pop();
      if (dernierSegment === "new") return [...prefixMatch[1], "Nouveau"];
      if (dernierSegment === "edit") return [...prefixMatch[1], "Modification"];
      return [...prefixMatch[1], "Détail"];
    }

    return [];
  };

  const breadcrumbs = getBreadcrumbs(location);

  const { data: alertsCount } = useQuery<any>({
    queryKey: ["/api/alerts/count"],
    enabled: true,
    staleTime: 60 * 1000,
  });

  const { data: recentAlerts } = useQuery<any[]>({
    queryKey: ["/api/alerts"],
    enabled: true,
    staleTime: 60 * 1000,
    select: (data) => (Array.isArray(data) ? data.slice(0, 5) : []),
  });

  const notificationCount = Number(alertsCount?.unread || 0);

  const getAlertIcon = (type: string) => {
    switch (type) {
      case "maintenance": return { Icon: Wrench, color: "text-green-600 bg-green-50" };
      case "inventory":   return { Icon: Package, color: "text-amber-600 bg-amber-50" };
      case "work_order":  return { Icon: ClipboardList, color: "text-blue-600 bg-blue-50" };
      case "fuel":        return { Icon: Fuel, color: "text-orange-600 bg-orange-50" };
      default:            return { Icon: AlertTriangle, color: "text-gray-500 bg-gray-100" };
    }
  };

  const getPriorityDot = (priority: string) => {
    switch (priority) {
      case "critical": return "bg-red-500";
      case "high":     return "bg-orange-500";
      case "medium":   return "bg-amber-400";
      default:         return "bg-gray-300";
    }
  };

  const formatTimeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return "À l'instant";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}j`;
  };

  const handleLogout = async () => {
    await logout();
    setLocation("/login");
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getRoleLabel = (role: string) => {
    const roleLabels = {
      admin: "Administrateur",
      workshop_manager: "Chef d'atelier",
      technician: "Technicien",
      secretary: "Secrétaire",
      logistics: "Logisticien",
      warehouse: "Magasinier",
      management: "Direction",
      client: "Client",
      user: "Utilisateur"
    };
    return roleLabels[role as keyof typeof roleLabels] || "Utilisateur";
  };

  return (
    <div
      className={`pl-6 pr-6 py-3 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100 bg-white ${className}`}
    >
      {/* Hamburger mobile */}
      <Button
        variant="ghost"
        size="sm"
        className="md:hidden text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-xl mr-1"
        onClick={onMenuClick}
        aria-label="Ouvrir le menu"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Logo mobile */}
      <div className="md:hidden flex items-center space-x-3">
        <Link href="/dashboard" className="flex items-center space-x-2">
          <img
            src="/logo.jpg"
            alt="T.A.Y. Logo"
            className="w-8 h-8 rounded-xl object-cover ring-1 ring-green-100"
            style={{ objectPosition: 'center' }}
          />
          <span className="font-semibold text-[15px] text-green-900 tracking-tight">Yaro FleetOS</span>
        </Link>
      </div>

      {/* Breadcrumb */}
      <div className="flex-1 flex items-center pl-2">
        {breadcrumbs.length > 0 && (
          <div className="hidden md:flex items-center gap-1.5">
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="h-3 w-3 text-gray-300" />}
                <span
                  className={
                    i === breadcrumbs.length - 1
                      ? "text-[13px] font-medium text-gray-700"
                      : "text-[13px] text-gray-400"
                  }
                >
                  {crumb}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Actions à droite */}
      <div className="flex items-center gap-2">
        <ContextualHelpButton />

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="relative text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all duration-200 rounded-xl"
              aria-label="Ouvrir les alertes"
            >
              <Bell className="h-[18px] w-[18px]" />
              {notificationCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full px-1 flex items-center justify-center text-[10px] font-semibold bg-red-500 text-white">
                  {notificationCount > 99 ? "99+" : notificationCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-80 shadow-lg border border-gray-100 p-0">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-gray-800">Alertes</span>
              {notificationCount > 0 && (
                <span className="text-[11px] font-medium text-red-500 bg-red-50 px-2 py-0.5 rounded-full">
                  {notificationCount} non lue{notificationCount > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {!recentAlerts || recentAlerts.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <Bell className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                <p className="text-[12.5px] text-gray-400">Aucune alerte récente</p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {recentAlerts.map((alert) => {
                  const { Icon, color } = getAlertIcon(alert.type);
                  return (
                    <div
                      key={alert.id}
                      className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer ${!alert.isRead ? "bg-blue-50/30" : ""}`}
                      onClick={() => alert.link ? setLocation(alert.link) : setLocation("/alerts")}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${color}`}>
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getPriorityDot(alert.priority)}`} />
                          <p className="text-[12.5px] font-semibold text-gray-800 truncate">{alert.title}</p>
                        </div>
                        <p className="text-[11.5px] text-gray-500 mt-0.5 line-clamp-1">{alert.message}</p>
                      </div>
                      <span className="text-[10.5px] text-gray-400 shrink-0 mt-0.5">{formatTimeAgo(alert.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="px-4 py-2.5 border-t border-gray-100">
              <Link
                href="/alerts"
                className="flex items-center justify-center gap-1 text-[12px] font-medium text-green-600 hover:text-green-700 transition-colors"
              >
                Voir toutes les alertes
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Menu utilisateur */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2.5 hover:bg-gray-100 px-2.5 py-2 rounded-xl transition-all duration-200"
            >
              <Avatar className="h-8 w-8 ring-1 ring-green-200">
                <AvatarFallback
                  className="text-sm font-semibold text-white"
                  style={{ background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)" }}
                >
                  {getInitials(user?.name || user?.username || "U")}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start leading-tight">
                <span className="text-[13px] font-semibold text-gray-800">
                  {user?.name || user?.username}
                </span>
                <span className="text-[11px] text-green-600">
                  {getRoleLabel(user?.role || "user")}
                </span>
              </div>
              <ChevronDown className="h-3.5 w-3.5 text-gray-300 hidden md:block" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="w-56 shadow-lg border border-gray-100"
          >
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium text-gray-800">{user?.name || user?.username}</p>
                <p className="text-xs text-gray-400">{user?.email}</p>
                <span className="text-[10px] font-medium text-green-700 bg-green-50 w-fit px-2 py-0.5 rounded-full">
                  {getRoleLabel(user?.role || "user")}
                </span>
              </div>
            </DropdownMenuLabel>

            <DropdownMenuSeparator />

            <DropdownMenuItem asChild>
              <Link href="/profile" className="flex items-center w-full cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                <span>Mon profil</span>
              </Link>
            </DropdownMenuItem>

            {(user?.role === "admin" || user?.role === "workshop_manager") && (
              <DropdownMenuItem asChild>
                <Link href="/settings" className="flex items-center w-full cursor-pointer">
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Paramètres</span>
                </Link>
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={handleLogout}
              className="text-red-500 focus:text-red-500 focus:bg-red-50"
            >
              <LogOut className="mr-2 h-4 w-4" />
              <span>Déconnexion</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};
