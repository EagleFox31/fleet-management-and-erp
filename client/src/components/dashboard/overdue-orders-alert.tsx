import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ShoppingCart, ChevronRight, Clock } from "lucide-react";
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

function getUrgencyBadge(days: number, urgency: string) {
  if (days > 30 || urgency === 'critical') return <Badge variant="destructive" className="text-xs">{days}j de retard</Badge>;
  if (days > 7 || urgency === 'high') return <Badge className="bg-orange-500 text-white text-xs">{days}j de retard</Badge>;
  return <Badge className="bg-amber-500 text-white text-xs">{days}j de retard</Badge>;
}

export function OverdueOrdersAlert() {
  const [, setLocation] = useLocation();

  const { data: orders = [], isLoading } = useQuery<OverdueOrder[]>({
    queryKey: ["/api/purchase-orders/overdue"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Commandes en retard</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-16">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (orders.length === 0) {
    return (
      <Card className="border-green-200 bg-green-50/50 dark:bg-green-950/20 dark:border-green-900">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-green-600" />
            <CardTitle className="text-base">Commandes en retard</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-green-600 dark:text-green-400 font-medium">Toutes les livraisons sont dans les délais</p>
        </CardContent>
      </Card>
    );
  }

  const criticalCount = orders.filter(o => o.daysOverdue > 30).length;
  const totalAmount = orders.reduce((sum, o) => sum + parseFloat(o.totalAmountTTC || '0'), 0);
  const top = [...orders].sort((a, b) => b.daysOverdue - a.daysOverdue).slice(0, 3);

  return (
    <Card className="border-purple-200 bg-purple-50/50 dark:bg-purple-950/20 dark:border-purple-900">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-purple-600 dark:text-purple-400" />
            <CardTitle className="text-base">Commandes en retard</CardTitle>
          </div>
          <div className="flex gap-1">
            {criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs">{criticalCount} critique{criticalCount > 1 ? 's' : ''}</Badge>
            )}
            <Badge className="bg-purple-500 text-white text-xs">{orders.length} en retard</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-card border rounded-lg p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <ShoppingCart className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-xs text-muted-foreground">Commandes</span>
            </div>
            <p className="text-xl font-bold text-purple-600 dark:text-purple-400">{orders.length}</p>
          </div>
          <div className="bg-card border rounded-lg p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="h-3.5 w-3.5 text-purple-500" />
              <span className="text-xs text-muted-foreground">Montant</span>
            </div>
            <p className="text-sm font-bold text-purple-600 dark:text-purple-400 leading-tight">
              {formatPrice(Math.round(totalAmount))}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          {top.map((order) => (
            <div key={order.id} className="flex items-center justify-between bg-card border rounded px-2.5 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium">{order.orderNumber}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate">{order.supplierName}</p>
              </div>
              {getUrgencyBadge(order.daysOverdue, order.urgency)}
            </div>
          ))}
          {orders.length > 3 && (
            <p className="text-xs text-muted-foreground pl-1">+{orders.length - 3} autre{orders.length - 3 > 1 ? 's' : ''}...</p>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full border-purple-300 hover:bg-purple-100 dark:border-purple-800 dark:hover:bg-purple-950/40"
          onClick={() => setLocation('/procurement/purchase-orders')}
        >
          Voir toutes les commandes
          <ChevronRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
