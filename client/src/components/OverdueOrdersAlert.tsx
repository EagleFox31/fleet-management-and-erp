import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Clock, Package, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/utils";

interface OverdueOrder {
  id: number;
  orderNumber: string;
  supplierId: number;
  supplierName: string;
  expectedDeliveryDate: string;
  daysOverdue: number;
  status: string;
  totalAmountTTC: string;
  urgency: string;
}

interface OverdueOrdersAlertProps {
  userRole: string;
}

export function OverdueOrdersAlert({ userRole }: OverdueOrdersAlertProps) {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [hasShown, setHasShown] = useState(false);

  // Seuls ces rôles voient les alertes de commandes fournisseur en retard
  // - Magasinier : réceptionne et relance les fournisseurs
  // - Admin : vision globale
  // - Secrétaire : gestion administrative des relances
  const canViewAlerts = ['admin', 'warehouse', 'secretary'].includes(userRole);

  const { data: overdueOrders = [], isLoading } = useQuery<OverdueOrder[]>({
    queryKey: ['/api/purchase-orders/overdue'],
    enabled: canViewAlerts, // Ne charger que si le rôle a accès
    refetchInterval: 5 * 60 * 1000, // Recharger toutes les 5 minutes
  });

  // Afficher le modal automatiquement à la connexion s'il y a des retards
  useEffect(() => {
    if (!isLoading && canViewAlerts && overdueOrders.length > 0 && !hasShown) {
      setOpen(true);
      setHasShown(true);
    }
  }, [isLoading, canViewAlerts, overdueOrders.length, hasShown]);

  // Fermer automatiquement le modal si plus aucune commande en retard
  useEffect(() => {
    if (overdueOrders.length === 0 && open) {
      setOpen(false);
      setHasShown(false); // Réinitialiser pour la prochaine fois
    }
  }, [overdueOrders.length, open]);

  // Ne rien afficher si l'utilisateur n'a pas accès
  if (!canViewAlerts) {
    return null;
  }

  // Ne rien afficher s'il n'y a pas de commandes en retard
  if (overdueOrders.length === 0) {
    return null;
  }

  const totalRetard = overdueOrders.reduce((sum, order) => sum + order.daysOverdue, 0);
  const criticalOrders = overdueOrders.filter(o => o.daysOverdue > 7).length;

  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'default';
      default: return 'secondary';
    }
  };

  const getSeverityBadge = (days: number) => {
    if (days > 14) return { text: 'Critique', variant: 'destructive' as const };
    if (days > 7) return { text: 'Urgent', variant: 'destructive' as const };
    if (days > 3) return { text: 'Important', variant: 'default' as const };
    return { text: 'Attention', variant: 'secondary' as const };
  };

  const goToOrder = (orderId: number) => {
    setOpen(false);
    setLocation(`/procurement/orders/${orderId}`);
  };

  const goToOrders = () => {
    setOpen(false);
    setLocation('/procurement/orders');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col" data-testid="modal-overdue-orders">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-destructive/10 rounded-full">
              <AlertTriangle className="h-6 w-6 text-destructive-text" />
            </div>
            <div>
              <DialogTitle className="text-xl">
                Alerte : Commandes en Retard de Livraison
              </DialogTitle>
              <DialogDescription>
                {overdueOrders.length} commande{overdueOrders.length > 1 ? 's' : ''} n'ont pas été livrée{overdueOrders.length > 1 ? 's' : ''} à temps
                {criticalOrders > 0 && (
                  <span className="text-destructive-text font-medium">
                    {' '}· {criticalOrders} critique{criticalOrders > 1 ? 's' : ''} (+7 jours)
                  </span>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Résumé des retards */}
        <Alert className="bg-destructive/5 border-destructive/20">
          <Clock className="h-4 w-4 text-destructive-text" />
          <AlertDescription className="ml-2">
            <strong>Retard total : {totalRetard} jours</strong>
            {' · '}Retard moyen : {Math.round(totalRetard / overdueOrders.length)} jours par commande
          </AlertDescription>
        </Alert>

        {/* Liste des commandes en retard */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {overdueOrders.map((order) => {
            const severity = getSeverityBadge(order.daysOverdue);
            
            return (
              <div
                key={order.id}
                className="border rounded-lg p-4 hover:bg-accent/50 transition-colors cursor-pointer"
                onClick={() => goToOrder(order.id)}
                data-testid={`overdue-order-${order.id}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{order.orderNumber}</span>
                    <Badge variant={severity.variant}>{severity.text}</Badge>
                    <Badge variant={getUrgencyColor(order.urgency)}>
                      {order.urgency}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      goToOrder(order.id);
                    }}
                    data-testid={`button-view-order-${order.id}`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Fournisseur :</span>
                    <span className="font-medium">{order.supplierName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Date prévue :</span>
                    <span>{new Date(order.expectedDeliveryDate).toLocaleDateString('fr-FR')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Jours de retard :</span>
                    <span className="font-bold text-destructive-text">
                      {order.daysOverdue} jour{order.daysOverdue > 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Montant TTC :</span>
                    <span className="font-medium">
                      {formatPrice(parseFloat(order.totalAmountTTC))}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => setOpen(false)} data-testid="button-dismiss">
            Fermer
          </Button>
          <Button onClick={goToOrders} data-testid="button-view-all">
            Voir toutes les commandes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
