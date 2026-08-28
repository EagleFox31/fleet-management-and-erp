import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Calendar,
  AlertTriangle,
  Shield,
  FileCheck,
  CreditCard,
  Wrench,
  Clock,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  Loader2,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { fr } from "date-fns/locale";

interface Vehicle {
  id: number;
  registrationNumber: string;
  brand: string;
  model: string;
  nextMaintenanceDate?: string;
  insuranceExpiry?: string;
  technicalInspectionDate?: string;
  licensePlateExpiry?: string;
}

interface DateAlert {
  vehicleId: number;
  vehicle: Vehicle;
  type: 'maintenance' | 'insurance' | 'inspection' | 'license';
  title: string;
  date: string;
  daysRemaining: number;
  priority: 'low' | 'medium' | 'high';
  icon: any;
  description: string;
}

type FilterKey = 'all' | 'expired' | 'urgent' | 'week';
type SortField = 'daysRemaining' | 'type' | 'vehicle' | 'date';

export default function DateBasedAlertsPage() {
  const [selectedFilter, setSelectedFilter] = useState<FilterKey>('all');
  const [sortField, setSortField] = useState<SortField>('daysRemaining');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // doneKeys = optimiste (session courante), complété par serverDoneKeys (BD réelle)
  const [optimisticDoneKeys, setOptimisticDoneKeys] = useState<Set<string>>(new Set());
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState(false);
  const queryClient = useQueryClient();

  const { data: vehiclesData, isLoading: loadingVehicles } = useQuery<any>({
    queryKey: ["/api/vehicles"]
  });

  // Requête work-orders pour dériver l'état réel depuis la BD
  const { data: workOrdersData } = useQuery<any>({
    queryKey: ["/api/work-orders", { limit: 300, offset: 0 }],
    staleTime: 0,
  });

  const vehicles = (vehiclesData as any)?.vehicles || [];

  // Correspondance type d'alerte → fragment de titre en BD
  const TYPE_TO_TITLE: Record<string, string> = {
    maintenance: 'Maintenance préventive programmée',
    insurance:   'Renouvellement assurance',
    inspection:  'Contrôle technique',
    license:     "Renouvellement plaque",
  };

  // Clés dérivées des OT réels en BD (pending uniquement)
  const serverDoneKeys = useMemo<Set<string>>(() => {
    const wos = (workOrdersData as any)?.workOrders ?? [];
    const keys = new Set<string>();
    wos.forEach((wo: any) => {
      if (!wo.vehicleId || !wo.title || wo.status === 'cancelled') return;
      for (const [type, titleFragment] of Object.entries(TYPE_TO_TITLE)) {
        if (wo.title.includes(titleFragment)) {
          keys.add(`${wo.vehicleId}-${type}`);
          break;
        }
      }
    });
    return keys;
  }, [workOrdersData]);

  // Union : optimiste (feedback immédiat) + serveur (source de vérité)
  const doneKeys = useMemo(
    () => new Set([...optimisticDoneKeys, ...serverDoneKeys]),
    [optimisticDoneKeys, serverDoneKeys]
  );

  const generateDateAlerts = (vehicles: Vehicle[]): DateAlert[] => {
    const alerts: DateAlert[] = [];
    const today = new Date();
    const alertPeriod = 30;

    vehicles.forEach(vehicle => {
      if (vehicle.nextMaintenanceDate) {
        const date = new Date(vehicle.nextMaintenanceDate);
        const daysRemaining = differenceInDays(date, today);
        if (daysRemaining <= alertPeriod) {
          alerts.push({
            vehicleId: vehicle.id,
            vehicle,
            type: 'maintenance',
            title: 'Maintenance atelier (préventive)',
            date: vehicle.nextMaintenanceDate,
            daysRemaining,
            priority: daysRemaining <= 7 ? 'high' : daysRemaining <= 15 ? 'medium' : 'low',
            icon: Wrench,
            description: `Maintenance atelier planifiée pour le véhicule ${vehicle.registrationNumber}`
          });
        }
      }

      if (vehicle.insuranceExpiry) {
        const date = new Date(vehicle.insuranceExpiry);
        const daysRemaining = differenceInDays(date, today);
        if (daysRemaining <= alertPeriod) {
          alerts.push({
            vehicleId: vehicle.id,
            vehicle,
            type: 'insurance',
            title: 'Renouvellement assurance',
            date: vehicle.insuranceExpiry,
            daysRemaining,
            priority: daysRemaining <= 15 ? 'high' : 'medium',
            icon: Shield,
            description: `Assurance expire le ${format(date, 'dd/MM/yyyy', { locale: fr })}`
          });
        }
      }

      if (vehicle.technicalInspectionDate) {
        const date = new Date(vehicle.technicalInspectionDate);
        const daysRemaining = differenceInDays(date, today);
        if (daysRemaining <= alertPeriod) {
          alerts.push({
            vehicleId: vehicle.id,
            vehicle,
            type: 'inspection',
            title: 'Contrôle technique',
            date: vehicle.technicalInspectionDate,
            daysRemaining,
            priority: daysRemaining <= 15 ? 'high' : 'medium',
            icon: FileCheck,
            description: `Contrôle technique expire le ${format(date, 'dd/MM/yyyy', { locale: fr })}`
          });
        }
      }

      if (vehicle.licensePlateExpiry) {
        const date = new Date(vehicle.licensePlateExpiry);
        const daysRemaining = differenceInDays(date, today);
        if (daysRemaining <= alertPeriod) {
          alerts.push({
            vehicleId: vehicle.id,
            vehicle,
            type: 'license',
            title: 'Renouvellement plaque',
            date: vehicle.licensePlateExpiry,
            daysRemaining,
            priority: daysRemaining <= 30 ? 'high' : 'medium',
            icon: CreditCard,
            description: `Plaque d'immatriculation expire le ${format(date, 'dd/MM/yyyy', { locale: fr })}`
          });
        }
      }
    });

    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  };

  const getAlertKey = (alert: DateAlert) => `${alert.vehicleId}-${alert.type}`;
  const alerts = generateDateAlerts(vehicles);
  const maintenanceAlerts = alerts.filter(a => a.type === 'maintenance');
  const pendingMaintenanceAlerts = maintenanceAlerts.filter(a => !doneKeys.has(getAlertKey(a)));

  const createForAlert = async (alert: DateAlert) => {
    const key = getAlertKey(alert);
    if (doneKeys.has(key) || loadingKeys.has(key)) return;
    setLoadingKeys(prev => new Set([...prev, key]));
    try {
      const response = await fetch("/api/test-date-maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: alert.vehicleId, alertType: alert.type })
      });
      if (!response.ok) {
        throw new Error("Échec de création");
      }
      const result = await response.json();
      if (Number(result?.workOrdersGenerated || 0) > 1) {
        throw new Error("Création multiple détectée");
      }
      setOptimisticDoneKeys(prev => new Set([...prev, key]));
      // type:'all' = force le rechargement même si la page OT n'est pas montée
      await queryClient.refetchQueries({ queryKey: ["/api/work-orders"], type: 'all' });
    } catch {
      // garde le bouton actif pour réessayer
    } finally {
      setLoadingKeys(prev => { const s = new Set(prev); s.delete(key); return s; });
    }
  };

  const generateAllOTs = async () => {
    setGlobalLoading(true);
    setGlobalError(false);
    try {
      // Ne générer en masse que les OT de maintenance (pas les demandes documentaires)
      const pending = pendingMaintenanceAlerts;
      await Promise.all(pending.map(a => createForAlert(a)));
    } catch {
      setGlobalError(true);
    } finally {
      setGlobalLoading(false);
    }
  };

  // KPI counts
  const totalCount = alerts.length;
  const urgentCount = alerts.filter(a => a.priority === 'high').length;
  const expiredCount = alerts.filter(a => a.daysRemaining < 0).length;
  const thisWeekCount = alerts.filter(a => a.daysRemaining >= 0 && a.daysRemaining <= 7).length;

  // Filter
  const filteredAlerts = alerts.filter(a => {
    if (selectedFilter === 'expired') return a.daysRemaining < 0;
    if (selectedFilter === 'urgent') return a.priority === 'high';
    if (selectedFilter === 'week') return a.daysRemaining >= 0 && a.daysRemaining <= 7;
    return true;
  });

  // Sort
  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const sortedAlerts = [...filteredAlerts].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'daysRemaining') cmp = a.daysRemaining - b.daysRemaining;
    else if (sortField === 'type') cmp = a.title.localeCompare(b.title);
    else if (sortField === 'vehicle') cmp = a.vehicle.registrationNumber.localeCompare(b.vehicle.registrationNumber);
    else if (sortField === 'date') cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const getRowClass = (alert: DateAlert) => {
    if (alert.daysRemaining < 0) return 'bg-red-50 hover:bg-red-100 border-b border-red-100';
    if (alert.priority === 'high') return 'bg-orange-50 hover:bg-orange-100 border-b border-orange-100';
    if (alert.priority === 'medium') return 'bg-yellow-50 hover:bg-yellow-100 border-b border-yellow-100';
    return 'hover:bg-gray-50 border-b border-gray-100';
  };

  const getDélaiDisplay = (daysRemaining: number) => {
    if (daysRemaining < 0) return { label: `${Math.abs(daysRemaining)}j dépassé`, className: 'text-red-600 font-semibold' };
    if (daysRemaining === 0) return { label: "Aujourd'hui", className: 'text-red-600 font-semibold' };
    if (daysRemaining === 1) return { label: "Demain", className: 'text-orange-600 font-medium' };
    if (daysRemaining <= 7) return { label: `${daysRemaining} jours`, className: 'text-orange-500 font-medium' };
    return { label: `${daysRemaining} jours`, className: 'text-muted-foreground' };
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 text-muted-foreground/50" />;
    return sortDir === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 ml-1 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 ml-1 text-primary" />;
  };

  const filters: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',     label: 'Toutes',        count: totalCount },
    { key: 'expired', label: 'Expirées',       count: expiredCount },
    { key: 'urgent',  label: 'Urgentes',       count: urgentCount },
    { key: 'week',    label: 'Cette semaine',  count: thisWeekCount },
  ];

  if (loadingVehicles) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-sm text-muted-foreground">Chargement des alertes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* En-tête + KPIs (sticky) */}
      <div className="sticky top-0 z-20 bg-background border-b shadow-sm">
        {/* Titre + bouton */}
        <div className="px-6 pt-5 pb-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Maintenance atelier & conformité documentaire</h1>
            <p className="text-sm text-muted-foreground">
              Maintenance atelier (préventive/curative) donne lieu à une OT, conformité documentaire (assurance, visite technique, plaque) donne lieu à une demande administrative.
            </p>
          </div>
          <Button
            onClick={generateAllOTs}
            disabled={globalLoading || pendingMaintenanceAlerts.length === 0}
            className="flex items-center gap-2"
          >
            {globalLoading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Génération...</>
              : pendingMaintenanceAlerts.length === 0
                ? <><CheckCircle className="h-4 w-4" /> Tout traité</>
                : <><CheckCircle className="h-4 w-4" /> Générer les OT atelier ({pendingMaintenanceAlerts.length})</>
            }
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="px-6 pb-3 grid grid-cols-4 gap-3">
          <Card className="shadow-none border">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Total alertes</p>
                  <p className="text-2xl font-bold">{totalCount}</p>
                </div>
                <AlertTriangle className="h-6 w-6 text-orange-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none border">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Urgentes</p>
                  <p className="text-2xl font-bold text-red-600">{urgentCount}</p>
                </div>
                <AlertTriangle className="h-6 w-6 text-red-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none border">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Expirées</p>
                  <p className="text-2xl font-bold text-red-600">{expiredCount}</p>
                </div>
                <Clock className="h-6 w-6 text-red-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-none border">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Cette semaine</p>
                  <p className="text-2xl font-bold text-orange-600">{thisWeekCount}</p>
                </div>
                <Calendar className="h-6 w-6 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Barre de filtres */}
        <div className="px-6 pb-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Filtrer :</span>
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setSelectedFilter(f.key)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                selectedFilter === f.key
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-primary hover:text-primary'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                selectedFilter === f.key ? 'bg-white/20' : 'bg-muted'
              }`}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tableau scrollable */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {sortedAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <CheckCircle className="h-12 w-12 text-green-500 mb-3" />
            <h3 className="text-base font-semibold mb-1">Aucune alerte</h3>
            <p className="text-sm text-muted-foreground">
              {selectedFilter === 'all'
                ? 'Tous vos véhicules sont à jour.'
                : 'Aucune alerte dans cette catégorie.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/60 text-left">
                <th
                  className="px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wide cursor-pointer select-none rounded-tl-md"
                  onClick={() => handleSort('type')}
                >
                  <span className="flex items-center">Type <SortIcon field="type" /></span>
                </th>
                <th
                  className="px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wide cursor-pointer select-none"
                  onClick={() => handleSort('vehicle')}
                >
                  <span className="flex items-center">Véhicule <SortIcon field="vehicle" /></span>
                </th>
                <th className="px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wide">
                  Immatriculation
                </th>
                <th
                  className="px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wide cursor-pointer select-none"
                  onClick={() => handleSort('date')}
                >
                  <span className="flex items-center">Échéance <SortIcon field="date" /></span>
                </th>
                <th
                  className="px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wide cursor-pointer select-none"
                  onClick={() => handleSort('daysRemaining')}
                >
                  <span className="flex items-center">Délai <SortIcon field="daysRemaining" /></span>
                </th>
                <th className="px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wide">
                  Statut
                </th>
                <th className="px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wide rounded-tr-md text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedAlerts.map((alert, index) => {
                const IconComponent = alert.icon;
                const isExpired = alert.daysRemaining < 0;
                const délai = getDélaiDisplay(alert.daysRemaining);
                return (
                  <tr
                    key={`${alert.vehicleId}-${alert.type}-${index}`}
                    className={`transition-colors ${getRowClass(alert)}`}
                  >
                    {/* Type */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <IconComponent className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium">{alert.title}</span>
                      </div>
                    </td>

                    {/* Véhicule */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {alert.vehicle.brand} {alert.vehicle.model}
                    </td>

                    {/* Immatriculation */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs bg-muted px-2 py-0.5 rounded">
                        {alert.vehicle.registrationNumber}
                      </span>
                    </td>

                    {/* Échéance */}
                    <td className="px-4 py-3 text-muted-foreground">
                      {format(new Date(alert.date), 'dd MMM yyyy', { locale: fr })}
                    </td>

                    {/* Délai */}
                    <td className={`px-4 py-3 ${délai.className}`}>
                      {délai.label}
                    </td>

                    {/* Statut */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {alert.priority === 'high' && (
                          <Badge className="bg-red-500 text-white text-[10px] px-1.5 py-0">Urgent</Badge>
                        )}
                        {alert.priority === 'medium' && (
                          <Badge className="bg-yellow-500 text-white text-[10px] px-1.5 py-0">Modéré</Badge>
                        )}
                        {isExpired ? (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Expiré</Badge>
                        ) : (
                          alert.daysRemaining <= 7 && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-orange-400 text-orange-600">
                              {alert.daysRemaining === 0 ? "Aujourd'hui" : alert.daysRemaining === 1 ? "Demain" : `J-${alert.daysRemaining}`}
                            </Badge>
                          )
                        )}
                      </div>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const key = getAlertKey(alert);
                        const isDone = doneKeys.has(key);
                        const isLoading = loadingKeys.has(key);
                        const isMaintenance = alert.type === 'maintenance';
                        if (isDone) {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium px-3 py-1.5 bg-green-50 rounded border border-green-200">
                              <CheckCircle className="h-3.5 w-3.5" />
                              {isMaintenance ? "OT atelier créée" : "Demande administrative créée"}
                            </span>
                          );
                        }
                        return (
                          <Button
                            size="sm"
                            variant={isExpired ? "destructive" : "default"}
                            className="h-7 text-xs px-3"
                            onClick={() => createForAlert(alert)}
                            disabled={isLoading}
                          >
                            {isLoading
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : isMaintenance ? "Créer OT atelier" : "Créer demande administrative"
                            }
                          </Button>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Notification erreur globale */}
        {globalError && (
          <Alert className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Certains ordres n'ont pas pu être créés. Vérifiez les lignes concernées et réessayez.
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
