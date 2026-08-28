import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Building2, ChevronRight, TrendingUp } from "lucide-react";
import { formatPrice } from "@/lib/utils";

interface TopSupplier {
  supplier: {
    id: number;
    name: string;
    qualityRating?: string | null;
    reliabilityRating?: string | null;
  };
  totalSpent: number;
  invoiceCount: number;
}

function RatingDots({ value }: { value?: string | null }) {
  const num = value ? parseFloat(value) : 0;
  const filled = Math.round(num);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i <= filled ? 'bg-emerald-500' : 'bg-muted'}`}
        />
      ))}
    </div>
  );
}

export function SupplierScorecard() {
  const [, setLocation] = useLocation();

  const { data: suppliers = [], isLoading } = useQuery<TopSupplier[]>({
    queryKey: ["/api/suppliers/top", { limit: 5 }],
  });

  const maxSpent = suppliers.length > 0 ? Math.max(...suppliers.map((s) => s.totalSpent)) : 1;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Top fournisseurs
          </CardTitle>
          <span className="text-xs text-muted-foreground">par volume d'achat</span>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 p-6">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : suppliers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Aucun fournisseur</p>
        ) : (
          <div className="divide-y">
            {suppliers.map((item, index) => {
              const barWidth = maxSpent > 0 ? (item.totalSpent / maxSpent) * 100 : 0;
              return (
                <div key={item.supplier.id} className="px-6 py-3 hover:bg-muted/40 transition-colors">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">#{index + 1}</span>
                      <p className="text-sm font-medium truncate">{item.supplier.name}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      {item.supplier.qualityRating && (
                        <RatingDots value={item.supplier.qualityRating} />
                      )}
                      <span className="text-xs text-muted-foreground">{item.invoiceCount} fac.</span>
                      <span className="text-sm font-semibold tabular-nums">
                        {item.totalSpent >= 1_000_000
                          ? `${(item.totalSpent / 1_000_000).toFixed(1)}M`
                          : formatPrice(item.totalSpent)}
                      </span>
                    </div>
                  </div>
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-500"
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="px-6 py-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setLocation('/procurement/suppliers')}
          >
            <TrendingUp className="h-3.5 w-3.5 mr-1" />
            Voir tous les fournisseurs
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
