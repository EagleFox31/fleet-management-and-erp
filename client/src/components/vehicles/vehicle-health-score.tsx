import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, Gauge, Calendar, Wrench, FileText, Battery, HeartPulse } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface VehicleHealthScoreProps {
  vehicleId?: number;
  registrationNumber?: string;
  showDetails?: boolean;
}

export function VehicleHealthScore({ vehicleId, registrationNumber, showDetails = true }: VehicleHealthScoreProps) {
  const [, setLocation] = useLocation();
  const [selectedTab, setSelectedTab] = useState("overview");
  
  // Récupération des données du véhicule
  const { data: vehicle, isLoading: isLoadingVehicle } = useQuery<any>({
    queryKey: [`/api/vehicles/${vehicleId || registrationNumber}`],
    enabled: !!vehicleId || !!registrationNumber,
  });

  // Récupération des données de maintenance
  const { data: maintenanceSchedules, isLoading: isLoadingSchedules } = useQuery<any>({
    queryKey: [`/api/maintenance-schedules/vehicle/${vehicle?.id}`],
    enabled: !!vehicle?.id,
  });
  
  // Récupération des ordres de travail
  const { data: workOrders, isLoading: isLoadingWorkOrders } = useQuery<any>({
    queryKey: [`/api/work-orders/vehicle/${vehicle?.id}`],
    enabled: !!vehicle?.id,
  });
  
  // Récupération des documents du véhicule
  const { data: documents, isLoading: isLoadingDocuments } = useQuery<any>({
    queryKey: [`/api/vehicles/${vehicle?.id}/documents`],
    enabled: !!vehicle?.id,
  });

  // Calcul des scores par catégorie
  const calculateCategoryScore = (category: string): { score: number; issues: string[] } => {
    if (!vehicle) return { score: 0, issues: ["Données manquantes"] };
    
    const today = new Date();
    let score = 100;
    const issues: string[] = [];
    
    switch (category) {
      case "maintenance":
        // Vérifier si le véhicule a des entretiens en retard
        if (vehicle.nextMaintenanceDate) {
          const maintenanceDate = new Date(vehicle.nextMaintenanceDate);
          const daysUntilMaintenance = Math.ceil((maintenanceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysUntilMaintenance < 0) {
            score -= 50;
            issues.push(`Entretien en retard de ${Math.abs(daysUntilMaintenance)} jours`);
          } else if (daysUntilMaintenance < 15) {
            score -= 25;
            issues.push(`Entretien prévu dans ${daysUntilMaintenance} jours`);
          }
        }
        
        // Vérifier le kilométrage
        if (vehicle.nextMaintenanceMileage && vehicle.mileage) {
          const kmUntilMaintenance = vehicle.nextMaintenanceMileage - vehicle.mileage;
          
          if (kmUntilMaintenance < 0) {
            score -= 40;
            issues.push(`Dépassement de ${Math.abs(kmUntilMaintenance)} km pour l'entretien`);
          } else if (kmUntilMaintenance < 1000) {
            score -= 20;
            issues.push(`Entretien prévu dans ${kmUntilMaintenance} km`);
          }
        }
        
        // Pénalité pour les ordres de travail en cours
        if (workOrders && workOrders.length > 0) {
          const pendingWorkOrders = workOrders.filter((wo: any) => wo.status !== "completed");
          if (pendingWorkOrders.length > 0) {
            score -= 10 * Math.min(pendingWorkOrders.length, 5);
            issues.push(`${pendingWorkOrders.length} ordre(s) de travail en cours`);
          }
        }
        break;
        
      case "documents":
        // Vérifier les documents expirés
        if (documents && documents.length > 0) {
          const expiredDocs = documents.filter((doc: any) => {
            if (!doc.expiryDate) return false;
            const expiryDate = new Date(doc.expiryDate);
            return expiryDate < today;
          });
          
          const soonExpiringDocs = documents.filter((doc: any) => {
            if (!doc.expiryDate) return false;
            const expiryDate = new Date(doc.expiryDate);
            const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            return daysUntilExpiry >= 0 && daysUntilExpiry < 30;
          });
          
          if (expiredDocs.length > 0) {
            score -= 30 * Math.min(expiredDocs.length, 3);
            issues.push(`${expiredDocs.length} document(s) expiré(s)`);
          }
          
          if (soonExpiringDocs.length > 0) {
            score -= 10 * Math.min(soonExpiringDocs.length, 3);
            issues.push(`${soonExpiringDocs.length} document(s) bientôt expiré(s)`);
          }
        }
        
        // Vérifier les dates d'expiration spécifiques
        if (vehicle.licensePlateExpiry) {
          const expiryDate = new Date(vehicle.licensePlateExpiry);
          const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysUntilExpiry < 0) {
            score -= 40;
            issues.push(`Carte grise expirée depuis ${Math.abs(daysUntilExpiry)} jours`);
          } else if (daysUntilExpiry < 30) {
            score -= 20;
            issues.push(`Carte grise expire dans ${daysUntilExpiry} jours`);
          }
        }
        
        if (vehicle.insuranceExpiry) {
          const expiryDate = new Date(vehicle.insuranceExpiry);
          const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysUntilExpiry < 0) {
            score -= 40;
            issues.push(`Assurance expirée depuis ${Math.abs(daysUntilExpiry)} jours`);
          } else if (daysUntilExpiry < 30) {
            score -= 20;
            issues.push(`Assurance expire dans ${daysUntilExpiry} jours`);
          }
        }
        
        if (vehicle.technicalInspectionDate) {
          const inspectionDate = new Date(vehicle.technicalInspectionDate);
          const nextInspectionDate = new Date(inspectionDate);
          nextInspectionDate.setFullYear(nextInspectionDate.getFullYear() + 1);
          
          const daysUntilExpiry = Math.ceil((nextInspectionDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          if (daysUntilExpiry < 0) {
            score -= 40;
            issues.push(`Contrôle technique expiré depuis ${Math.abs(daysUntilExpiry)} jours`);
          } else if (daysUntilExpiry < 30) {
            score -= 20;
            issues.push(`Contrôle technique expire dans ${daysUntilExpiry} jours`);
          }
        }
        break;
        
      case "status":
        // Score basé sur le statut opérationnel
        if (vehicle.status === "out_of_service") {
          score = 0;
          issues.push("Véhicule hors service");
        } else if (vehicle.status === "maintenance") {
          score = 40;
          issues.push("Véhicule en maintenance");
        } else if (vehicle.status === "operational") {
          // Vérifier l'âge du véhicule
          const age = new Date().getFullYear() - vehicle.year;
          if (age > 10) {
            score -= 20;
            issues.push(`Véhicule âgé de ${age} ans`);
          } else if (age > 5) {
            score -= 10;
            issues.push(`Véhicule âgé de ${age} ans`);
          }
          
          // Vérifier le kilométrage (usure potentielle)
          if (vehicle.mileage > 500000) {
            score -= 20;
            issues.push("Kilométrage très élevé");
          } else if (vehicle.mileage > 300000) {
            score -= 10;
            issues.push("Kilométrage élevé");
          }
        }
        break;
    }
    
    // Limiter le score entre 0 et 100
    return { score: Math.max(0, Math.min(100, score)), issues };
  };
  
  // Calcul du score global
  const calculateOverallScore = (): number => {
    if (!vehicle) return 0;
    
    const maintenanceScore = calculateCategoryScore("maintenance").score;
    const documentsScore = calculateCategoryScore("documents").score;
    const statusScore = calculateCategoryScore("status").score;
    
    // Moyenne pondérée des scores
    return Math.round((maintenanceScore * 0.4) + (documentsScore * 0.3) + (statusScore * 0.3));
  };
  
  const getScoreColor = (score: number): string => {
    if (score >= 80) return "text-green-500";
    if (score >= 60) return "text-amber-500";
    if (score >= 40) return "text-orange-500";
    return "text-red-500";
  };
  
  const getProgressColor = (score: number): string => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-amber-500";
    if (score >= 40) return "bg-orange-500";
    return "bg-red-500";
  };
  
  // Scores par catégorie
  const maintenanceData = calculateCategoryScore("maintenance");
  const documentsData = calculateCategoryScore("documents");
  const statusData = calculateCategoryScore("status");
  const overallScore = calculateOverallScore();
  
  if (isLoadingVehicle) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Chargement des données...</CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
        </CardContent>
      </Card>
    );
  }
  
  if (!vehicle) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-center">Données non disponibles</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground">
            Impossible de récupérer les données du véhicule
          </p>
        </CardContent>
      </Card>
    );
  }
  
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-0">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl">
            Score de santé du véhicule
          </CardTitle>
          {!showDetails && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setLocation(`/vehicles/${vehicle.id}/health`)}
            >
              Détails
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-6">
          {/* Score global */}
          <div className="text-center mb-8">
            <div className="relative w-36 h-36 mx-auto mb-4">
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={`text-5xl font-bold ${getScoreColor(overallScore)}`}>
                  {overallScore}
                </div>
              </div>
              <svg width="144" height="144" viewBox="0 0 144 144" className="transform -rotate-90">
                <circle
                  cx="72"
                  cy="72"
                  r="66"
                  fill="none"
                  stroke="#e5e5e5"
                  strokeWidth="12"
                />
                <circle
                  cx="72"
                  cy="72"
                  r="66"
                  fill="none"
                  stroke={getProgressColor(overallScore).replace('bg-', 'stroke-')}
                  strokeWidth="12"
                  strokeDasharray="415"
                  strokeDashoffset={415 - (415 * overallScore) / 100}
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <h3 className="text-xl font-semibold">
              {overallScore >= 80 ? 'Excellent état' : 
               overallScore >= 60 ? 'Bon état' : 
               overallScore >= 40 ? 'Attention requise' : 
               'Problèmes critiques'}
            </h3>
            <p className="text-muted-foreground">{vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}</p>
          </div>
          
          {/* Scores par catégorie */}
          {showDetails && (
            <>
              <Tabs defaultValue={selectedTab} onValueChange={setSelectedTab} className="w-full">
                <TabsList className="grid grid-cols-3 mb-4">
                  <TabsTrigger value="overview">Vue d'ensemble</TabsTrigger>
                  <TabsTrigger value="details">Détails</TabsTrigger>
                  <TabsTrigger value="history">Historique</TabsTrigger>
                </TabsList>
                
                <TabsContent value="overview" className="space-y-4 pt-2">
                  <div className="space-y-6">
                    {/* Maintenance score */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center">
                          <Wrench className="h-5 w-5 mr-2 text-blue-500" />
                          <h4 className="font-medium">Maintenance</h4>
                        </div>
                        <Badge className={getProgressColor(maintenanceData.score)}>
                          {maintenanceData.score}%
                        </Badge>
                      </div>
                      <Progress value={maintenanceData.score} className="h-2" indicatorClassName={getProgressColor(maintenanceData.score)} />
                      {maintenanceData.issues.length > 0 && (
                        <div className="pl-7 text-sm text-muted-foreground">
                          {maintenanceData.issues[0]}
                          {maintenanceData.issues.length > 1 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="ml-1 cursor-help underline underline-offset-2">
                                    +{maintenanceData.issues.length - 1} autre(s)
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <ul className="list-disc pl-5">
                                    {maintenanceData.issues.slice(1).map((issue, idx) => (
                                      <li key={idx}>{issue}</li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Documents score */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center">
                          <FileText className="h-5 w-5 mr-2 text-purple-500" />
                          <h4 className="font-medium">Documents</h4>
                        </div>
                        <Badge className={getProgressColor(documentsData.score)}>
                          {documentsData.score}%
                        </Badge>
                      </div>
                      <Progress value={documentsData.score} className="h-2" indicatorClassName={getProgressColor(documentsData.score)} />
                      {documentsData.issues.length > 0 && (
                        <div className="pl-7 text-sm text-muted-foreground">
                          {documentsData.issues[0]}
                          {documentsData.issues.length > 1 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="ml-1 cursor-help underline underline-offset-2">
                                    +{documentsData.issues.length - 1} autre(s)
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <ul className="list-disc pl-5">
                                    {documentsData.issues.slice(1).map((issue, idx) => (
                                      <li key={idx}>{issue}</li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}
                    </div>
                    
                    {/* Status score */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center">
                          <Gauge className="h-5 w-5 mr-2 text-green-500" />
                          <h4 className="font-medium">État opérationnel</h4>
                        </div>
                        <Badge className={getProgressColor(statusData.score)}>
                          {statusData.score}%
                        </Badge>
                      </div>
                      <Progress value={statusData.score} className="h-2" indicatorClassName={getProgressColor(statusData.score)} />
                      {statusData.issues.length > 0 && (
                        <div className="pl-7 text-sm text-muted-foreground">
                          {statusData.issues[0]}
                          {statusData.issues.length > 1 && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="ml-1 cursor-help underline underline-offset-2">
                                    +{statusData.issues.length - 1} autre(s)
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <ul className="list-disc pl-5">
                                    {statusData.issues.slice(1).map((issue, idx) => (
                                      <li key={idx}>{issue}</li>
                                    ))}
                                  </ul>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="details" className="space-y-4 pt-2">
                  <div className="space-y-4">
                    <h3 className="text-base font-semibold">Détails du véhicule</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Immatriculation</div>
                        <div className="font-medium">{vehicle.registrationNumber}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Modèle</div>
                        <div className="font-medium">{vehicle.brand} {vehicle.model}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Année</div>
                        <div className="font-medium">{vehicle.year}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Kilométrage</div>
                        <div className="font-medium">{vehicle.mileage?.toLocaleString()} km</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Type</div>
                        <div className="font-medium">{vehicle.vehicleType}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Statut</div>
                        <div className="font-medium">
                          <Badge variant={
                            vehicle.status === "operational" ? "default" :
                            vehicle.status === "maintenance" ? "outline" : "destructive"
                          }>
                            {vehicle.status === "operational" ? "Opérationnel" :
                             vehicle.status === "maintenance" ? "En maintenance" : "Hors service"}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-4 pt-2">
                    <h3 className="text-base font-semibold">Prochaines échéances</h3>
                    <div className="space-y-3">
                      {vehicle.nextMaintenanceDate && (
                        <div className="flex items-start">
                          <Calendar className="h-5 w-5 mr-2 mt-0.5 text-blue-500" />
                          <div>
                            <div className="font-medium">Entretien planifié</div>
                            <div className="text-sm text-muted-foreground">
                              {new Date(vehicle.nextMaintenanceDate).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {vehicle.nextMaintenanceMileage && (
                        <div className="flex items-start">
                          <Gauge className="h-5 w-5 mr-2 mt-0.5 text-amber-500" />
                          <div>
                            <div className="font-medium">Entretien au kilométrage</div>
                            <div className="text-sm text-muted-foreground">
                              {vehicle.nextMaintenanceMileage.toLocaleString()} km
                              {vehicle.mileage && (
                                <span className="ml-1">
                                  ({(vehicle.nextMaintenanceMileage - vehicle.mileage).toLocaleString()} km restants)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {vehicle.technicalInspectionDate && (
                        <div className="flex items-start">
                          <Battery className="h-5 w-5 mr-2 mt-0.5 text-green-500" />
                          <div>
                            <div className="font-medium">Contrôle technique</div>
                            <div className="text-sm text-muted-foreground">
                              {new Date(vehicle.technicalInspectionDate).toLocaleDateString()}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="history" className="space-y-4 pt-2">
                  <div className="space-y-4">
                    <h3 className="text-base font-semibold">Historique des maintenances</h3>
                    
                    {isLoadingWorkOrders ? (
                      <div className="text-center py-4">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto"></div>
                        <p className="text-sm text-muted-foreground mt-2">Chargement de l'historique...</p>
                      </div>
                    ) : !workOrders || workOrders.length === 0 ? (
                      <div className="text-center py-4 border rounded-md">
                        <p className="text-sm text-muted-foreground">Aucun historique de maintenance disponible</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {workOrders.slice(0, 5).map((order: any) => (
                          <div key={order.id} className="flex items-start border-l-4 border-blue-500 pl-3 py-1">
                            <div className="flex-1">
                              <div className="font-medium">{order.description}</div>
                              <div className="text-sm text-muted-foreground">
                                {new Date(order.startDate).toLocaleDateString()} - 
                                <Badge variant={
                                  order.status === "completed" ? "outline" : 
                                  order.status === "in_progress" ? "default" : "secondary"
                                } className="ml-2">
                                  {order.status === "completed" ? "Terminé" : 
                                   order.status === "in_progress" ? "En cours" : "Planifié"}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        ))}
                        
                        {workOrders.length > 5 && (
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="w-full"
                            onClick={() => setLocation(`/maintenance/work-orders?vehicleId=${vehicle.id}`)}
                          >
                            Voir tout l'historique ({workOrders.length})
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
          
          {!showDetails && (
            <>
              <div className="space-y-4">
                {/* Compact view of scores */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-medium">Maintenance</div>
                      <Badge className={getProgressColor(maintenanceData.score)}>
                        {maintenanceData.score}%
                      </Badge>
                    </div>
                    <Progress value={maintenanceData.score} className="h-1.5" indicatorClassName={getProgressColor(maintenanceData.score)} />
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-medium">Documents</div>
                      <Badge className={getProgressColor(documentsData.score)}>
                        {documentsData.score}%
                      </Badge>
                    </div>
                    <Progress value={documentsData.score} className="h-1.5" indicatorClassName={getProgressColor(documentsData.score)} />
                  </div>
                  
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <div className="text-sm font-medium">État</div>
                      <Badge className={getProgressColor(statusData.score)}>
                        {statusData.score}%
                      </Badge>
                    </div>
                    <Progress value={statusData.score} className="h-1.5" indicatorClassName={getProgressColor(statusData.score)} />
                  </div>
                </div>
                
                {/* Issues summary */}
                {(maintenanceData.issues.length > 0 || documentsData.issues.length > 0 || statusData.issues.length > 0) && (
                  <div className="bg-muted/50 rounded-md p-3 text-sm">
                    <div className="flex">
                      <AlertTriangle className="h-5 w-5 text-amber-500 mr-2 flex-shrink-0" />
                      <div>
                        {maintenanceData.issues[0] || documentsData.issues[0] || statusData.issues[0]}
                        {(maintenanceData.issues.length + documentsData.issues.length + statusData.issues.length) > 1 && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="ml-1 cursor-help underline underline-offset-2">
                                  +{(maintenanceData.issues.length + documentsData.issues.length + statusData.issues.length) - 1} problème(s)
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="w-64">
                                <ul className="list-disc pl-5">
                                  {[...maintenanceData.issues, ...documentsData.issues, ...statusData.issues].slice(1, 5).map((issue, idx) => (
                                    <li key={idx}>{issue}</li>
                                  ))}
                                  {(maintenanceData.issues.length + documentsData.issues.length + statusData.issues.length) > 5 && (
                                    <li className="italic">Et d'autres problèmes...</li>
                                  )}
                                </ul>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}