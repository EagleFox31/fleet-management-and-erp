import React, { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CardShell,
  HeaderCard,
  KpiTile,
  PremiumDataTable,
  SectionLabel,
  StatusBadge,
  UrgencyBadge,
  type PremiumDataTableColumn,
} from "@/components/design-system";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn, formatDate } from "@/lib/utils";
import { userMessageOf } from "@/lib/api-error";
import { ALERT_READ_ALL_PATH } from "@shared/contracts/alerts";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Eye,
  FileWarning,
  Gauge,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Trash2,
  Truck,
} from "lucide-react";

type AlertPriority = "critical" | "high" | "medium" | "low";
type StatusFilter = "all" | "unread" | "read";
type CategoryFilter =
  | "all"
  | "document"
  | "maintenance"
  | "stock"
  | "work_order"
  | "fuel"
  | "tire"
  | "mission"
  | "other";

interface Alert {
  vehicleId?: number;
  registrationNumber?: string;
  type: string;
  title?: string;
  message: string;
  priority: AlertPriority;
  link?: string;
  documentId?: number;
  alertId?: number;
  isRead?: boolean;
  createdAt?: string;
  relatedPartId?: number;
}

interface DatabaseAlert {
  id: number;
  userId: number | null;
  title: string;
  message: string;
  type: string;
  priority?: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

const priorityRank: Record<AlertPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const normalizePriority = (priority?: string): AlertPriority => {
  if (priority === "critical" || priority === "high" || priority === "medium" || priority === "low") {
    return priority;
  }
  return "medium";
};

const getAlertCategory = (type: string): Exclude<CategoryFilter, "all"> => {
  if (type.startsWith("document_")) return "document";
  if (type.startsWith("maintenance_")) return "maintenance";
  if (type.startsWith("stock_")) return "stock";
  if (type.startsWith("work_order_")) return "work_order";
  if (type === "fuel_alert") return "fuel";
  if (type === "tire_alert") return "tire";
  if (type.startsWith("mission_")) return "mission";
  return "other";
};

const getCategoryLabel = (category: Exclude<CategoryFilter, "all">): string => {
  switch (category) {
    case "document":
      return "Documents";
    case "maintenance":
      return "Entretiens";
    case "stock":
      return "Stock";
    case "work_order":
      return "Ordres";
    case "fuel":
      return "Carburant";
    case "tire":
      return "Pneus";
    case "mission":
      return "Missions";
    default:
      return "Autres";
  }
};

const getAlertTypeLabel = (type: string): string => {
  switch (type) {
    case "document_expired":
      return "Document expiré";
    case "document_expiring":
      return "Document à renouveler";
    case "maintenance_overdue":
      return "Échéance préventive en retard";
    case "maintenance_due":
      return "Échéance préventive proche";
    case "maintenance_mileage_exceeded":
      return "Kilométrage dépassé";
    case "maintenance_mileage_approaching":
      return "Kilométrage proche";
    case "stock_critical":
      return "Stock critique";
    case "stock_warning":
      return "Stock bas";
    case "stock_info":
      return "Stock à surveiller";
    case "work_order_critical":
      return "OT critique";
    case "work_order_overdue":
      return "OT en retard";
    case "fuel_alert":
      return "Alerte carburant";
    case "tire_alert":
      return "Alerte pneus";
    case "mission_departure_overdue":
      return "Retard au départ";
    case "mission_delivery_overdue":
      return "Retard à la livraison";
    default:
      return type;
  }
};

const getAlertIcon = (type: string) => {
  switch (type) {
    case "document_expired":
      return <FileWarning className="h-4 w-4 text-destructive" />;
    case "document_expiring":
      return <FileWarning className="h-4 w-4 text-amber-500" />;
    case "maintenance_overdue":
      return <Clock className="h-4 w-4 text-destructive" />;
    case "maintenance_due":
      return <Calendar className="h-4 w-4 text-amber-500" />;
    case "maintenance_mileage_exceeded":
      return <Gauge className="h-4 w-4 text-destructive" />;
    case "maintenance_mileage_approaching":
      return <Gauge className="h-4 w-4 text-amber-500" />;
    case "stock_critical":
      return <Package className="h-4 w-4 text-destructive" />;
    case "stock_warning":
      return <Package className="h-4 w-4 text-amber-500" />;
    case "stock_info":
      return <Package className="h-4 w-4 text-blue-500" />;
    case "work_order_overdue":
    case "work_order_critical":
      return <Clock className="h-4 w-4 text-destructive" />;
    case "fuel_alert":
      return <Gauge className="h-4 w-4 text-orange-500" />;
    case "tire_alert":
      return <AlertTriangle className="h-4 w-4 text-destructive" />;
    case "mission_departure_overdue":
      return <Truck className="h-4 w-4 text-destructive" />;
    case "mission_delivery_overdue":
      return <Truck className="h-4 w-4 text-orange-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-amber-500" />;
  }
};

const formatAlertDate = (createdAt?: string): string => {
  if (!createdAt) return "Temps réel";
  const date = new Date(createdAt);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return `${formatDate(createdAt)} ${time}`;
};

export function AlertsPanel() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<AlertPriority | "all">("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [processingReadId, setProcessingReadId] = useState<number | null>(null);
  const [processingDeleteId, setProcessingDeleteId] = useState<number | null>(null);
  const [locallyReadAlertIds, setLocallyReadAlertIds] = useState<Set<number>>(new Set());

  const shouldIncludeStockReorderAlerts = [
    "admin",
    "warehouse",
    "logistics",
    "workshop_manager",
  ].includes(user?.role || "");

  const { data: allDatabaseAlerts, isLoading: alertsLoading, refetch: refetchAlerts } = useQuery<DatabaseAlert[]>({
    queryKey: ["/api/alerts"],
  });

  const {
    data: reorderAlertsData,
    isLoading: reorderAlertsLoading,
    refetch: refetchReorderAlerts,
  } = useQuery<any>({
    queryKey: ["/api/warehouse/reorder-alerts"],
    enabled: shouldIncludeStockReorderAlerts,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/alerts/${id}/read`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", ALERT_READ_ALL_PATH, {});
    },
    onSuccess: () => {
      // Couche 1 : la cloche et la liste passent à « lu » sans attendre le refetch.
      queryClient.setQueryData<DatabaseAlert[]>(["/api/alerts"], (current) =>
        Array.isArray(current) ? current.map((alert) => ({ ...alert, isRead: true })) : current,
      );
      queryClient.setQueryData<DatabaseAlert[]>(["/api/alerts/unread"], (current) =>
        Array.isArray(current) ? [] : current,
      );
      queryClient.setQueryData<any>(["/api/alerts/count"], (current: any) =>
        current && typeof current === "object" ? { ...current, unread: 0 } : current,
      );
      // Couche 3 : resync des écrans qui lisent les alertes.
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
    },
    onError: (error) => {
      toast({
        title: "Échec du marquage",
        description: userMessageOf(error, "Impossible de marquer les alertes comme lues."),
        variant: "destructive",
      });
    },
  });

  const unreadPersistedCount = Array.isArray(allDatabaseAlerts)
    ? allDatabaseAlerts.filter((alert) => !alert.isRead).length
    : 0;

  const deleteAlertMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/alerts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });
    },
  });

  const convertedAlerts = useMemo<Alert[]>(() => {
    if (!Array.isArray(allDatabaseAlerts)) return [];

    return allDatabaseAlerts.map((alert) => {
      let mappedType = alert.type;
      let mappedPriority = normalizePriority(alert.priority);
      const lowerMessage = (alert.message || "").toLowerCase();

      if (lowerMessage.includes("maintenance en retard")) {
        mappedType = "maintenance_overdue";
        mappedPriority = "critical";
      } else if (lowerMessage.includes("maintenance programmée")) {
        mappedType = "maintenance_due";
      } else if (lowerMessage.includes("kilométrage dépassé")) {
        mappedType = "maintenance_mileage_exceeded";
        mappedPriority = "critical";
      } else if (lowerMessage.includes("kilométrage proche")) {
        mappedType = "maintenance_mileage_approaching";
        mappedPriority = mappedPriority === "critical" ? "critical" : "high";
      } else if (lowerMessage.includes("expirée depuis") || lowerMessage.includes("expiré depuis")) {
        mappedType = "document_expired";
        mappedPriority = "critical";
      } else if (lowerMessage.includes("expire dans")) {
        mappedType = "document_expiring";
        mappedPriority = mappedPriority === "critical" ? "critical" : "high";
      } else if (alert.type === "work_order") {
        mappedType = lowerMessage.includes("critique") ? "work_order_critical" : "work_order_overdue";
        mappedPriority = mappedPriority === "medium" ? "high" : mappedPriority;
      } else if (alert.type === "fuel") {
        mappedType = "fuel_alert";
        mappedPriority = lowerMessage.includes("budget") ? "high" : mappedPriority;
      } else if (lowerMessage.includes("pneu")) {
        mappedType = "tire_alert";
        mappedPriority = lowerMessage.includes("critique") ? "critical" : "high";
      } else if (alert.type === "inventory") {
        mappedType = lowerMessage.includes("rupture") || lowerMessage.includes("critique")
          ? "stock_critical"
          : "stock_warning";
        mappedPriority = mappedType === "stock_critical" ? "critical" : (mappedPriority === "low" ? "high" : mappedPriority);
      } else if (alert.type === "mission") {
        mappedType = lowerMessage.includes("départ") || lowerMessage.includes("depart")
          ? "mission_departure_overdue"
          : "mission_delivery_overdue";
      }

      return {
        type: mappedType,
        title: alert.title,
        message: alert.message,
        priority: mappedPriority,
        alertId: alert.id,
        isRead: alert.isRead,
        createdAt: alert.createdAt,
        link: alert.link || undefined,
      };
    });
  }, [allDatabaseAlerts]);

  const convertedReorderAlerts = useMemo<Alert[]>(() => {
    if (!shouldIncludeStockReorderAlerts || !Array.isArray(reorderAlertsData?.parts)) {
      return [];
    }

    return reorderAlertsData.parts.map((part: any) => {
      const quantity = Number(part.quantity || 0);
      const minQuantity = Number(part.minQuantity || 0);
      const shortage = Number(part.shortage || 0);

      let priority: AlertPriority = "high";
      let type = "stock_warning";

      if (quantity <= 0) {
        priority = "critical";
        type = "stock_critical";
      } else if (quantity > minQuantity) {
        priority = "medium";
        type = "stock_info";
      }

      const shortageText = shortage > 0 ? ` - manque ${shortage} unité(s)` : "";

      return {
        type,
        priority,
        title: "Alerte réapprovisionnement",
        message: `${part.name} (${part.reference}): stock ${quantity}/${minQuantity}${shortageText}`,
        relatedPartId: part.id,
        link: part.id ? `/inventory/${part.id}` : "/inventory",
        isRead: false,
      };
    });
  }, [reorderAlertsData, shouldIncludeStockReorderAlerts]);

  const allAlerts = useMemo(() => {
    return [...convertedReorderAlerts, ...convertedAlerts];
  }, [convertedAlerts, convertedReorderAlerts]);

  const counts = useMemo(() => {
    const byCategory = {
      document: 0,
      maintenance: 0,
      stock: 0,
      work_order: 0,
      fuel: 0,
      tire: 0,
      mission: 0,
      other: 0,
    };
    let critical = 0;

    for (const alert of allAlerts) {
      const category = getAlertCategory(alert.type);
      byCategory[category] += 1;
      if (alert.priority === "critical") {
        critical += 1;
      }
    }

    return {
      total: allAlerts.length,
      critical,
      byCategory,
    };
  }, [allAlerts]);

  const filteredAlerts = useMemo(() => {
    const searchLower = search.trim().toLowerCase();

    return [...allAlerts]
      .filter((alert) => {
        const alertCategory = getAlertCategory(alert.type);
        const readStatus = alert.alertId ? Boolean(alert.isRead) : false;
        const searchableText = [
          alert.title,
          alert.message,
          alert.registrationNumber,
          getAlertTypeLabel(alert.type),
          getCategoryLabel(alertCategory),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const matchesSearch = !searchLower || searchableText.includes(searchLower);
        const matchesCategory = categoryFilter === "all" || alertCategory === categoryFilter;
        const matchesPriority = priorityFilter === "all" || alert.priority === priorityFilter;
        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "read" && readStatus) ||
          (statusFilter === "unread" && !readStatus);

        return matchesSearch && matchesCategory && matchesPriority && matchesStatus;
      })
      .sort((a, b) => {
        const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        if (bDate !== aDate) {
          return bDate - aDate;
        }
        return priorityRank[a.priority] - priorityRank[b.priority];
      });
  }, [allAlerts, categoryFilter, priorityFilter, search, statusFilter]);

  const isLoading = alertsLoading || (shouldIncludeStockReorderAlerts && reorderAlertsLoading);

  const handleRefresh = () => {
    refetchAlerts();
    if (shouldIncludeStockReorderAlerts) {
      refetchReorderAlerts();
    }
  };

  const handleMarkAsRead = async (alertId?: number) => {
    if (!alertId) return;
    try {
      setProcessingReadId(alertId);
      await markAsReadMutation.mutateAsync(alertId);
      setLocallyReadAlertIds((previous) => {
        const next = new Set(previous);
        next.add(alertId);
        return next;
      });
      queryClient.setQueryData<DatabaseAlert[]>(["/api/alerts"], (currentAlerts) => {
        if (!Array.isArray(currentAlerts)) return currentAlerts;
        return currentAlerts.map((alert) =>
          alert.id === alertId ? { ...alert, isRead: true } : alert,
        );
      });
      queryClient.setQueryData<DatabaseAlert[]>(["/api/alerts/unread"], (currentAlerts) => {
        if (!Array.isArray(currentAlerts)) return currentAlerts;
        return currentAlerts.filter((alert) => alert.id !== alertId);
      });
      queryClient.setQueryData<any>(["/api/alerts/count"], (currentCount) => {
        if (!currentCount || typeof currentCount !== "object") return currentCount;
        const currentUnread = Number(currentCount.unread || 0);
        return {
          ...currentCount,
          unread: Math.max(0, currentUnread - 1),
        };
      });
      await refetchAlerts();
    } catch (error) {
      console.error("Mark alert as read error:", error);
      toast({
        title: "Échec du marquage",
        description:
          error instanceof Error
            ? error.message
            : "Impossible de marquer cette alerte comme lue.",
        variant: "destructive",
      });
    } finally {
      setProcessingReadId(null);
    }
  };

  const handleDelete = async (alertId?: number) => {
    if (!alertId) return;
    try {
      setProcessingDeleteId(alertId);
      await deleteAlertMutation.mutateAsync(alertId);
      setLocallyReadAlertIds((previous) => {
        const next = new Set(previous);
        next.delete(alertId);
        return next;
      });
      queryClient.setQueryData<DatabaseAlert[]>(["/api/alerts"], (currentAlerts) => {
        if (!Array.isArray(currentAlerts)) return currentAlerts;
        return currentAlerts.filter((alert) => alert.id !== alertId);
      });
      queryClient.setQueryData<DatabaseAlert[]>(["/api/alerts/unread"], (currentAlerts) => {
        if (!Array.isArray(currentAlerts)) return currentAlerts;
        return currentAlerts.filter((alert) => alert.id !== alertId);
      });
      await refetchAlerts();
      toast({
        title: "Alerte supprimée",
      });
    } catch (error) {
      console.error("Delete alert error:", error);
      toast({
        title: "Échec de suppression",
        description:
          userMessageOf(error, "Impossible de supprimer cette alerte."),
        variant: "destructive",
      });
    } finally {
      setProcessingDeleteId(null);
    }
  };

  const resolveAlertPath = (alert: Alert): string => {
    if (alert.link) return alert.link;
    if (alert.vehicleId) return `/vehicles/${alert.vehicleId}`;
    if (alert.relatedPartId) return `/inventory/${alert.relatedPartId}`;

    switch (getAlertCategory(alert.type)) {
      case "stock":
        return "/inventory";
      case "maintenance":
        return "/maintenance/schedules";
      case "work_order":
        return "/maintenance/work-orders";
      case "fuel":
        return "/fuel";
      case "document":
        return "/vehicles";
      case "mission":
        return "/operations/missions";
      default:
        return "/alerts";
    }
  };

  const getSourceLabel = (alert: Alert): string => {
    if (alert.registrationNumber) return alert.registrationNumber;
    if (alert.relatedPartId) return `Pièce #${alert.relatedPartId}`;
    if (getAlertCategory(alert.type) === "stock") return "Inventaire";
    return "Système";
  };

  const getOperationalContext = (alert: Alert): string | null => {
    switch (alert.type) {
      case "maintenance_overdue":
        return "Déclencheur: date de maintenance préventive dépassée (pas une panne déclarée).";
      case "maintenance_due":
        return "Déclencheur: date préventive proche, préparer l'OT atelier.";
      case "maintenance_mileage_exceeded":
        return "Déclencheur: seuil kilométrique de maintenance dépassé.";
      case "maintenance_mileage_approaching":
        return "Déclencheur: seuil kilométrique proche, anticiper la planification.";
      case "work_order_overdue":
      case "work_order_critical":
        return "Action atelier: ouvrir l'OT, assigner si besoin, puis démarrer/traiter.";
      case "document_expired":
      case "document_expiring":
        return "Conformité documentaire: traiter en demande administrative (renouvellement).";
      case "mission_departure_overdue":
        return "Action logistics: contacter le chauffeur assigné et mettre à jour le statut de la mission.";
      case "mission_delivery_overdue":
        return "Action logistics: vérifier la position du véhicule et alerter le client si nécessaire.";
      default:
        return null;
    }
  };

  const isPersistedAlert = (alert: Alert) => typeof alert.alertId === "number";
  const isAlertRead = (alert: Alert) => {
    if (!isPersistedAlert(alert) || typeof alert.alertId !== "number") return false;
    return Boolean(alert.isRead) || locallyReadAlertIds.has(alert.alertId);
  };

  const columns: PremiumDataTableColumn<Alert>[] = [
    {
      id: "date",
      header: "Date",
      widthClassName: "w-[165px]",
      cell: (alert) => (
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <Calendar className="h-3.5 w-3.5 text-gray-400" />
          {formatAlertDate(alert.createdAt)}
        </span>
      ),
    },
    {
      id: "type",
      header: "Type",
      widthClassName: "w-[200px]",
      cell: (alert) => (
        <div className="inline-flex items-center gap-2">
          {getAlertIcon(alert.type)}
          <span className="text-sm font-medium text-gray-700">{getAlertTypeLabel(alert.type)}</span>
        </div>
      ),
    },
    {
      id: "priority",
      header: "Priorite",
      widthClassName: "w-[130px]",
      cell: (alert) => <UrgencyBadge urgency={alert.priority} />,
    },
    {
      id: "source",
      header: "Source",
      widthClassName: "w-[120px]",
      cell: (alert) => <span className="text-sm text-gray-700">{getSourceLabel(alert)}</span>,
    },
    {
      id: "message",
      header: "Message",
      cell: (alert) => {
        const operationalContext = getOperationalContext(alert);
        return (
          <div className="max-w-[560px]">
            <p className="text-sm text-gray-800 line-clamp-2">{alert.message}</p>
            {operationalContext ? (
              <p className="text-xs text-gray-500 mt-1 line-clamp-2">{operationalContext}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Statut",
      widthClassName: "w-[130px]",
      cell: (alert) => {
        if (!isPersistedAlert(alert)) {
          return <StatusBadge status="draft" label="Temps reel" />;
        }

        return isAlertRead(alert) ? (
          <StatusBadge status="completed" label="Lu" />
        ) : (
          <StatusBadge status="pending" label="Non lu" />
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      widthClassName: "w-[260px]",
      cell: (alert) => {
        const isRead = isAlertRead(alert);
        const isReading = processingReadId === alert.alertId;
        const isDeleting = processingDeleteId === alert.alertId;

        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-gray-600 hover:text-gray-900"
              onClick={() => setLocation(resolveAlertPath(alert))}
            >
              <Eye className="h-3.5 w-3.5 mr-1" />
              Voir
            </Button>

            {isPersistedAlert(alert) && !isRead ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-emerald-700 hover:text-emerald-800"
                onClick={() => handleMarkAsRead(alert.alertId)}
                disabled={isReading || isDeleting}
              >
                {isReading ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5 mr-1" />
                )}
                Marquer lu
              </Button>
            ) : null}

            {isPersistedAlert(alert) ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-red-600 hover:text-red-700"
                onClick={() => handleDelete(alert.alertId)}
                disabled={isDeleting || isReading}
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                )}
                Supprimer
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-5">
        <CardShell topBar>
          <div className="px-6 py-5 space-y-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-8 w-72" />
            <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-3">
              {Array.from({ length: 9 }).map((_, index) => (
                <Skeleton key={`alerts-kpi-${index}`} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
        </CardShell>

        <CardShell>
          <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={`alerts-filter-${index}`} className="h-9 rounded-lg" />
            ))}
          </div>
        </CardShell>

        <CardShell>
          <div className="px-5 py-10">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-green-600 border-t-transparent mx-auto" />
          </div>
        </CardShell>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Monitoring · Alertes"
        title="Centre d'alertes"
        subtitle="Suivi centralise des alertes operationnelles et systeme"
        icon={<AlertCircle className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => markAllAsReadMutation.mutate()}
              disabled={unreadPersistedCount === 0 || markAllAsReadMutation.isPending}
              className="h-8 gap-2 text-xs"
              data-testid="button-mark-all-alerts-read"
            >
              {markAllAsReadMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
              Tout marquer lu
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh} className="h-8 gap-2 text-xs">
              <RefreshCw className="h-3.5 w-3.5" />
              Actualiser
            </Button>
          </div>
        }
      >
        <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-9 gap-3">
          <KpiTile
            label="Total"
            onClick={() => {
              setCategoryFilter("all");
              setPriorityFilter("all");
            }}
            value={counts.total}
            icon={<AlertCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            label="Critiques"
            onClick={() =>
              setPriorityFilter((actuel) => (actuel === "critical" ? "all" : "critical"))
            }
            className={priorityFilter === "critical" ? "ring-2 ring-red-300" : undefined}
            value={counts.critical}
            icon={<AlertTriangle className="h-4 w-4" />}
            iconWrapperClassName="bg-red-50 text-red-600"
            valueClassName={counts.critical > 0 ? "text-red-700" : undefined}
          />
          <KpiTile
            label="Documents"
            onClick={() =>
              setCategoryFilter((actuel) => (actuel === "document" ? "all" : "document"))
            }
            className={categoryFilter === "document" ? "ring-2 ring-gray-300" : undefined}
            value={counts.byCategory.document}
            icon={<FileWarning className="h-4 w-4" />}
            iconWrapperClassName="bg-amber-50 text-amber-600"
          />
          <KpiTile
            label="Entretiens"
            onClick={() =>
              setCategoryFilter((actuel) => (actuel === "maintenance" ? "all" : "maintenance"))
            }
            className={categoryFilter === "maintenance" ? "ring-2 ring-gray-300" : undefined}
            value={counts.byCategory.maintenance}
            icon={<Gauge className="h-4 w-4" />}
            iconWrapperClassName="bg-sky-50 text-sky-600"
          />
          <KpiTile
            label="Ordres"
            onClick={() =>
              setCategoryFilter((actuel) => (actuel === "work_order" ? "all" : "work_order"))
            }
            className={categoryFilter === "work_order" ? "ring-2 ring-gray-300" : undefined}
            value={counts.byCategory.work_order}
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
          />
          <KpiTile
            label="Carburant"
            onClick={() =>
              setCategoryFilter((actuel) => (actuel === "fuel" ? "all" : "fuel"))
            }
            className={categoryFilter === "fuel" ? "ring-2 ring-gray-300" : undefined}
            value={counts.byCategory.fuel}
            icon={<Gauge className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
          />
          <KpiTile
            label="Stock"
            onClick={() =>
              setCategoryFilter((actuel) => (actuel === "stock" ? "all" : "stock"))
            }
            className={categoryFilter === "stock" ? "ring-2 ring-gray-300" : undefined}
            value={counts.byCategory.stock}
            icon={<Package className="h-4 w-4" />}
            iconWrapperClassName="bg-yellow-50 text-yellow-600"
          />
          <KpiTile
            label="Pneus"
            onClick={() =>
              setCategoryFilter((actuel) => (actuel === "tire" ? "all" : "tire"))
            }
            className={categoryFilter === "tire" ? "ring-2 ring-gray-300" : undefined}
            value={counts.byCategory.tire}
            icon={<AlertTriangle className="h-4 w-4" />}
            iconWrapperClassName="bg-rose-50 text-rose-600"
          />
          <KpiTile
            label="Missions"
            onClick={() =>
              setCategoryFilter((actuel) => (actuel === "mission" ? "all" : "mission"))
            }
            className={categoryFilter === "mission" ? "ring-2 ring-gray-300" : undefined}
            value={counts.byCategory.mission}
            icon={<Truck className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
            valueClassName={counts.byCategory.mission > 0 ? "text-purple-700" : undefined}
          />
        </div>
      </HeaderCard>

      <CardShell>
        <div className="px-5 py-4">
          <SectionLabel className="mb-3 inline-block">Filtres</SectionLabel>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher dans les alertes..."
                className="h-9 pl-9 border-gray-200 bg-gray-50"
              />
            </div>

            <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as CategoryFilter)}>
              <SelectTrigger className="h-9 border-gray-200 bg-gray-50">
                <SelectValue placeholder="Catégorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes catégories</SelectItem>
                <SelectItem value="document">Documents</SelectItem>
                <SelectItem value="maintenance">Entretiens</SelectItem>
                <SelectItem value="stock">Stock</SelectItem>
                <SelectItem value="work_order">Ordres de travail</SelectItem>
                <SelectItem value="fuel">Carburant</SelectItem>
                <SelectItem value="tire">Pneus</SelectItem>
                <SelectItem value="mission">Missions</SelectItem>
                <SelectItem value="other">Autres</SelectItem>
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as AlertPriority | "all")}>
              <SelectTrigger className="h-9 border-gray-200 bg-gray-50">
                <SelectValue placeholder="Priorité" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes priorités</SelectItem>
                <SelectItem value="critical">Critique</SelectItem>
                <SelectItem value="high">Haute</SelectItem>
                <SelectItem value="medium">Moyenne</SelectItem>
                <SelectItem value="low">Faible</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger className="h-9 border-gray-200 bg-gray-50">
                <SelectValue placeholder="Statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous statuts</SelectItem>
                <SelectItem value="unread">Non lus</SelectItem>
                <SelectItem value="read">Lus</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardShell>

      <PremiumDataTable
        columns={columns}
        rows={filteredAlerts}
        rowKey={(alert, index) => alert.alertId ?? `${alert.type}-${alert.relatedPartId ?? "na"}-${index}`}
        rowClassName={(alert, index) =>
          cn(
            index % 2 === 0 ? "bg-white" : "bg-gray-50/35",
            alert.priority === "critical" && "bg-red-50/60 hover:bg-red-50",
          )
        }
        toolbar={<div className="text-sm text-gray-500">Liste des alertes ({filteredAlerts.length})</div>}
        emptyState={
          <div className="flex flex-col items-center justify-center text-center py-6">
            <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
            <p className="text-sm font-medium text-gray-700">Tout est à jour</p>
            <p className="text-xs text-gray-400 mt-1">Aucune alerte ne correspond aux filtres.</p>
          </div>
        }
      />
    </div>
  );
}
