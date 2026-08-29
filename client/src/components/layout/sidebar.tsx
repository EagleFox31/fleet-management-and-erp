import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/hooks/useAuth";
import {
  BarChart3,
  Truck,
  Wrench,
  AlertTriangle,
  CalendarCheck,
  ClipboardList,
  Package,
  Fuel,
  HardHat,
  TrendingUp,
  Settings,
  Workflow,
  User,
  Users,
  Map,
  Store,
  ShoppingCart,
  FileText,
  ChevronRight,
  ChevronLeft,
  PackageSearch,
  Shield,
  BarChart,
  Car,
  CircleDot,
  Gauge,
  X,
  FileCheck,
  Receipt,
  Award,
  Banknote,
  Sparkles,
  Mail,
} from "lucide-react";

interface SidebarProps {
  className?: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface MenuItem {
  label: string;
  href?: string;
  icon: any;
  submenu?: MenuItem[];
  menuKey?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ className, mobileOpen, onMobileClose }) => {
  const [location] = useLocation();
  const { user } = useAuth();
  const [openMenus, setOpenMenus] = useState<Record<string, boolean>>({
    procurement: true,
    administration: false,
    analysis: false,
    resources: false,
    maintenance: false,
    inventory: false,
  });

  const toggleMenu = (menuKey: string) => {
    setOpenMenus((prev) => ({
      ...prev,
      [menuKey]: !prev[menuKey],
    }));
  };

  const getRoleBasedMenu = (): MenuItem[] => {
    switch (user?.role) {
      case 'admin':
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
          {
            label: "Ressources Véhicules",
            icon: Car,
            menuKey: "resources",
            submenu: [
              { label: "Véhicules", href: "/vehicles", icon: Truck },
              { label: "Chauffeurs", href: "/drivers", icon: User },
              { label: "Carburant", href: "/fuel", icon: Fuel },
              { label: "Documents & Conformité", href: "/vehicles/documents", icon: FileCheck },
            ]
          },
          {
            label: "Maintenance",
            icon: Wrench,
            menuKey: "maintenance",
            submenu: [
              { label: "Tableau Maintenance", href: "/maintenance", icon: Gauge },
              { label: "Ordres de travail", href: "/maintenance/work-orders", icon: ClipboardList },
              { label: "Planifications préventives", href: "/maintenance/preventive", icon: CalendarCheck },
            ]
          },
          {
            label: "Gestion de stock",
            icon: Package,
            menuKey: "inventory",
            submenu: [
              { label: "Inventaire des pièces", href: "/inventory", icon: Package },
              { label: "Demandes de pièces", href: "/inventory-requests", icon: ClipboardList },
              { label: "Gestion des Pneus", href: "/inventory/tires", icon: CircleDot },
            ]
          },
          {
            label: "Approvisionnement",
            icon: PackageSearch,
            menuKey: "procurement",
            submenu: [
              { label: "Fournisseurs", href: "/procurement/suppliers", icon: Store },
              { label: "Commandes", href: "/procurement/orders", icon: ShoppingCart },
              { label: "Facture fournisseur", href: "/procurement/invoices", icon: FileText },
            ]
          },
          { label: "Facturation client", href: "/operations", icon: Receipt },
          {
            label: "Analyse",
            icon: BarChart,
            menuKey: "analysis",
            submenu: [
              { label: "Rapports", href: "/reports", icon: TrendingUp },
            ]
          },
          {
            label: "Administration",
            icon: Shield,
            menuKey: "administration",
            submenu: [
              { label: "Utilisateurs", href: "/admin/users", icon: User },
              { label: "Workflows", href: "/workflows", icon: Workflow },
              { label: "Paramètres", href: "/settings", icon: Settings },
            ]
          },
        ];

      case 'workshop_manager':
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
          {
            label: "Ressources Véhicules",
            icon: Car,
            menuKey: "resources",
            submenu: [
              { label: "Véhicules", href: "/vehicles", icon: Truck },
              { label: "Carburant", href: "/fuel", icon: Fuel },
              { label: "Documents & Conformité", href: "/vehicles/documents", icon: FileCheck },
            ]
          },
          {
            label: "Maintenance",
            icon: Wrench,
            menuKey: "maintenance",
            submenu: [
              { label: "Tableau Maintenance", href: "/maintenance", icon: Gauge },
              { label: "Ordres de travail", href: "/maintenance/work-orders", icon: ClipboardList },
              { label: "Planifications préventives", href: "/maintenance/preventive", icon: CalendarCheck },
            ]
          },
          {
            label: "Gestion de stock",
            icon: Package,
            menuKey: "inventory",
            submenu: [
              { label: "Inventaire des pièces", href: "/inventory", icon: Package },
              { label: "Demandes de pièces", href: "/inventory-requests", icon: ClipboardList },
              { label: "Gestion des Pneus", href: "/inventory/tires", icon: CircleDot },
            ]
          },
          { label: "Techniciens", href: "/technicians", icon: HardHat },
          {
            label: "Analyse",
            icon: BarChart,
            menuKey: "analysis",
            submenu: [
              { label: "Rapports", href: "/reports", icon: TrendingUp },
            ]
          },
        ];

      case 'technician':
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
          { label: "Mes interventions", href: "/technician/my-work-orders", icon: ClipboardList },
          { label: "Carburant", href: "/technician/fuel", icon: Fuel },
          { label: "Mon profil", href: "/technician/profile", icon: User },
        ];

      case 'secretary':
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
          {
            label: "Ressources Véhicules",
            icon: Car,
            menuKey: "resources",
            submenu: [
              { label: "Véhicules", href: "/vehicles", icon: Truck },
              { label: "Chauffeurs", href: "/drivers", icon: User },
              { label: "Carburant", href: "/fuel", icon: Fuel },
              { label: "Documents & Conformité", href: "/vehicles/documents", icon: FileCheck },
            ]
          },
          {
            label: "Gestion de stock",
            icon: Package,
            menuKey: "inventory",
            submenu: [
              { label: "Inventaire des pièces", href: "/inventory", icon: Package },
              { label: "Demandes de pièces", href: "/inventory-requests", icon: ClipboardList },
              { label: "Gestion des Pneus", href: "/inventory/tires", icon: CircleDot },
            ]
          },
          {
            label: "Approvisionnement",
            icon: PackageSearch,
            menuKey: "procurement",
            submenu: [
              { label: "Fournisseurs", href: "/procurement/suppliers", icon: Store },
              { label: "Commandes", href: "/procurement/orders", icon: ShoppingCart },
              { label: "Facture fournisseur", href: "/procurement/invoices", icon: FileText },
            ]
          },
          { label: "Facturation client", href: "/operations", icon: Receipt },
          { label: "Conformité docs", href: "/maintenance/date-alerts", icon: AlertTriangle },
          {
            label: "Analyse",
            icon: BarChart,
            menuKey: "analysis",
            submenu: [
              { label: "Rapports", href: "/reports", icon: TrendingUp },
            ]
          },
        ];

      case 'warehouse':
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
          {
            label: "Gestion de stock",
            icon: Package,
            menuKey: "inventory",
            submenu: [
              { label: "Inventaire des pièces", href: "/inventory", icon: Package },
              { label: "Gestion des Pneus", href: "/inventory/tires", icon: CircleDot },
            ]
          },
          {
            label: "Approvisionnement",
            icon: PackageSearch,
            menuKey: "procurement",
            submenu: [
              { label: "Fournisseurs", href: "/procurement/suppliers", icon: Store },
              { label: "Commandes", href: "/procurement/orders", icon: ShoppingCart },
              { label: "Facture fournisseur", href: "/procurement/invoices", icon: FileText },
            ]
          },
          { label: "Demandes de pièces", href: "/inventory-requests", icon: ClipboardList },
          { label: "Alertes stock", href: "/alerts", icon: AlertTriangle },
        ];

      case 'logistics':
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
          {
            label: "Ressources Véhicules",
            icon: Car,
            menuKey: "resources",
            submenu: [
              { label: "Véhicules", href: "/vehicles", icon: Truck },
              { label: "Chauffeurs", href: "/drivers", icon: User },
              { label: "Carburant", href: "/fuel", icon: Fuel },
              { label: "Documents & Conformité", href: "/vehicles/documents", icon: FileCheck },
              { label: "Suivi pneus", href: "/inventory/tires", icon: CircleDot },
            ]
          },
          {
            label: "Approvisionnement",
            icon: PackageSearch,
            menuKey: "procurement",
            submenu: [
              { label: "Fournisseurs", href: "/procurement/suppliers", icon: Store },
              { label: "Commandes", href: "/procurement/orders", icon: ShoppingCart },
              { label: "Facture fournisseur", href: "/procurement/invoices", icon: FileText },
            ]
          },
          { label: "Missions transport", href: "/missions", icon: Map },
          { label: "Facturation client", href: "/operations", icon: Receipt },
          {
            label: "Analyse",
            icon: BarChart,
            menuKey: "analysis",
            submenu: [
              { label: "Rapports", href: "/reports", icon: TrendingUp },
            ]
          },
        ];

      case 'management':
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
          { label: "Corridors CEMAC", href: "/management/corridor-map", icon: Map },
          { label: "Mon équipe", href: "/management/team", icon: Users },
          {
            label: "Rapports Direction",
            icon: FileText,
            menuKey: "management-reports",
            submenu: [
              { label: "Board Pack Stratégique", href: "/management/reports/board-pack", icon: Sparkles },
              { label: "Trésorerie & Recouvrement", href: "/management/reports/finance", icon: Banknote },
              { label: "Audit Flotte & TCO", href: "/management/reports/fleet", icon: Truck },
              { label: "Performance Chauffeurs", href: "/management/reports/drivers", icon: Award },
              { label: "Distribution & Envois", href: "/management/reports/scheduled", icon: Mail },
            ]
          },
        ];

      case 'client':
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
          { label: "Mes véhicules", href: "/vehicles", icon: Truck },
        ];

      default:
        return [
          { label: "Tableau de bord", href: "/dashboard", icon: BarChart3 },
        ];
    }
  };

  const isActive = (href: string) => {
    return location === href ||
           (href === "/dashboard" && location === "/") ||
           (href !== "/dashboard" && location.startsWith(href + "/"));
  };

  const getActiveSubmenuHref = (submenu?: MenuItem[]) => {
    if (!submenu) return null;
    const matchingItems = submenu.filter((item) => item.href && isActive(item.href));
    if (matchingItems.length === 0) return null;
    const [mostSpecificMatch] = matchingItems.sort(
      (a, b) => (b.href?.length || 0) - (a.href?.length || 0),
    );
    return mostSpecificMatch.href || null;
  };

  const filteredMenuItems = useMemo(() => getRoleBasedMenu(), [user?.role]);

  const activeGroupMenuKeys = useMemo(() => {
    return filteredMenuItems
      .filter((item) =>
        Boolean(
          item.menuKey &&
            item.submenu?.some((subItem) => subItem.href && isActive(subItem.href)),
        ),
      )
      .map((item) => item.menuKey as string);
  }, [filteredMenuItems, location]);

  useEffect(() => {
    if (activeGroupMenuKeys.length === 0) return;
    setOpenMenus((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const key of activeGroupMenuKeys) {
        if (!next[key]) {
          next[key] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeGroupMenuKeys]);

  const [collapsed, setCollapsed] = useState(false);

  const sidebarContent = (
    <>
      {/* Header */}
      <div className={cn("flex items-center gap-2 px-3 py-4", collapsed ? "flex-col" : "")}>
        <img
          src="/logo.jpg"
          alt="T.A.Y. Logo"
          className="w-9 h-9 rounded-xl object-cover shadow-sm ring-1 ring-green-100 shrink-0"
          style={{ objectPosition: 'center' }}
        />
        {!collapsed && (
          <div className="flex flex-col leading-tight flex-1 min-w-0">
            <span className="font-semibold text-[15px] text-green-900 tracking-tight">Yaro FleetOS</span>
            <span className="text-[11px] text-green-600/70 font-normal">Gestion de flotte</span>
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Étendre" : "Réduire"}
          className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors shrink-0"
        >
          {collapsed
            ? <ChevronRight className="h-3.5 w-3.5" />
            : <ChevronLeft className="h-3.5 w-3.5" />
          }
        </button>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-gray-100" />

      {/* Nav */}
      <ScrollArea className="flex-1 py-4">
        <nav className={collapsed ? "px-2" : "px-3"} data-help-target="app-sidebar">
          <ul className="space-y-1.5">
            {filteredMenuItems.map((item, index) => {
              const activeSubmenuHref = getActiveSubmenuHref(item.submenu);
              const isGroupActive = Boolean(activeSubmenuHref);

              if (collapsed) {
                const isItemActive = item.href ? isActive(item.href) : isGroupActive;
                return (
                  <li key={item.href || item.menuKey || `menu-${index}`}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        title={item.label}
                        className={cn(
                          "flex justify-center p-2.5 rounded-xl transition-all duration-200",
                          isActive(item.href)
                            ? "text-green-600 bg-green-50"
                            : "text-gray-400 hover:text-green-600 hover:bg-green-50"
                        )}
                      >
                        <item.icon className="w-[18px] h-[18px]" />
                      </Link>
                    ) : (
                      <button
                        title={item.label}
                        onClick={() => toggleMenu(item.menuKey!)}
                        className={cn(
                          "w-full flex justify-center p-2.5 rounded-xl transition-all duration-200",
                          isItemActive
                            ? "text-green-600 bg-green-50"
                            : "text-gray-400 hover:text-green-600 hover:bg-green-50"
                        )}
                      >
                        <item.icon className="w-[18px] h-[18px]" />
                      </button>
                    )}
                  </li>
                );
              }

              return (
                <li key={item.href || item.menuKey || `menu-${index}`}>
                  {item.submenu && item.menuKey ? (
                    <Collapsible
                      open={openMenus[item.menuKey]}
                      onOpenChange={() => toggleMenu(item.menuKey!)}
                    >
                      <CollapsibleTrigger
                        className={cn(
                          "group flex items-center justify-between w-full px-3 py-2.5 text-[13px] font-medium rounded-xl transition-all duration-200",
                          isGroupActive
                            ? "text-green-700 bg-green-50 ring-1 ring-inset ring-green-200"
                            : "text-gray-600 hover:text-green-700 hover:bg-green-50",
                        )}
                        data-testid={`menu-${item.menuKey}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <item.icon className={cn(
                            "w-[17px] h-[17px] transition-colors duration-200",
                            isGroupActive ? "text-green-600" : "text-gray-400 group-hover:text-green-600"
                          )} />
                          <span>{item.label}</span>
                        </div>
                        <ChevronRight
                          className={cn(
                            "w-3.5 h-3.5 text-gray-300 transition-transform duration-200",
                            openMenus[item.menuKey] && "rotate-90"
                          )}
                        />
                      </CollapsibleTrigger>

                      <CollapsibleContent>
                        <ul className="mt-0.5 ml-3 pl-3 border-l border-green-100 space-y-0.5 py-1">
                          {item.submenu.map((subItem) => {
                            const subActive = activeSubmenuHref === subItem.href;
                            return (
                              <li key={subItem.href}>
                                <Link
                                  href={subItem.href!}
                                  className={cn(
                                    "group flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] font-medium rounded-lg transition-all duration-200",
                                    subActive
                                      ? "text-green-700 bg-green-100 font-semibold"
                                      : "text-gray-500 hover:text-green-700 hover:bg-green-50",
                                  )}
                                  data-testid={`submenu-${subItem.href?.split('/').pop()}`}
                                >
                                  {subActive && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0 -ml-1.5 mr-0.5" />
                                  )}
                                  <subItem.icon className={cn(
                                    "w-3.5 h-3.5 shrink-0 transition-colors duration-200",
                                    subActive ? "text-green-600" : "text-gray-400 group-hover:text-green-600"
                                  )} />
                                  {subItem.label}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  ) : (
                    <Link
                      href={item.href!}
                      className={cn(
                        "group flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-medium rounded-xl transition-all duration-200",
                        isActive(item.href!)
                          ? "text-green-700 bg-green-50 ring-1 ring-inset ring-green-200"
                          : "text-gray-600 hover:text-green-700 hover:bg-green-50",
                      )}
                      data-testid={`menu-${item.href?.split('/').pop() || 'dashboard'}`}
                    >
                      <item.icon className={cn(
                        "w-[17px] h-[17px] shrink-0 transition-colors duration-200",
                        isActive(item.href!) ? "text-green-600" : "text-gray-400 group-hover:text-green-600"
                      )} />
                      {item.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="mx-4 h-px bg-gray-100" />
      {!collapsed && (
        <div className="px-5 py-4">
          <p className="text-[10.5px] text-gray-400 leading-relaxed">
            © {new Date().getFullYear()} T.A.Y. · Transport ABOUBAKAR YARORO
          </p>
          <span className="text-[10.5px] text-gray-400">
            <span className="font-['Pinyon_Script'] text-base text-gray-400 italic">by</span> Trigenys Group
          </span>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className={cn(
          "flex flex-col h-screen sticky top-0 left-0 transition-all duration-300",
          "border-r border-gray-100 bg-white",
          collapsed ? "w-16" : "w-64",
          className,
        )}
      >
        {sidebarContent}
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50 md:hidden"
            onClick={onMobileClose}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-64 flex flex-col h-screen border-r border-gray-100 bg-white md:hidden">
            <button
              onClick={onMobileClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              aria-label="Fermer le menu"
            >
              <X className="h-4 w-4" />
            </button>
            {sidebarContent}
          </div>
        </>
      )}
    </>
  );
};
