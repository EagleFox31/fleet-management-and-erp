import { userMessageOf } from "@/lib/api-error";
import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDate, formatCurrency } from "@/lib/utils";
import { useLocation } from "wouter";
import { FuelRecordForm } from "@/components/fuel/fuel-record-form";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MascotHelper } from "@/components/onboarding/mascot-helper";
import { Input } from "@/components/ui/input";
import { PageLayout } from "@/components/layout/page-layout";
import { useAuth } from "@/hooks/useAuth";
import { canDeleteFuelRecord } from "@shared/constants/fuel-record-delete";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  HeaderCard,
  KpiGrid,
  KpiTile,
  CardShell,
  SectionLabel,
  PremiumDataTable,
  PremiumTabsNav,
  type PremiumDataTableColumn,
} from "@/components/design-system";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TabIcon } from "@/lib/premium-tab-icons";
import { Plus, Search, Fuel, Wallet, CarFront, CalendarDays, Edit, Trash2, Gauge, Info } from "lucide-react";
import type { Vehicle, FuelRecord } from "@shared/schema";
import { useFeature } from "@/hooks/use-feature";
import { isFuelPriceImposed } from "@/lib/fuel-price-policy";
import {
  computeVehicleConsumptionRows,
  formatConsumptionDisplay,
  type VehicleConsumptionRow,
} from "@/lib/fuel-consumption";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type FuelPriceMode = "real" | "fallback" | "manual";
type FuelPageTab = "records" | "consumption" | "recharges";

interface FuelCardHistoryRecord {
  id: number;
  date: string | null;
  quantity: number;
  creditAmount: string | number | null;
  unitPrice: string | number | null;
  paymentMode: string | null;
  orderNumber: string | null;
  notes: string | null;
  createdBy: number | null;
  createdByName?: string | null;
  createdByRole?: string | null;
}

