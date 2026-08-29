import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { VEHICLE_STATUS_LABELS } from "@shared/constants/vehicle-status";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const FRENCH_SPACE_REGEXP = /[\u202F\u00A0]/g;

function normalizeFrenchSpaces(value: string): string {
  return value.replace(FRENCH_SPACE_REGEXP, " ");
}

// Format a date to a readable string
export function formatDate(date: Date | string | undefined): string {
  if (!date) return "N/A";

  const dateObj = typeof date === "string" ? new Date(date) : date;

  return dateObj.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// Format a number to a readable string with thousands separator
export function formatNumber(value: number | undefined): string {
  if (value === undefined) return "N/A";

  return normalizeFrenchSpaces(new Intl.NumberFormat("fr-FR").format(value));
}

// Format a price to a readable string with currency symbol
export function formatPrice(price: number | string | undefined | null): string {
  if (price === undefined || price === null) return "N/A";

  const numericPrice =
    typeof price === "string"
      ? Number.parseFloat(price.replace(/\s+/g, "").replace(",", ".").replace(/[^\d.\-]/g, ""))
      : price;
  if (!Number.isFinite(numericPrice)) {
    return "N/A";
  }

  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(numericPrice);

  return `${normalizeFrenchSpaces(formatted)} FCFA`;
}

// Format a currency value (alias for formatPrice)
export function formatCurrency(value: number | string | undefined | null): string {
  return formatPrice(value);
}

// Format a distance in kilometers
export function formatDistance(kilometers: number | undefined): string {
  if (kilometers === undefined) return "N/A";

  return `${formatNumber(kilometers)} km`;
}

// Calculate fuel consumption (L/100km)
export function calculateFuelConsumption(
  fuelQuantity: number,
  distance: number,
): number | null {
  if (!fuelQuantity || !distance || distance === 0) return null;

  // L/100km formula = (fuel quantity in liters / distance in km) * 100
  return (fuelQuantity / distance) * 100;
}

// Format fuel consumption
export function formatFuelConsumption(
  consumption: number | null | undefined,
): string {
  if (consumption === null || consumption === undefined) return "N/A";

  return `${consumption.toFixed(2)} L/100km`;
}

// Get status color class based on status string
export const getStatusColor = (status: string): string => {
  switch (status.toLowerCase()) {
    case "operational":
    case "completed":
    case "active":
      return "bg-green-500 text-white dark:bg-green-600 dark:text-white";
    case "maintenance":
    case "in_progress":
      return "bg-blue-500 text-white dark:bg-blue-600 dark:text-white";
    case "pending":
      return "bg-yellow-500 text-white dark:bg-yellow-600 dark:text-white";
    case "awaiting_parts":
      return "bg-amber-500 text-white dark:bg-amber-600 dark:text-white";
    case "out_of_service":
    case "cancelled":
    case "inactive":
      return "bg-black text-white dark:bg-gray-900 dark:text-white";
    case "critical":
    case "high":
      return "bg-red-500 text-white dark:bg-red-600 dark:text-white";
    case "medium":
      return "bg-orange-500 text-white dark:bg-orange-600 dark:text-white";
    case "low":
      return "bg-green-500 text-white dark:bg-green-600 dark:text-white";
    default:
      return "bg-gray-500 text-white dark:bg-gray-600 dark:text-white";
  }
};

// Translate status to French
export const translateStatus = (status: string | undefined): string => {
  if (!status) return "Inconnu";
  
  const statusMap: Record<string, string> = {
    // Statuts véhicule: délégués à la source partagée, que le serveur utilise
    // aussi pour écrire l'historique. Ne pas les recopier ici.
    ...VEHICLE_STATUS_LABELS,
    pending: "En attente",
    in_progress: "En cours",
    awaiting_parts: "Attente pièces",
    completed: "Terminé",
    cancelled: "Annulé",
    critical: "Critique",
    high: "Élevée", 
    medium: "Moyenne",
    low: "Faible",
    active: "Actif",
    inactive: "Inactif",
  };

  return statusMap[status.toLowerCase()] || status;
};

// Translate priority to French
export const translatePriority = (priority: string | undefined): string => {
  if (!priority) return "Non définie";
  
  const priorityMap: Record<string, string> = {
    critical: "Critique",
    high: "Élevée",
    medium: "Moyenne",
    low: "Faible",
  };

  return priorityMap[priority.toLowerCase()] || priority;
};

// Get icon name for navigation items
export const getNavIcon = (key: string): string => {
  const iconMap: Record<string, string> = {
    dashboard: "tachometer-alt",
    vehicles: "truck",
    maintenance: "tools",
    "work-orders": "clipboard-list",
    inventory: "dolly-flatbed",
    fuel: "gas-pump",
    technicians: "users",
    reports: "file-export",
    settings: "cog",
    logout: "sign-out-alt",
  };

  return iconMap[key] || "circle";
};
