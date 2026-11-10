import { userMessageOf } from "@/lib/api-error";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { canManagePartsPurchaseOrders } from "@shared/constants/roles";
import { TrendingUp, Package, CheckCircle, AlertTriangle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatPrice } from "@/lib/utils";
import { listQueryView, readyData } from "@/lib/query-view";
import { InlineQueryError } from "@/components/ui/inline-query-error";

interface GroupSuggestion {
  supplierId: number;
  supplierName: string;
  requirements: Array<{
    id: number;
    quantityNeeded: number;
    reason: string;
    urgency: string;
    partName?: string;
    estimatedPrice?: number;
  }>;
  totalEstimatedCost: number;
  urgencyLevel: string;
  recommendedDiscount: number;
}

interface OptimizationResult {
  shouldOrderNow: boolean;
  reason: string;
  potentialSavings: number;
  waitDays?: number;
}

const urgencyConfig: Record<string, { label: string; color: string }> = {
  low: { label: "Faible", color: "bg-blue-100 text-blue-800" },
  medium: { label: "Moyenne", color: "bg-yellow-100 text-yellow-800" },
  high: { label: "Haute", color: "bg-orange-100 text-orange-800" },
  critical: { label: "Critique", color: "bg-red-100 text-red-800" },
};

export default function GroupPurchaseOrdersPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [minRequirements, setMinRequirements] = useState(2);
  const [maxDaysOld, setMaxDaysOld] = useState(30);
  const [urgencyThreshold, setUrgencyThreshold] = useState<string>("medium");
  const [selectedGroup, setSelectedGroup] = useState<number | null>(null);

  // Charger les suggestions de regroupement
  // Regroupement = commandes de pièces atelier : la logistique (hors périmètre, 403 serveur)
  // reçoit une explication, pas un encart d'erreur permanent.
  const { user } = useAuth();
  const canGroup = canManagePartsPurchaseOrders(user?.role);
  const suggestionsQuery = useQuery<GroupSuggestion[]>({
    queryKey: ["/api/purchase-orders/group-suggestions", { minRequirements, maxDaysOld, urgencyThreshold }],
    enabled: canGroup,
  });
  // Échec sans données : message et « Réessayer », jamais « Aucune suggestion » ni « (0) ».
  const suggestionsView = listQueryView<GroupSuggestion>(suggestionsQuery);
  const suggestions = readyData(suggestionsView, [] as GroupSuggestion[]);
  const suggestionsFailed = suggestionsView.kind === "error";
  const isLoading = suggestionsQuery.isLoading;

  // Charger l'optimisation de timing pour le groupe sélectionné
  const { data: optimization } = useQuery<OptimizationResult>({
    queryKey: [`/api/purchase-orders/optimize-timing/${selectedGroup}`],
    enabled: !!selectedGroup,
  });

  // Mutation pour créer une commande groupée
  const createOrderMutation = useMutation({
    mutationFn: async (data: { supplierId: number; requirementIds: number[]; discountPercentage: number }) => {
      const res = await apiRequest("POST", "/api/purchase-orders", data);
      return await res.json();
    },
    onSuccess: (order: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/purchase-orders/group-suggestions"] });
      toast({
        title: "Commande créée",
        description: `Commande ${order.orderNumber} créée avec succès`,
      });
      setLocation(`/procurement/orders/${order.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Une erreur est survenue. Veuillez réessayer."),
        variant: "destructive",
      });
    },
  });

  const handleCreateOrder = (suggestion: GroupSuggestion) => {
    createOrderMutation.mutate({
      supplierId: suggestion.supplierId,
      requirementIds: suggestion.requirements.map(r => r.id),
      discountPercentage: suggestion.recommendedDiscount,
    });
  };

  const formatCurrency = (amount: number) => {
    return formatPrice(amount);
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-8 w-8 text-blue-500" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Regroupement Automatique
            </h1>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Optimisez vos achats en regroupant les demandes par fournisseur
          </p>
        </div>
      </div>

      {/* Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Paramètres de Regroupement</CardTitle>
          <CardDescription>Configurez les critères de regroupement intelligent</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="minRequirements">Minimum de demandes</Label>
              <Input
                id="minRequirements"
                type="number"
                min="1"
                value={minRequirements}
                onChange={(e) => setMinRequirements(parseInt(e.target.value) || 2)}
                data-testid="input-min-requirements"
              />
              <p className="text-xs text-gray-500">
                Nombre minimum de demandes pour créer un groupe
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxDaysOld">Âge maximum (jours)</Label>
              <Input
                id="maxDaysOld"
                type="number"
                min="1"
                value={maxDaysOld}
                onChange={(e) => setMaxDaysOld(parseInt(e.target.value) || 30)}
                data-testid="input-max-days"
              />
              <p className="text-xs text-gray-500">
                Demandes créées dans les X derniers jours
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="urgencyThreshold">Seuil d'urgence</Label>
              <Select value={urgencyThreshold} onValueChange={setUrgencyThreshold}>
                <SelectTrigger id="urgencyThreshold" data-testid="select-urgency-threshold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Faible et plus</SelectItem>
                  <SelectItem value="medium">Moyenne et plus</SelectItem>
                  <SelectItem value="high">Haute et plus</SelectItem>
                  <SelectItem value="critical">Critique uniquement</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Niveau d'urgence minimum
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Résumé des économies potentielles */}
      {suggestions.length > 0 && (
        <Card className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-500 rounded-full">
                <TrendingUp className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-green-900 dark:text-green-100">
                  Économies Potentielles Détectées
                </h3>
                <p className="text-green-700 dark:text-green-300 mt-1">
                  {formatCurrency(suggestions.reduce((sum, s) => sum + (s.totalEstimatedCost * s.recommendedDiscount / 100), 0))}
                  d'économies possibles avec {suggestions.length} commande{suggestions.length > 1 ? 's' : ''} groupée{suggestions.length > 1 ? 's' : ''}
                </p>
              </div>
              <div className="text-right">
                <div className="text-3xl font-bold text-green-600 dark:text-green-400">
                  {(suggestions.reduce((sum, s) => sum + s.recommendedDiscount, 0) / suggestions.length).toFixed(1)}%
                </div>
                <div className="text-sm text-green-600 dark:text-green-400">Remise moyenne</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Suggestions de regroupement */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">
          Suggestions de Commandes Groupées{suggestionsFailed || !canGroup ? "" : ` (${suggestions.length})`}
        </h2>

        {!canGroup ? (
          <Card data-testid="group-out-of-scope">
            <CardContent className="py-12">
              <div className="text-center text-gray-500">
                <Package className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>Le regroupement concerne les commandes de pièces atelier.</p>
                <p className="text-sm mt-1">Il est géré par le magasin et le secrétariat.</p>
              </div>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="text-center py-12">Chargement des suggestions...</div>
        ) : suggestionsView.kind === "error" ? (
          <div data-testid="group-suggestions-error">
            <InlineQueryError
              error={suggestionsView.error}
              fallback="Les suggestions de regroupement sont momentanément indisponibles."
              onRetry={() => void suggestionsQuery.refetch()}
              isRetrying={suggestionsView.isRetrying}
            />
          </div>
        ) : suggestions.length === 0 ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center text-gray-500">
                <Package className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                <p>Aucune suggestion de regroupement disponible</p>
                <p className="text-sm mt-1">Ajustez les paramètres ou attendez plus de demandes</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          suggestions.map((suggestion) => {
            const urgencyInfo = urgencyConfig[suggestion.urgencyLevel] || urgencyConfig.medium;
            const isSelected = selectedGroup === suggestion.supplierId;
            
            return (
              <Card
                key={suggestion.supplierId}
                className={isSelected ? "border-blue-500 border-2" : ""}
                data-testid={`suggestion-${suggestion.supplierId}`}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="flex items-center gap-2">
                        <Package className="h-5 w-5" />
                        {suggestion.supplierName}
                      </CardTitle>
                      <CardDescription className="mt-2 flex items-center gap-2">
                        <Badge className={urgencyInfo.color}>
                          {urgencyInfo.label}
                        </Badge>
                        <span>{suggestion.requirements.length} demande{suggestion.requirements.length > 1 ? 's' : ''}</span>
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedGroup(isSelected ? null : suggestion.supplierId)}
                      data-testid={`button-toggle-${suggestion.supplierId}`}
                    >
                      {isSelected ? "Masquer détails" : "Voir détails"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Résumé financier */}
                  <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    <div>
                      <div className="text-sm text-gray-500">Total estimé</div>
                      <div className="text-lg font-semibold">
                        {formatCurrency(suggestion.totalEstimatedCost)}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Remise recommandée</div>
                      <div className="text-lg font-semibold text-green-600">
                        {suggestion.recommendedDiscount}%
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-gray-500">Économie potentielle</div>
                      <div className="text-lg font-semibold text-green-600">
                        {formatCurrency(suggestion.totalEstimatedCost * suggestion.recommendedDiscount / 100)}
                      </div>
                    </div>
                  </div>

                  {/* Optimisation de timing */}
                  {isSelected && optimization && (
                    <div className={`p-4 rounded-lg border ${
                      optimization.shouldOrderNow 
                        ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                        : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                    }`}>
                      <div className="flex items-start gap-3">
                        {optimization.shouldOrderNow ? (
                          <CheckCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <p className="font-medium text-sm">
                            {optimization.shouldOrderNow ? "Commander maintenant" : "Attendre pourrait être bénéfique"}
                          </p>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {optimization.reason}
                          </p>
                          {optimization.waitDays && (
                            <p className="text-xs text-gray-500 mt-1">
                              Suggéré: attendre ~{optimization.waitDays} jours
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Détails des demandes */}
                  {isSelected && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Articles à commander:</h4>
                      <div className="space-y-1">
                        {suggestion.requirements.map((req) => (
                          <div
                            key={req.id}
                            className="flex justify-between items-center p-2 bg-white dark:bg-gray-900 rounded border dark:border-gray-700 text-sm"
                          >
                            <div className="flex-1">
                              <span className="font-medium">{req.partName || "Article"}</span>
                              <span className="text-gray-500 ml-2">× {req.quantityNeeded}</span>
                            </div>
                            <div className="text-right">
                              <div>{formatCurrency(req.estimatedPrice || 0)}</div>
                              <Badge variant="outline" className="text-xs">
                                {req.urgency}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action */}
                  <Button
                    className="w-full"
                    onClick={() => handleCreateOrder(suggestion)}
                    disabled={createOrderMutation.isPending}
                    data-testid={`button-create-${suggestion.supplierId}`}
                  >
                    {createOrderMutation.isPending ? "Création..." : "Créer la Commande Groupée"}
                  </Button>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