export default function FuelPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isRechargeDialogOpen, setIsRechargeDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<FuelPageTab>("records");
  const [searchTerm, setSearchTerm] = useState("");
  const [vehicleFilter, setVehicleFilter] = useState<string | undefined>(undefined);
  const [editingRecord, setEditingRecord] = useState<FuelRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<FuelRecord | null>(null);
  const tableSectionRef = React.useRef<HTMLDivElement>(null);
  const [rechargeForm, setRechargeForm] = useState({
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    paymentMode: "virement",
    priceMode: "real" as FuelPriceMode,
    manualUnitPrice: "",
    orderNumber: "",
    notes: "",
  });
  const canManageFuelCard = ["admin", "logistics", "secretary"].includes(String(user?.role || ""));
  // Prix manuel : retiré seulement si le drapeau fuel-prices impose le prix du jour (hors admin et logistique).
  const fuelPricesEnabled = useFeature("fuel-prices");
  const canEditFuelPrice = !isFuelPriceImposed(user?.role, fuelPricesEnabled);

  const scrollToHistoryTable = () => {
    tableSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const canEditFuelRecord = (record: FuelRecord) =>
    user?.role === "admin" || user?.id === record.createdBy;

  // Fetch all vehicles for the filter dropdown
  const { data: vehiclesData } = useQuery<{ vehicles: Vehicle[], total: number }>({
    queryKey: ["/api/vehicles"],
  });
  const vehicles = vehiclesData?.vehicles || [];

  // Fetch all fuel records
  const { data: fuelRecordsData, isLoading } = useQuery<FuelRecord[]>({
    queryKey: [
      "/api/fuel-records", 
      {
        vehicleId: vehicleFilter,
      }
    ],
  });
  const fuelRecords = fuelRecordsData || [];

  const { data: fuelCardBalance } = useQuery<any>({
    queryKey: ["/api/fuel-card/balance"],
    enabled: canManageFuelCard,
    retry: false,
  });

  const { data: fuelCardRechargeHistoryData, isLoading: isLoadingRechargeHistory } = useQuery<FuelCardHistoryRecord[]>({
    queryKey: ["/api/fuel-card/history", { type: "credit" }],
    enabled: canManageFuelCard,
    retry: false,
  });
  const fuelCardRechargeHistory = fuelCardRechargeHistoryData || [];

  const realUnitPrice = Number(fuelCardBalance?.averagePricePerLiterReal || 0);
  const fallbackUnitPrice = Number(fuelCardBalance?.averagePricePerLiterFallback || 828);

  React.useEffect(() => {
    if (!isRechargeDialogOpen) return;
    setRechargeForm((prev) => ({
      ...prev,
      priceMode: realUnitPrice > 0 ? "real" : "fallback",
      manualUnitPrice: prev.manualUnitPrice || String(realUnitPrice > 0 ? realUnitPrice : fallbackUnitPrice),
    }));
  }, [isRechargeDialogOpen, realUnitPrice, fallbackUnitPrice]);

  const selectedUnitPrice = React.useMemo(() => {
    if (rechargeForm.priceMode === "manual" && canEditFuelPrice) {
      return Number(rechargeForm.manualUnitPrice);
    }
    if (rechargeForm.priceMode === "real") {
      return realUnitPrice;
    }
    return fallbackUnitPrice;
  }, [rechargeForm.priceMode, rechargeForm.manualUnitPrice, realUnitPrice, fallbackUnitPrice, canEditFuelPrice]);

  const computedQuantity = React.useMemo(() => {
    const amount = Number(rechargeForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    if (!Number.isFinite(selectedUnitPrice) || selectedUnitPrice <= 0) return 0;
    return amount / selectedUnitPrice;
  }, [rechargeForm.amount, selectedUnitPrice]);

  const canSubmitRecharge =
    Number.isFinite(Number(rechargeForm.amount)) &&
    Number(rechargeForm.amount) > 0 &&
    Number.isFinite(selectedUnitPrice) &&
    selectedUnitPrice > 0 &&
    Number.isFinite(computedQuantity) &&
    computedQuantity > 0 &&
    Boolean(rechargeForm.date) &&
    Boolean(rechargeForm.paymentMode);

  const rechargeCardMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(rechargeForm.amount);
      const quantity = computedQuantity;
      const unitPrice = selectedUnitPrice;
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Montant invalide");
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Quantité calculée invalide. Vérifiez le prix/litre.");
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error("Prix par litre invalide");
      }
      if (!rechargeForm.date || !rechargeForm.paymentMode) {
        throw new Error("Date et mode de paiement obligatoires");
      }

      const response = await apiRequest("POST", "/api/fuel-card/recharge", {
        amount,
        quantity,
        unitPrice,
        priceSource: rechargeForm.priceMode,
        date: rechargeForm.date,
        paymentMode: rechargeForm.paymentMode,
        orderNumber: rechargeForm.orderNumber || undefined,
        notes: rechargeForm.notes || undefined,
      });

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Carte rechargée",
        description: "La recharge a été enregistrée avec succès.",
      });
      setIsRechargeDialogOpen(false);
      setRechargeForm({
        amount: "",
        date: new Date().toISOString().slice(0, 10),
        paymentMode: "virement",
        priceMode: realUnitPrice > 0 ? "real" : "fallback",
        manualUnitPrice: String(realUnitPrice > 0 ? realUnitPrice : fallbackUnitPrice),
        orderNumber: "",
        notes: "",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/history", { type: "credit" }] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records/statistics"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erreur recharge",
        description: userMessageOf(error, "Impossible de recharger la carte carburant."),
        variant: "destructive",
      });
    },
  });

  const deleteFuelRecordMutation = useMutation({
    mutationFn: async (recordId: number) => {
      await apiRequest("DELETE", `/api/fuel-records/${recordId}`);
    },
    onSuccess: () => {
      toast({
        title: "Plein supprimé",
        description: "L'enregistrement de carburant a été supprimé.",
      });
      setDeletingRecord(null);
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-records/statistics"] });
      // Un débit supprimé rétablit le solde de la carte.
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/history"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erreur",
        description: userMessageOf(error, "Impossible de supprimer ce plein."),
        variant: "destructive",
      });
    },
  });
  const deleteFuelRecord = useSingleFlightMutate(deleteFuelRecordMutation.mutate);

  const filteredFuelRecords = React.useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return fuelRecords;

    return fuelRecords.filter((record) => {
      const vehicle = vehicles.find((v: Vehicle) => v.id === record.vehicleId);
      const haystack = [
        vehicle?.registrationNumber,
        vehicle?.brand,
        vehicle?.model,
        record.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [fuelRecords, vehicles, searchTerm]);

  const filteredFuelCardRecharges = React.useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return fuelCardRechargeHistory;

    return fuelCardRechargeHistory.filter((record) => {
      const haystack = [
        record.createdByName,
        record.createdByRole,
        record.orderNumber,
        record.paymentMode,
        record.notes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [fuelCardRechargeHistory, searchTerm]);

  const vehicleMeta = React.useMemo(() => {
    const meta: Record<number, { registrationNumber?: string; brand?: string; model?: string }> = {};
    for (const vehicle of vehicles) {
      meta[vehicle.id] = {
        registrationNumber: vehicle.registrationNumber,
        brand: vehicle.brand,
        model: vehicle.model,
      };
    }
    return meta;
  }, [vehicles]);

  const vehicleConsumption = React.useMemo(
    () => computeVehicleConsumptionRows(filteredFuelRecords, vehicleMeta),
    [filteredFuelRecords, vehicleMeta],
  );

  const totalLiters = filteredFuelRecords.reduce(
    (sum, record) => sum + Number(record.quantity || 0),
    0,
  );
  const totalCost = filteredFuelRecords.reduce(
    (sum, record) => sum + Number(record.cost || 0),
    0,
  );
  const fullTankCount = filteredFuelRecords.filter((record) => record.fullTank).length;
  const vehiclesCovered = new Set(filteredFuelRecords.map((record) => record.vehicleId).filter(Boolean)).size;

  const formatFuelMileage = (mileage: number | null | undefined) =>
    mileage == null ? "N/A" : `${mileage.toLocaleString("fr-FR")} km`;

  const consumptionColumns: PremiumDataTableColumn<VehicleConsumptionRow>[] = [
    {
      id: "vehicle",
      header: "Véhicule",
      cell: (row) => (
        <div className="min-w-0">
          <button
            type="button"
            className="text-sm font-semibold text-gray-800 hover:text-green-700 hover:underline text-left truncate max-w-full"
            onClick={(e) => {
              e.stopPropagation();
              if (row.registrationNumber) {
                setLocation(`/vehicles/${encodeURIComponent(row.registrationNumber)}`);
              }
            }}
          >
            {row.registrationNumber || `#${row.vehicleId}`}
          </button>
          <p className="text-xs text-gray-500 truncate">
            {row.brand || "-"} {row.model || ""}
          </p>
        </div>
      ),
    },
    {
      id: "consumption",
      header: "Consommation moyenne",
      cell: (row) => {
        const display = formatConsumptionDisplay(row);
        return (
          <div>
            <p className="text-sm font-medium text-gray-800">{display.value}</p>
            {display.detail ? (
              <p className="text-[11px] text-gray-400 mt-0.5">{display.detail}</p>
            ) : null}
          </div>
        );
      },
    },
    {
      id: "totalFuel",
      header: "Carburant mesuré",
      align: "right",
      cell: (row) => (
        <span className="text-sm font-medium text-gray-800 tabular-nums">
          {row.totalFuel.toFixed(2)} L
        </span>
      ),
    },
    {
      id: "totalDistance",
      header: "Distance parcourue",
      align: "right",
      cell: (row) => (
        <span className="text-sm text-gray-700 tabular-nums">
          {row.totalDistance > 0 ? `${row.totalDistance.toLocaleString("fr-FR")} km` : "—"}
        </span>
      ),
    },
    {
      id: "lastMileage",
      header: "Dernier kilométrage",
      align: "right",
      cell: (row) => (
        <span className="text-sm text-gray-700 tabular-nums">{formatFuelMileage(row.lastMileage)}</span>
      ),
    },
    {
      id: "recordCount",
      header: "Pleins",
      align: "center",
      cell: (row) => <span className="text-sm text-gray-600">{row.recordCount}</span>,
    },
  ];

  const columns: PremiumDataTableColumn<FuelRecord>[] = [
    {
      id: "vehicle",
      header: "Véhicule",
      cell: (row) => {
        const vehicle = vehicles.find((v: Vehicle) => v.id === row.vehicleId);
        return (
          <div>
            <p className="text-sm font-semibold text-gray-800">{vehicle?.registrationNumber || "N/A"}</p>
            <p className="text-xs text-gray-500">
              {vehicle?.brand || "-"} {vehicle?.model || ""}
            </p>
          </div>
        );
      },
    },
    {
      id: "date",
      header: "Date",
      cell: (row) => (
        <span className="text-sm text-gray-600 whitespace-nowrap">{row.date ? formatDate(row.date) : "N/A"}</span>
      ),
    },
    {
      id: "quantity",
      header: "Quantité (L)",
      align: "right",
      cell: (row) => (
        <span className="font-semibold text-gray-800 tabular-nums">
          {(row.quantity || 0).toFixed(2)} L
        </span>
      ),
    },
    {
      id: "cost",
      header: "Coût",
      align: "right",
      cell: (row) => (
        <span className="font-semibold text-gray-800 tabular-nums">{formatCurrency(row.cost || 0)}</span>
      ),
    },
    {
      id: "mileage",
      header: "Kilométrage",
      align: "right",
      cell: (row) => (
        <span className="text-sm text-gray-700 tabular-nums">{formatFuelMileage(row.mileage)}</span>
      ),
    },
    {
      id: "fullTank",
      header: "Plein",
      align: "center",
      cell: (row) => (
        <Badge variant={row.fullTank ? "default" : "outline"}>
          {row.fullTank ? "Complet" : "Partiel"}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      widthClassName: "w-[92px] whitespace-nowrap",
      cell: (row) => {
        const showEdit = canEditFuelRecord(row);
        // Même règle que le serveur : débit de carte = gestionnaires de la carte, plein physique = atelier.
        const showDelete = canDeleteFuelRecord(user?.role, row);
        if (!showEdit && !showDelete) {
          return <span className="text-xs text-gray-300">—</span>;
        }
        return (
          <div className="flex items-center justify-end gap-1">
            {showEdit && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingRecord(row);
                }}
                title="Modifier le plein"
              >
                <Edit className="h-3.5 w-3.5" />
              </Button>
            )}
            {showDelete && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeletingRecord(row);
                }}
                title="Supprimer le plein"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const rechargeColumns: PremiumDataTableColumn<FuelCardHistoryRecord>[] = [
    {
      id: "date",
      header: "Date",
      cell: (row) => (
        <span className="text-sm text-gray-700 whitespace-nowrap">{row.date ? formatDate(row.date) : "N/A"}</span>
      ),
    },
    {
      id: "amount",
      header: "Montant",
      align: "right",
      cell: (row) => (
        <span className="font-semibold text-emerald-700 tabular-nums">
          {formatCurrency(Number(row.creditAmount || 0))}
        </span>
      ),
    },
    {
      id: "quantity",
      header: "Litres",
      align: "right",
      cell: (row) => (
        <span className="font-medium text-gray-800 tabular-nums">
          {Number(row.quantity || 0).toFixed(2)} L
        </span>
      ),
    },
    {
      id: "unitPrice",
      header: "Prix/L",
      align: "right",
      cell: (row) => (
        <span className="text-sm text-gray-700 tabular-nums">
          {Number(row.unitPrice || 0).toLocaleString("fr-FR")} FCFA/L
        </span>
      ),
    },
    {
      id: "paymentMode",
      header: "Mode",
      cell: (row) => (
        <span className="text-sm text-gray-700 capitalize">{row.paymentMode || "-"}</span>
      ),
    },
    {
      id: "createdBy",
      header: "Rechargé par",
      cell: (row) => (
        <div>
          <p className="text-sm font-semibold text-gray-800">{row.createdByName || `Utilisateur #${row.createdBy ?? "?"}`}</p>
          <p className="text-xs text-gray-500">{row.createdByRole || "Rôle inconnu"}</p>
        </div>
      ),
    },
    {
      id: "order",
      header: "Référence",
      cell: (row) => (
        <span className="text-sm text-gray-600">{row.orderNumber || "-"}</span>
      ),
    },
  ];

  const fuelTabHelp: Record<FuelPageTab, string> = {
    records:
      "Liste des pleins enregistrés par véhicule. Cliquez une ligne pour ouvrir le détail, modifier ou supprimer selon votre rôle.",
    consumption:
      "Méthode plein à plein — le premier plein sert de repère kilométrique, sans chiffre inventé. Il faut au moins deux pleins avec kilométrage pour calculer une consommation.",
    recharges:
      "Crédits versés sur la carte carburant entreprise. Les pleins véhicules débitent ce solde au fil des enregistrements.",
  };

  const fuelNavTabs = React.useMemo(() => {
    const tabs = [
      {
        value: "records",
        label: "Pleins véhicules",
        icon: <TabIcon icon={Fuel} className="h-4 w-4 text-emerald-600" />,
        testId: "tab-fuel-records",
      },
      {
        value: "consumption",
        label: "Consommation",
        icon: <TabIcon icon={Gauge} className="h-4 w-4 text-sky-600" />,
        testId: "tab-fuel-consumption",
      },
    ];
    if (canManageFuelCard) {
      tabs.push({
        value: "recharges",
        label: "Historique carte",
        icon: <TabIcon icon={Wallet} className="h-4 w-4 text-violet-600" />,
        testId: "tab-fuel-recharges",
      });
    }
    return tabs;
  }, [canManageFuelCard]);

  const fuelSearchPlaceholder =
    activeTab === "recharges"
      ? "Rechercher un rechargeur, mode ou référence..."
      : activeTab === "consumption"
        ? "Rechercher une immatriculation..."
        : "Rechercher un véhicule ou une note...";

  const searchIconClassName =
    activeTab === "recharges"
      ? "text-violet-500"
      : activeTab === "consumption"
        ? "text-sky-500"
        : "text-emerald-500";

  return (
    <PageLayout>
      <div className="space-y-5">
        <HeaderCard
          moduleLabel="Carburant"
          title="Gestion du carburant"
          subtitle="Suivi des pleins, coûts et consommation par véhicule"
          icon={<Fuel className="h-5 w-5" />}
          actions={
            <div className="flex items-center gap-2">
              {canManageFuelCard && (
                <Button
                  variant="outline"
                  onClick={() => setIsRechargeDialogOpen(true)}
                  data-testid="button-open-fuel-card-recharge"
                >
                  <Wallet className="h-4 w-4 mr-2" />
                  Recharger la carte
                </Button>
              )}
              <Button onClick={() => setIsFormOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Enregistrer un plein
              </Button>
            </div>
          }
        >
          <KpiGrid columns={4}>
            {canManageFuelCard && (
              <KpiTile
                label="Solde carte carburant"
                value={formatCurrency(Number(fuelCardBalance?.balance || 0))}
                subValue={`Prix moyen : ${Number(fuelCardBalance?.averagePricePerLiter || 0)} FCFA/L`}
                icon={<Wallet className="h-4 w-4" />}
                iconWrapperClassName="bg-violet-50 text-violet-600"
                onClick={() => {
                  setActiveTab("recharges");
                  scrollToHistoryTable();
                }}
                data-testid="kpi-fuel-card-balance"
              />
            )}
            <KpiTile
              label="Pleins enregistrés"
              value={filteredFuelRecords.length}
              subValue="Historique filtré"
              icon={<CalendarDays className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
              onClick={() => {
                setActiveTab("records");
                scrollToHistoryTable();
              }}
              data-testid="kpi-fuel-records-count"
            />
            <KpiTile
              label="Litres consommés"
              value={`${totalLiters.toFixed(2)} L`}
              subValue={`${fullTankCount} pleins complets`}
              icon={<Fuel className="h-4 w-4" />}
              iconWrapperClassName="bg-emerald-50 text-emerald-600"
            />
            <KpiTile
              label="Coût total"
              value={formatCurrency(totalCost)}
              subValue="Dépense carburant"
              icon={<Wallet className="h-4 w-4" />}
              iconWrapperClassName="bg-amber-50 text-amber-600"
            />
            {!canManageFuelCard && (
              <KpiTile
                label="Véhicules suivis"
                value={vehiclesCovered}
                subValue="Sur la période affichée"
                icon={<CarFront className="h-4 w-4" />}
                iconWrapperClassName="bg-indigo-50 text-indigo-600"
              />
            )}
          </KpiGrid>
        </HeaderCard>

        <div ref={tableSectionRef} className="scroll-mt-4 pb-20 pr-2">
          <CardShell className="overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-emerald-400 via-sky-400 to-violet-400" />
            <div className="px-5 py-4 border-b border-gray-100 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SectionLabel className="text-emerald-700">Exploitation</SectionLabel>
                  <h2 className="text-base font-semibold text-gray-900 mt-1">Données carburant</h2>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Aide sur l'onglet actif"
                      className="shrink-0 w-7 h-7 rounded-lg border border-sky-100 bg-sky-50 flex items-center justify-center text-sky-600 hover:bg-sky-100 hover:border-sky-200 transition-colors"
                      data-testid="fuel-tab-context-help"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left" align="end" className="max-w-[280px] text-xs leading-relaxed">
                    {fuelTabHelp[activeTab]}
                  </TooltipContent>
                </Tooltip>
              </div>

              <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
                <div className="relative flex-1 min-w-[220px] max-w-xl">
                  <Search
                    className={`absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none ${searchIconClassName}`}
                  />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={fuelSearchPlaceholder}
                    className="pl-9 bg-gray-50 border-gray-100"
                    data-testid="input-fuel-data-search"
                  />
                </div>
                {activeTab !== "recharges" && (
                  <div className="flex items-center gap-2 lg:ml-auto shrink-0">
                    <span className="text-sm text-gray-500 whitespace-nowrap">Véhicule</span>
                    <Select
                      value={vehicleFilter || "all"}
                      onValueChange={(value) => setVehicleFilter(value === "all" ? undefined : value)}
                    >
                      <SelectTrigger className="w-full sm:w-[280px] bg-gray-50 border-gray-100" data-testid="select-fuel-vehicle-filter">
                        <SelectValue placeholder="Tous les véhicules" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tous les véhicules</SelectItem>
                        {vehicles.map((vehicle) => (
                          <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                            {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FuelPageTab)} className="w-full">
              <div className="px-5 pt-4">
                <PremiumTabsNav className="mb-0 w-full flex flex-wrap" tabs={fuelNavTabs} />
              </div>

              <TabsContent value="records" className="mt-0">
                <PremiumDataTable
                  columns={columns}
                  rows={filteredFuelRecords}
                  rowKey={(row) => row.id}
                  onRowClick={(row) => setLocation(`/fuel/${row.id}`)}
                  emptyState={isLoading ? "Chargement..." : "Aucun plein trouvé pour les filtres actuels."}
                />
              </TabsContent>

              <TabsContent value="consumption" className="mt-0">
                <PremiumDataTable
                  columns={consumptionColumns}
                  rows={vehicleConsumption}
                  rowKey={(row) => row.vehicleId}
                  emptyState="Aucune donnée de consommation disponible pour ce filtre."
                  tableClassName="table-fixed"
                />
              </TabsContent>

              {canManageFuelCard && (
                <TabsContent value="recharges" className="mt-0">
                  <PremiumDataTable
                    columns={rechargeColumns}
                    rows={filteredFuelCardRecharges}
                    rowKey={(row) => row.id}
                    emptyState={isLoadingRechargeHistory ? "Chargement..." : "Aucune recharge carte trouvée."}
                  />
                </TabsContent>
              )}
            </Tabs>
          </CardShell>
        </div>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden border border-gray-100 rounded-2xl">
          <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
          <div className="px-6 py-5 border-b border-gray-100">
            <SectionLabel className="text-green-600">Carburant</SectionLabel>
            <h2 className="text-lg font-semibold text-gray-900 mt-1">Enregistrer un plein</h2>
            <p className="text-xs text-gray-500 mt-1">
              Saisissez la date, quantité, coût et kilométrage pour suivre la consommation.
            </p>
          </div>
          <div className="px-6 py-5 bg-gray-50/50">
            <FuelRecordForm
              embedded
              onSuccess={() => setIsFormOpen(false)}
              onCancel={() => setIsFormOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isRechargeDialogOpen} onOpenChange={setIsRechargeDialogOpen}>
        <DialogContent className="max-w-xl p-0 overflow-hidden border border-gray-100 rounded-2xl">
          <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
          <div className="px-6 py-5 border-b border-gray-100">
            <SectionLabel className="text-green-600">Carte carburant</SectionLabel>
            <h2 className="text-lg font-semibold text-gray-900 mt-1">Recharger la carte</h2>
            <p className="text-xs text-gray-500 mt-1">
              Action réservée à l&apos;administrateur, au logisticien et à la secrétaire.
            </p>
          </div>
          <div className="px-6 py-5 space-y-4 bg-gray-50/50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Montant (FCFA) *</p>
                <Input
                  type="number"
                  min="1"
                  value={rechargeForm.amount}
                  onChange={(e) => setRechargeForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="Ex: 500000"
                />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Source du prix/L *</p>
                <Select
                  value={rechargeForm.priceMode}
                  onValueChange={(value) => setRechargeForm((prev) => ({ ...prev, priceMode: value as FuelPriceMode }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {realUnitPrice > 0 && <SelectItem value="real">Prix réel ({realUnitPrice} FCFA/L)</SelectItem>}
                    <SelectItem value="fallback">Prix de référence ({fallbackUnitPrice} FCFA/L)</SelectItem>
                    {canEditFuelPrice && <SelectItem value="manual">Prix manuel</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {canEditFuelPrice && rechargeForm.priceMode === "manual" && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Prix manuel (FCFA/L) *</p>
                <Input
                  type="number"
                  min="1"
                  step="0.01"
                  value={rechargeForm.manualUnitPrice}
                  onChange={(e) => setRechargeForm((prev) => ({ ...prev, manualUnitPrice: e.target.value }))}
                  placeholder="Ex: 828"
                />
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Prix/L utilisé</p>
                <Input value={Number.isFinite(selectedUnitPrice) && selectedUnitPrice > 0 ? `${selectedUnitPrice.toFixed(2)} FCFA/L` : "Non défini"} readOnly />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Quantité calculée (L)</p>
                <Input
                  value={computedQuantity > 0 ? computedQuantity.toFixed(2) : ""}
                  readOnly
                  placeholder="Saisissez un montant"
                />
              </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <p>
                Prix réel actuel:{" "}
                <span className="font-semibold">
                  {realUnitPrice > 0 ? `${realUnitPrice} FCFA/L` : "indisponible"}
                </span>
              </p>
              <p>
                Prix de référence:{" "}
                <span className="font-semibold">{fallbackUnitPrice} FCFA/L</span>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Date *</p>
                <Input
                  type="date"
                  value={rechargeForm.date}
                  onChange={(e) => setRechargeForm((prev) => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1">Mode de paiement *</p>
                <Select
                  value={rechargeForm.paymentMode}
                  onValueChange={(value) => setRechargeForm((prev) => ({ ...prev, paymentMode: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="virement">Virement</SelectItem>
                    <SelectItem value="cheque">Chèque</SelectItem>
                    <SelectItem value="especes">Espèces</SelectItem>
                    <SelectItem value="mobile">Mobile Money</SelectItem>
                    <SelectItem value="autre">Autre</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">N° commande / Référence (optionnel)</p>
              <Input
                value={rechargeForm.orderNumber}
                onChange={(e) => setRechargeForm((prev) => ({ ...prev, orderNumber: e.target.value }))}
                placeholder="Ex: BC-20260319-001"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Notes (optionnel)</p>
              <Input
                value={rechargeForm.notes}
                onChange={(e) => setRechargeForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Commentaires internes"
              />
            </div>

            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              Solde actuel: <span className="font-semibold">{formatCurrency(Number(fuelCardBalance?.balance || 0))}</span>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                onClick={() => setIsRechargeDialogOpen(false)}
                disabled={rechargeCardMutation.isPending}
              >
                Annuler
              </Button>
              <Button
                onClick={() => rechargeCardMutation.mutate()}
                disabled={rechargeCardMutation.isPending || !canSubmitRecharge}
                data-testid="button-submit-fuel-card-recharge"
              >
                {rechargeCardMutation.isPending ? "Recharge..." : "Valider la recharge"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingRecord)} onOpenChange={(open) => !open && setEditingRecord(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden border border-gray-100 rounded-2xl">
          <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
          <div className="px-6 py-5 border-b border-gray-100">
            <DialogHeader>
              <DialogTitle>Modifier le plein</DialogTitle>
              <DialogDescription>
                Mettez à jour les informations de cet enregistrement carburant.
              </DialogDescription>
            </DialogHeader>
          </div>
          {editingRecord ? (
            <div className="px-6 py-5 bg-gray-50/50">
              <FuelRecordForm
                embedded
                // La ligne en base n'a pas la forme du formulaire: `cost` est
                // une colonne numeric renvoyee en `string`, et les champs
                // optionnels sont `null`. On convertit ici, la ou on connait la
                // forme de la donnee, plutot que d'elargir le type du composant.
                initialData={{
                  vehicleId: editingRecord.vehicleId ?? undefined,
                  date: editingRecord.date ?? undefined,
                  quantity: Number(editingRecord.quantity ?? 0),
                  cost: Number(editingRecord.cost ?? 0),
                  mileage: editingRecord.mileage ?? undefined,
                  fullTank: editingRecord.fullTank ?? undefined,
                  notes: editingRecord.notes ?? undefined,
                }}
                isEdit
                fuelRecordId={editingRecord.id}
                onSuccess={() => {
                  setEditingRecord(null);
                  queryClient.invalidateQueries({ queryKey: ["/api/fuel-records"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/fuel-records/statistics"] });
                }}
                onCancel={() => setEditingRecord(null)}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deletingRecord)} onOpenChange={(open) => !open && setDeletingRecord(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer ce plein ?</DialogTitle>
            <DialogDescription>
              Cette action est irréversible. Le plein sera retiré de l&apos;historique et des calculs de consommation.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingRecord(null)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={deleteFuelRecordMutation.isPending || !deletingRecord}
              onClick={() => deletingRecord && deleteFuelRecord(deletingRecord.id)}
            >
              {deleteFuelRecordMutation.isPending ? "Suppression..." : "Supprimer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Mascot Helper */}
      <MascotHelper currentPage="fuel" />
    </PageLayout>
  );
}
