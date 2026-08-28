import React from "react";
import { useLocation } from "wouter";
import { ChevronRight, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BreadcrumbItem {
  label: string;
  href?: string;
  isActive?: boolean;
}

interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumb: React.FC<BreadcrumbProps> = ({ items, className }) => {
  const [location, setLocation] = useLocation();

  // Générer automatiquement les breadcrumbs basés sur l'URL
  const generateBreadcrumbs = (): BreadcrumbItem[] => {
    if (items) return items;

    const pathSegments = location.split('/').filter(Boolean);
    const breadcrumbs: BreadcrumbItem[] = [];

    // Accueil
    breadcrumbs.push({
      label: "Accueil",
      href: "/dashboard"
    });

    // Configuration des labels pour chaque segment
    const segmentLabels: Record<string, string> = {
      dashboard: "Tableau de bord",
      vehicles: "Véhicules", 
      maintenance: "Maintenance",
      "work-orders": "Ordres de travail",
      interventions: "Interventions",
      schedules: "Planification",
      "fault-catalog": "Catalogue d'interventions",
      inventory: "Inventaire",
      parts: "Pièces détachées",
      fuel: "Carburant",
      technicians: "Techniciens",
      reports: "Rapports",
      settings: "Paramètres",
      users: "Utilisateurs"
    };

    let currentPath = "";
    pathSegments.forEach((segment, index) => {
      currentPath += `/${segment}`;
      const isLast = index === pathSegments.length - 1;

      // Vérifier si c'est un ID numérique
      if (/^\d+$/.test(segment)) {
        // C'est un ID, on ne l'affiche pas comme segment
        return;
      }

      const label = segmentLabels[segment] || segment;
      
      breadcrumbs.push({
        label,
        href: isLast ? undefined : currentPath,
        isActive: isLast
      });
    });

    return breadcrumbs;
  };

  const breadcrumbItems = generateBreadcrumbs();

  if (breadcrumbItems.length < 2) return null;

  return (
    <nav className={`flex items-center space-x-2 text-sm text-muted-foreground ${className || ""}`}>
      {breadcrumbItems.map((item, index) => (
        <React.Fragment key={index}>
          {index > 0 && <ChevronRight className="h-4 w-4" />}
          
          {item.href ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto p-0 font-normal hover:text-foreground transition-colors"
              onClick={() => setLocation(item.href!)}
            >
              {index === 0 && <Home className="h-4 w-4 mr-1" />}
              {item.label}
            </Button>
          ) : (
            <span className="text-foreground font-medium flex items-center">
              {index === 0 && <Home className="h-4 w-4 mr-1" />}
              {item.label}
            </span>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
};