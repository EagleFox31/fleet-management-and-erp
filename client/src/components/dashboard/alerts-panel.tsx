import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AlertItem {
  id: number;
  title: string;
  message: string;
  type: "maintenance" | "inventory" | "work_order" | "fuel";
  priority: "low" | "medium" | "high" | "critical";
  isRead: boolean;
  link?: string;
  createdAt: string;
}

interface AlertsPanelProps {
  alerts: AlertItem[];
  onMarkAsRead?: (id: number) => void;
  onViewAllClick?: () => void;
  className?: string;
}

export function AlertsPanel({
  alerts,
  onMarkAsRead,
  onViewAllClick,
  className,
}: AlertsPanelProps) {
  const getAlertIcon = (type: string): string => {
    switch (type) {
      case "maintenance":
        return "calendar-alt";
      case "inventory":
        return "dolly-flatbed";
      case "work_order":
        return "tools";
      case "fuel":
        return "gas-pump";
      default:
        return "exclamation-triangle";
    }
  };
  
  const getAlertStyle = (priority: string): string => {
    switch (priority) {
      case "critical":
        return "bg-warning/5 border-warning/20";
      case "high":
        return "bg-warning/5 border-warning/20";
      case "medium":
        return "bg-secondary/5 border-secondary/20";
      case "low":
        return "bg-primary/5 border-primary/20";
      default:
        return "bg-muted/20 border-muted/20";
    }
  };
  
  const getIconStyle = (priority: string): string => {
    switch (priority) {
      case "critical":
        return "bg-warning/10 text-warning";
      case "high":
        return "bg-warning/10 text-warning";
      case "medium":
        return "bg-secondary/10 text-secondary";
      case "low":
        return "bg-primary/10 text-primary";
      default:
        return "bg-muted/30 text-muted-foreground";
    }
  };
  
  return (
    <Card className={cn(className)}>
      <CardHeader className="px-6 pb-0">
        <div className="flex items-center justify-between mb-4">
          <CardTitle className="text-lg font-semibold">Alertes</CardTitle>
          <Button variant="link" onClick={onViewAllClick} className="p-0 h-auto">
            Tout voir
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="space-y-4">
          {alerts.length === 0 ? (
            <div className="text-center py-8">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-muted/20">
                <i className="fas fa-check text-muted-foreground"></i>
              </div>
              <h3 className="mt-2 text-sm font-medium text-foreground">Aucune alerte</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Tout est en ordre pour le moment.
              </p>
            </div>
          ) : (
            alerts.map((alert) => (
              <div
                key={alert.id}
                className={cn(
                  "flex items-start p-3 rounded-md border",
                  getAlertStyle(alert.priority)
                )}
                onClick={() => onMarkAsRead && onMarkAsRead(alert.id)}
              >
                <div className={cn(
                  "flex-shrink-0 p-2 rounded-md",
                  getIconStyle(alert.priority)
                )}>
                  <i className={`fas fa-${getAlertIcon(alert.type)}`}></i>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-foreground">{alert.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
