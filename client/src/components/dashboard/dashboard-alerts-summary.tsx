import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { listQueryView, readyData } from "@/lib/query-view";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { 
  AlertCircle, 
  AlertTriangle, 
  FileWarning, 
  Gauge, 
  Calendar, 
  Clock, 
  Package,
  ChevronRight
} from "lucide-react";

interface Alert {
  type: string;
  message: string;
  priority: string;
  alertId?: number;
  isRead?: boolean;
  createdAt?: string;
}

interface DatabaseAlert {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  relatedEntity?: string;
  relatedEntityId?: number;
  createdAt: string;
}

export function DashboardAlertsSummary() {
  const [, setLocation] = useLocation();
  
  // Récupérer toutes les alertes depuis la base de données
  const alertsQuery = useQuery<unknown>({
    queryKey: ["/api/alerts"],
  });
  // Alertes illisibles : erreur et « Réessayer », jamais « Aucune alerte récente ».
  const alertsView = listQueryView<DatabaseAlert>(alertsQuery);
  const alertsLoading = alertsView.kind === "loading";
  const allDatabaseAlerts = readyData(alertsView, [] as DatabaseAlert[]);

  // Convertir les alertes de base de données en format uniforme
  const convertedAlerts: Alert[] = allDatabaseAlerts.map((alert: DatabaseAlert) => {
    // Mapper les types d'alertes des triggers vers les types du frontend
    let mappedType = alert.type;
    let mappedPriority = 'medium';
    
    // Déterminer le type et la priorité selon le message et le type
    if (alert.message.includes('Maintenance en retard')) {
      mappedType = 'maintenance_overdue';
      mappedPriority = 'critical';
    } else if (alert.message.includes('Maintenance programmée')) {
      mappedType = 'maintenance_due';
      mappedPriority = 'medium';
    } else if (alert.message.includes('Kilométrage dépassé')) {
      mappedType = 'maintenance_mileage_exceeded';
      mappedPriority = 'critical';
    } else if (alert.message.includes('Kilométrage proche')) {
      mappedType = 'maintenance_mileage_approaching';
      mappedPriority = 'high';
    } else if (alert.message.includes('expirée depuis') || alert.message.includes('expiré depuis')) {
      mappedType = 'document_expired';
      mappedPriority = 'critical';
    } else if (alert.message.includes('expire dans')) {
      mappedType = 'document_expiring';
      mappedPriority = 'high';
    } else if (alert.type === 'work_order') {
      mappedType = alert.message.includes('critique') ? 'work_order_critical' : 'work_order_overdue';
      mappedPriority = 'critical';
    } else if (alert.type === 'fuel') {
      mappedType = 'fuel_alert';
      mappedPriority = alert.message.includes('Budget') ? 'high' : 'medium';
    } else if (alert.message.includes('Pneu') || alert.message.includes('pneu')) {
      mappedType = 'tire_alert';
      mappedPriority = alert.message.includes('critique') ? 'critical' : 'high';
    } else if (alert.type === 'inventory') {
      mappedType = alert.message.includes('critique') ? 'stock_critical' : 'stock_warning';
      mappedPriority = alert.message.includes('critique') ? 'critical' : 'high';
    }

    return {
      type: mappedType,
      message: alert.message,
      priority: mappedPriority,
      alertId: alert.id,
      isRead: alert.isRead,
      createdAt: alert.createdAt
    };
  });

  // Trier par priorité puis par date et prendre les 3 plus récentes
  const priorityOrder = { critical: 3, high: 2, medium: 1, low: 0 };
  const recentAlerts = convertedAlerts
    .sort((a, b) => {
      // Trier d'abord par priorité
      const priorityDiff = (priorityOrder[b.priority as keyof typeof priorityOrder] || 0) - 
                          (priorityOrder[a.priority as keyof typeof priorityOrder] || 0);
      if (priorityDiff !== 0) return priorityDiff;
      
      // Puis par date
      return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
    })
    .slice(0, 3);

  // Compter les alertes par priorité
  const criticalCount = convertedAlerts.filter(alert => alert.priority === 'critical').length;
  const highCount = convertedAlerts.filter(alert => alert.priority === 'high').length;
  const totalCount = convertedAlerts.length;

  // Afficher l'icône appropriée selon le type d'alerte
  const getAlertIcon = (type: string) => {
    switch (type) {
      case 'document_expired':
        return <FileWarning className="h-4 w-4 text-destructive-text" />;
      case 'document_expiring':
        return <FileWarning className="h-4 w-4 text-amber-500" />;
      case 'maintenance_overdue':
        return <Clock className="h-4 w-4 text-destructive-text" />;
      case 'maintenance_due':
        return <Calendar className="h-4 w-4 text-amber-500" />;
      case 'maintenance_mileage_exceeded':
        return <Gauge className="h-4 w-4 text-destructive-text" />;
      case 'maintenance_mileage_approaching':
        return <Gauge className="h-4 w-4 text-amber-500" />;
      case 'stock_critical':
        return <Package className="h-4 w-4 text-destructive-text" />;
      case 'stock_warning':
        return <Package className="h-4 w-4 text-amber-500" />;
      case 'work_order_overdue':
      case 'work_order_critical':
        return <Clock className="h-4 w-4 text-destructive-text" />;
      case 'fuel_alert':
        return <Gauge className="h-4 w-4 text-orange-500" />;
      case 'tire_alert':
        return <AlertTriangle className="h-4 w-4 text-destructive-text" />;
      default:
        return <AlertCircle className="h-4 w-4 text-amber-500" />;
    }
  };
  
  // Obtenir la couleur appropriée selon la priorité
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical':
        return "bg-destructive text-destructive-foreground";
      case 'high':
        return "bg-orange-500 text-white";
      case 'medium':
        return "bg-amber-500 text-white";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'critical': return 'Critique';
      case 'high': return 'Élevée';
      case 'medium': return 'Moyenne';
      default: return 'Faible';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <CardTitle className="text-lg">Alertes récentes</CardTitle>
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {criticalCount} critique{criticalCount > 1 ? 's' : ''}
              </Badge>
            )}
            {highCount > 0 && (
              <Badge className="bg-orange-500 text-white text-xs">
                {highCount} élevée{highCount > 1 ? 's' : ''}
              </Badge>
            )}
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation('/alerts')}
              className="h-8 px-2 text-xs"
            >
              {alertsView.kind === "error" ? "Voir toutes" : `Voir toutes (${totalCount})`}
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {alertsView.kind === "error" ? (
          <InlineQueryError
            error={alertsView.error}
            fallback="Les alertes sont momentanément indisponibles."
            onRetry={() => void alertsQuery.refetch()}
            isRetrying={alertsView.isRetrying}
            data-testid="dashboard-alerts-error"
          />
        ) : alertsLoading ? (
          <div className="flex items-center justify-center h-20">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
          </div>
        ) : recentAlerts && recentAlerts.length > 0 ? (
          <div className="space-y-3">
            {recentAlerts.map((alert: Alert, index: number) => (
              <div key={`recent-${index}`} className="bg-card border rounded-lg p-3 hover:bg-muted/50 transition-colors">
                <div className="flex items-start gap-3">
                  {getAlertIcon(alert.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <Badge className={`${getPriorityColor(alert.priority)} text-xs`}>
                        {getPriorityLabel(alert.priority)}
                      </Badge>
                      {alert.createdAt && (
                        <span className="text-xs text-muted-foreground">
                          {new Date(alert.createdAt).toLocaleDateString('fr-FR')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground line-clamp-2">
                      {alert.message}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6">
            <AlertCircle className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Aucune alerte récente</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}