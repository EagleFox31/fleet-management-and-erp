import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAllVehicles } from "@/hooks/use-all-vehicles";
import { useLocation } from "wouter";
import { Plus, AlertTriangle, Package, TrendingUp, Truck, Activity, Timer, DollarSign, RotateCcw, Gauge, Eye, Edit, ShoppingCart, Save, Calendar, MapPin, Car, Clock, FileText, CircleDot, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadingError } from "@/components/ui/loading-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Textarea } from "@/components/ui/textarea";
import { CardShell, HeaderCard, KpiGrid, KpiTile, SectionLabel, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { TireWizardForm } from "@/components/inventory/tire-wizard-form";
import { TireTable, type TireTableRow } from "@/components/inventory/tire-table";
import { VehicleTireMountDialog } from "@/components/vehicles/vehicle-tire-mount-dialog";
import { VehicleTireRemoveDialog, type MountedTireToRemove } from "@/components/vehicles/vehicle-tire-remove-dialog";
import { canMountTiresFromStock } from "@/lib/auth";
import { formatTireUsageLabel, computeTireWearScore } from "@shared/constants/tires";
import { getVehicleTireStatusLabel } from "@shared/constants/tire-removal";
import { cn } from "@/lib/utils";
import { tiresPageState } from "@/lib/tires-page-state";
import { fetchAllTires } from "@/lib/fetch-all-pages";
import { queryView } from "@/lib/query-view";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { useFormDraft } from "@/hooks/use-form-draft";
import { FormDraftBadge, FormDraftDiscardButton } from "@/components/form-draft/form-draft-indicator";
import { tireRotationDraft, tireInspectionDraft } from "@/lib/form-drafts";
import type { TireStatisticsAdvancedJson } from "@shared/contracts/tire-statistics-advanced";
import {
  actionCount,
  listCount,
  statText,
  stockAlertCount,
  toTireStatisticsView,
  type TireStatisticsView,
} from "@/lib/tire-statistics-view";

interface VehicleTire {
  id: number;
  vehicleId: number;
  vehicleRegistration: string;
  tireId: number;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  position: string;
  installationDate: string;
  installationMileage: number;
  currentTreadDepth: number;
  initialTreadDepth: number;
  currentPressure: number;
  recommendedPressure: number;
  status: string;
  wearScore: number;
}

interface TireInspection {
  id: number;
  vehicleTireId: number;
  vehicleId?: number;
  vehicleRegistration: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  tireBrand: string;
  tireModel?: string;
  tireSize?: string;
  tireSerialNumber?: string;
  position: string;
  inspectionDate: string;
  inspectionMileage?: number;
  treadDepth: number;
  pressure: number;
  wearPattern: string;
  condition: string;
  hasDefects: boolean;
  defectDescription?: string;
  recommendedAction: string;
  nextInspectionDate: string;
  notes?: string;
  inspectedBy?: number;
  inspectorName?: string;
  createdAt?: string;
}

// Schéma de validation pour nouveau pneu selon normes Kaizen et internationales
// Schéma pour la planification de rotation
const rotationSchema = z.object({
  vehicleId: z.number().min(1, "Sélectionnez un véhicule"),
  rotationDate: z.string().min(1, "Date obligatoire"),
  rotationMileage: z.number().min(0, "Kilométrage obligatoire"),
  rotationType: z.enum(["front_to_back", "cross_rotation", "rearward_cross", "forward_cross"]),
  cost: z.number().min(0).optional(),
  nextRotationMileage: z.number().min(0).optional(),
  notes: z.string().optional()
});

type RotationFormData = z.infer<typeof rotationSchema>;

// Schéma pour une nouvelle inspection (correspondant au schéma DB)
const inspectionSchema = z.object({
  vehicleTireId: z.number().min(1, "Sélectionnez un pneu monté"),
  inspectionDate: z.string().min(1, "Date d'inspection obligatoire"),
  inspectionMileage: z.number().min(0, "Kilométrage obligatoire"),
  treadDepth: z.number().min(0, "Profondeur de sculpture obligatoire").max(20, "Maximum 20mm"),
  pressure: z.number().min(0, "Pression obligatoire").max(15, "Maximum 15 bar"),
  wearPattern: z.enum(["normal", "center_wear", "edge_wear", "irregular", "cupping"]),
  condition: z.enum(["excellent", "good", "fair", "poor", "critical"]),
  hasDefects: z.boolean(),
  defectDescription: z.string().optional(),
  recommendedAction: z.enum(["continue", "monitor", "rotate", "repair", "replace"]),
  nextInspectionDate: z.string().min(1, "Prochaine inspection obligatoire"),
  notes: z.string().optional()
});

type InspectionFormData = z.infer<typeof inspectionSchema>;

const normalizeVehicleTireRow = (row: Record<string, unknown>): VehicleTire | null => {
  const nested = row.vehicle_tires ?? row.vehicleTires;
  const vt = (nested ?? row) as Record<string, unknown>;
  const tire = (row.tires ?? {}) as Record<string, unknown>;
  const vehicle = (row.vehicles ?? {}) as Record<string, unknown>;
  const id = Number(vt.id);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  const status = String(vt.status ?? "active");
  if (status !== "active") {
    return null;
  }

  const currentTreadDepth = Number(vt.currentTreadDepth ?? vt.current_tread_depth);
  const initialTreadDepth = Number(vt.initialTreadDepth ?? vt.initial_tread_depth);

  return {
    id,
    vehicleId: Number(vt.vehicleId ?? vt.vehicle_id),
    vehicleRegistration: String(
      row.vehicleRegistration ?? vehicle.registrationNumber ?? vehicle.registration_number ?? "—",
    ),
    tireId: Number(vt.tireId ?? vt.tire_id),
    tireBrand: String(row.tireBrand ?? tire.brand ?? "—"),
    tireModel: String(row.tireModel ?? tire.model ?? ""),
    tireSize: String(row.tireSize ?? tire.size ?? ""),
    position: String(vt.position ?? ""),
    installationDate: String(vt.installationDate ?? vt.installation_date ?? ""),
    installationMileage: Number(vt.installationMileage ?? vt.installation_mileage ?? 0),
    currentTreadDepth: Number.isFinite(currentTreadDepth) ? currentTreadDepth : 0,
    initialTreadDepth: Number.isFinite(initialTreadDepth) ? initialTreadDepth : 0,
    currentPressure: Number(vt.currentPressure ?? vt.current_pressure ?? 0),
    recommendedPressure: Number(vt.recommendedPressure ?? vt.recommended_pressure ?? 0),
    status,
    wearScore: Number.isFinite(Number(row.wearScore))
      ? Number(row.wearScore)
      : computeTireWearScore(currentTreadDepth, initialTreadDepth),
  };
};

// Composant Calendrier des Rotations
const RotationsCalendar = ({ rotations }: { rotations: any[] }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedRotation, setSelectedRotation] = useState<any>(null);
  const [showRotationDetails, setShowRotationDetails] = useState(false);
  
  // Générer le calendrier du mois actuel
  const generateCalendar = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(firstDay.getDate() - firstDay.getDay());
    
    const calendar: Array<Array<{
      date: Date;
      dateString: string;
      isCurrentMonth: boolean;
      rotations: any[];
    }>> = [];
    const currentCalendarDate = new Date(startDate);
    
    for (let week = 0; week < 6; week++) {
      const weekDays: Array<{
        date: Date;
        dateString: string;
        isCurrentMonth: boolean;
        rotations: any[];
      }> = [];
      for (let day = 0; day < 7; day++) {
        const date = new Date(currentCalendarDate);
        const dateString = date.toISOString().split('T')[0];
        const dayRotations = rotations.filter(rotation => 
          rotation.rotationDate === dateString
        );
        
        weekDays.push({
          date: new Date(date),
          dateString,
          isCurrentMonth: date.getMonth() === month,
          rotations: dayRotations
        });
        
        currentCalendarDate.setDate(currentCalendarDate.getDate() + 1);
      }
      calendar.push(weekDays);
      
      if (currentCalendarDate.getMonth() !== month && week >= 4) break;
    }
    
    return calendar;
  };
  
  const calendar = generateCalendar();
  const monthNames = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
  ];
  
  const dayNames = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  
  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };
  
  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };
  
  const getRotationTypeLabel = (type: string) => {
    const labels = {
      'front_to_back': 'Avant→Arrière',
      'cross_rotation': 'Croisée',
      'rearward_cross': 'Croisée Arr.',
      'forward_cross': 'Croisée Av.'
    };
    return labels[type as keyof typeof labels] || type;
  };
  
  return (
    <div className="space-y-4">
      {/* En-tête du calendrier */}
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={previousMonth} size="sm">
          ←
        </Button>
        <h3 className="text-lg font-semibold">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h3>
        <Button variant="outline" onClick={nextMonth} size="sm">
          →
        </Button>
      </div>
      
      {/* Jours de la semaine */}
      <div className="grid grid-cols-7 gap-1">
        {dayNames.map(day => (
          <div key={day} className="p-2 text-center text-sm font-medium text-gray-500">
            {day}
          </div>
        ))}
      </div>
      
      {/* Grille du calendrier */}
      <div className="grid grid-cols-7 gap-1 border rounded-lg overflow-hidden">
        {calendar.map((week, weekIndex) => (
          week.map((day, dayIndex) => (
            <div
              key={`${weekIndex}-${dayIndex}`}
              className={`min-h-[100px] p-2 border-r border-b ${
                !day.isCurrentMonth ? 'bg-gray-50 text-gray-400' : 'bg-white'
              } ${day.rotations.length > 0 ? 'bg-green-50' : ''}`}
            >
              <div className="text-sm font-medium mb-1">
                {day.date.getDate()}
              </div>
              
              {/* Rotations du jour */}
              <div className="space-y-1">
                {day.rotations.map((rotation, index) => (
                  <div
                    key={rotation.id}
                    className="text-xs p-1 bg-green-100 rounded border-l-2 border-green-500 cursor-pointer hover:bg-green-200 transition-colors"
                    onClick={() => {
                      setSelectedRotation(rotation);
                      setShowRotationDetails(true);
                    }}
                  >
                    <div className="font-medium truncate">
                      {rotation.vehicleRegistration}
                    </div>
                    <div className="text-green-700">
                      {getRotationTypeLabel(rotation.rotationType)}
                    </div>
                    <div className="text-gray-600">
                      {rotation.rotationMileage?.toLocaleString()} km
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        ))}
      </div>
      
      {/* Légende */}
      <div className="flex items-center space-x-4 text-sm text-gray-600">
        <div className="flex items-center space-x-2">
          <div className="w-4 h-4 bg-green-100 border-l-2 border-green-500 rounded"></div>
          <span>Rotation planifiée</span>
        </div>
        <div className="text-muted-foreground">
          Total ce mois : {rotations.filter(r => {
            const rotationMonth = new Date(r.rotationDate).getMonth();
            const rotationYear = new Date(r.rotationDate).getFullYear();
            return rotationMonth === currentDate.getMonth() && rotationYear === currentDate.getFullYear();
          }).length} rotation(s)
        </div>
      </div>
      
      {/* Modal de détails de rotation */}
      {showRotationDetails && selectedRotation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-green-700 flex items-center">
                <RotateCcw className="h-5 w-5 mr-2" />
                Détails de la Rotation
              </h3>
              <Button variant="ghost" onClick={() => setShowRotationDetails(false)}>
                ×
              </Button>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-600">Véhicule</label>
                  <p className="text-sm font-medium">{selectedRotation.vehicleRegistration}</p>
                  <p className="text-xs text-gray-500">
                    {selectedRotation.vehicleBrand} {selectedRotation.vehicleModel}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Date</label>
                  <p className="text-sm">{new Date(selectedRotation.rotationDate).toLocaleDateString('fr-FR')}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-600">Type de Rotation</label>
                  <p className="text-sm">{getRotationTypeLabel(selectedRotation.rotationType)}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Kilométrage</label>
                  <p className="text-sm">{selectedRotation.rotationMileage?.toLocaleString()} km</p>
                </div>
              </div>
              
              {selectedRotation.cost && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Coût</label>
                  <p className="text-sm">{parseFloat(selectedRotation.cost).toLocaleString()} XAF</p>
                </div>
              )}
              
              {selectedRotation.nextRotationMileage && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Prochaine Rotation</label>
                  <p className="text-sm">{selectedRotation.nextRotationMileage?.toLocaleString()} km</p>
                </div>
              )}
              
              {selectedRotation.notes && (
                <div>
                  <label className="text-sm font-medium text-gray-600">Notes</label>
                  <p className="text-sm bg-gray-50 p-2 rounded">{selectedRotation.notes}</p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-600">Créé par</label>
                  <p className="text-sm">{selectedRotation.createdBy || "Admin"}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-600">Date de création</label>
                  <p className="text-sm">{new Date(selectedRotation.createdAt).toLocaleDateString('fr-FR')} à {new Date(selectedRotation.createdAt).toLocaleTimeString('fr-FR')}</p>
                </div>
              </div>
            </div>
            
            <div className="flex justify-end mt-6">
              <Button onClick={() => setShowRotationDetails(false)}>
                Fermer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const RECENT_INSPECTIONS_LIMIT = 10;

export default function TiresInventoryPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("inventory");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // États pour les modals
  const [selectedTire, setSelectedTire] = useState<TireTableRow | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRotationModal, setShowRotationModal] = useState(false);
  const [showInspectionModal, setShowInspectionModal] = useState(false);
  const [showInspectionDetailModal, setShowInspectionDetailModal] = useState(false);
  const [selectedInspection, setSelectedInspection] = useState<TireInspection | null>(null);
  const [showMountDialog, setShowMountDialog] = useState(false);
  const [mountPreselectedTireId, setMountPreselectedTireId] = useState<number | undefined>();
  const [tireToRemove, setTireToRemove] = useState<MountedTireToRemove | null>(null);

  // Formulaire planification rotation
  const rotationForm = useForm<RotationFormData>({
    resolver: zodResolver(rotationSchema),
    defaultValues: {
      vehicleId: 0,
      rotationDate: new Date().toISOString().split('T')[0],
      rotationMileage: 0,
      rotationType: "front_to_back",
      cost: 0,
      nextRotationMileage: 0,
      notes: ""
    }
  });

  const { draftSavedAt: draftRotation, clearDraft: clearDraftRotation, discardDraft: discardDraftRotation } = useFormDraft({
    form: rotationForm as any,
    storage: tireRotationDraft.storage as any,
    isEmpty: tireRotationDraft.isEmpty as any,
  });

  // Formulaire nouvelle inspection
  const inspectionForm = useForm<InspectionFormData>({
    resolver: zodResolver(inspectionSchema),
    defaultValues: {
      vehicleTireId: 0,
      inspectionDate: new Date().toISOString().split('T')[0],
      inspectionMileage: 0,
      treadDepth: 8,
      pressure: 8.5,
      wearPattern: "normal",
      condition: "good",
      hasDefects: false,
      defectDescription: "",
      recommendedAction: "continue",
      nextInspectionDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      notes: ""
    }
  });

  const { draftSavedAt: draftInspection, clearDraft: clearDraftInspection, discardDraft: discardDraftInspection } = useFormDraft({
    form: inspectionForm as any,
    storage: tireInspectionDraft.storage as any,
    isEmpty: tireInspectionDraft.isEmpty as any,
  });

  // Mutation pour planifier une rotation
  const createRotationMutation = useMutation({
    mutationFn: async (data: RotationFormData) => {
      const response = await fetch('/api/tire-rotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rotation: data })
      });
      if (!response.ok) throw new Error('Erreur lors de la planification de la rotation');
      return response.json();
    },
    onSuccess: (result) => {
      clearDraftRotation(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      queryClient.invalidateQueries({ queryKey: ['/api/tire-rotations'] });
      // Tuile « Rotations ce mois » (couche 3, écran satellite).
      queryClient.invalidateQueries({ queryKey: ['/api/tires/statistics-advanced'] });
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders/statistics'] });
      setShowRotationModal(false);
      rotationForm.reset();
      toast({
        title: "Rotation planifiée avec succès",
        description: result?.workOrder 
          ? `Ordre de travail #${result.workOrder.id} créé automatiquement pour ${result.vehicleRegistration}`
          : "La rotation de pneus a été planifiée avec succès"
      });
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: "Impossible de planifier la rotation. Veuillez réessayer.",
        variant: "destructive"
      });
    }
  });

  // Mutation pour créer une inspection
  const createInspectionMutation = useMutation({
    mutationFn: async (data: InspectionFormData) => {
      const response = await fetch('/api/tire-inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error('Erreur lors de la création de l\'inspection');
      return response.json();
    },
    onSuccess: (data) => {
      clearDraftInspection(); // saisie enregistree: le brouillon n'a plus lieu d'etre
      queryClient.invalidateQueries({ queryKey: ['/api/tire-inspections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tire-inspections/recent'] });
      queryClient.invalidateQueries({ queryKey: ['/api/vehicle-tires'] });
      setShowInspectionModal(false);
      inspectionForm.reset();
      toast({
        title: "Inspection enregistrée",
        description: "L'inspection du pneu a été enregistrée avec succès"
      });
      
      // Si recommandation = rotation, proposer d'ouvrir le formulaire de rotation
      const recommendedAction = inspectionForm.getValues('recommendedAction');
      if (recommendedAction === 'rotate') {
        setShowRotationModal(true);
        // Pré-remplir le formulaire de rotation avec les données de l'inspection
        const vehicleTireId = inspectionForm.getValues('vehicleTireId');
        const selectedVehicleTire = mountedTires.find((vt: VehicleTire) => vt.id === vehicleTireId);
        if (selectedVehicleTire) {
          rotationForm.setValue('vehicleId', selectedVehicleTire.vehicleId);
          rotationForm.setValue('rotationMileage', inspectionForm.getValues('inspectionMileage'));
          rotationForm.setValue('rotationDate', inspectionForm.getValues('inspectionDate'));
          rotationForm.setValue('notes', `Suite à l'inspection du ${new Date().toLocaleDateString('fr-FR')} - Rotation recommandée`);
        }
      }
    },
    onError: (error) => {
      toast({
        title: "Erreur",
        description: "Impossible d'enregistrer l'inspection. Veuillez réessayer.",
        variant: "destructive"
      });
    }
  });

  // Fonctions pour gérer les modals
  const handleViewTire = (tire: TireTableRow) => {
    setSelectedTire(tire);
    setShowViewModal(true);
  };

  const handleEditTire = (tire: TireTableRow) => {
    setSelectedTire(tire);
    setShowEditModal(true);
  };

  const isInspectionsTab = activeTab === "inspections";
  const isMountedTab = activeTab === "mounted";
  const isRotationsTab = activeTab === "rotations";

  const liveQueryConfig = {
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  } as const;
  // Stock complet : sans `limit`, `/api/tires` ne rend que 20 pneus, et le tableau paginait
  // côté client sur ces 20 seulement (« x sur 20 »). Toutes les pages sont lues ; une lecture
  // incomplète est une erreur, jamais un stock partiel.
  const tiresQuery = useQuery<TireTableRow[]>({
    queryKey: ["/api/tires", "all"],
    queryFn: () => fetchAllTires<TireTableRow>(),
    ...liveQueryConfig,
  });

  const tires = tiresQuery.data ?? [];

  // Ces trois requêtes alimentent les KPI de l'en-tête, affichés quel que soit
  // l'onglet actif: elles ne doivent pas être conditionnées à un onglet.
  // queryFn par défaut : une erreur serveur arrive en ApiError (message lisible + référence).
  // `select` : les sommes servies en texte sont converties une seule fois (`toTireStatisticsView`) ;
  // une valeur illisible ou une liste absente s'affiche « Indisponible », jamais 0.
  const statsQuery = useQuery<TireStatisticsAdvancedJson, Error, TireStatisticsView>({
    queryKey: ["/api/tires/statistics-advanced"],
    select: toTireStatisticsView,
    ...liveQueryConfig,
  });
  const statistics = statsQuery.data;
  const pageState = tiresPageState(tiresQuery, statsQuery);
  const statsActions = statistics?.requiredActions;

  // Lignes brutes: l'API renvoie une jointure (vehicle_tires / tires / vehicles),
  // que `normalizeVehicleTireRow` aplatit en `VehicleTire`. Typer la requete en
  // `VehicleTire[]` etait faux et obligeait a un cast au point d'usage.
  // queryFn par défaut (ApiError lisible). En échec sans données : « Indisponible » sur les KPI
  // et un encart « Réessayer » dans l'onglet, jamais « Aucun… » ni 0 (`queryView`, #592).
  const vehicleTiresQuery = useQuery<Record<string, unknown>[]>({
    queryKey: ["/api/vehicle-tires"],
    ...liveQueryConfig,
  });
  const vehicleTires = vehicleTiresQuery.data;
  const vehicleTiresView = queryView(vehicleTiresQuery);

  const inspectionsQuery = useQuery<TireInspection[]>({
    // Les 10 dernières, dit explicitement (défaut serveur identique).
    queryKey: ["/api/tire-inspections/recent", { limit: RECENT_INSPECTIONS_LIMIT }],
    ...liveQueryConfig,
  });
  const inspectionsView = queryView(inspectionsQuery);

  const { data: fleetStats } = useQuery<{
    operational?: number;
    maintenance?: number;
    outOfService?: number;
    availabilityRate?: number;
  }>({
    queryKey: ["/api/statistics/fleet"],
    enabled: user?.role === "logistics",
    ...liveQueryConfig,
  });

  const mountedTires = useMemo(
    () =>
      (vehicleTires ?? [])
        .map((row) => normalizeVehicleTireRow(row))
        .filter((row): row is VehicleTire => row !== null),
    [vehicleTires],
  );

  const fleetOperational = Number(fleetStats?.operational || 0);
  const fleetMaintenance = Number(fleetStats?.maintenance || 0);
  const fleetOutOfService = Number(fleetStats?.outOfService || 0);
  const fleetTotal = fleetOperational + fleetMaintenance + fleetOutOfService;
  const fleetImmobilized = fleetMaintenance + fleetOutOfService;
  const fleetAvailabilityPct =
    fleetTotal > 0
      ? Math.round(Number(fleetStats?.availabilityRate ?? (fleetOperational / fleetTotal) * 100))
      : null;

  // `null` : statistiques indisponibles, jamais confondues avec « aucune alerte ».
  const rotationDueCount = listCount(statsActions?.rotationDue);
  const rotationApproachingCount = listCount(statsActions?.rotationApproaching);
  const tireRotationsPending =
    rotationDueCount === null || rotationApproachingCount === null ? null : rotationDueCount + rotationApproachingCount;
  const rotationKpiSubValue =
    tireRotationsPending === null || rotationDueCount === null || rotationApproachingCount === null
      ? "Alertes kilométriques indisponibles"
      : tireRotationsPending === 0
      ? vehicleTiresView.kind === "ready" && mountedTires.length === 0
        ? "Montages atelier requis d'abord"
        : "Aucune alerte kilométrique"
      : rotationDueCount > 0 && rotationApproachingCount > 0
        ? `${rotationDueCount} en retard · ${rotationApproachingCount} bientôt`
        : rotationDueCount > 0
          ? `${rotationDueCount} en retard`
          : `${rotationApproachingCount} dans les 5 000 km`;

  // `lowStockTires` supprimé avec l'onglet Tableau de bord: `TireTable` colore
  // déjà les lignes sous seuil et propose un filtre dédié.

  // Flotte complète (toutes les pages) : le sélecteur de rotation ne se limite pas aux 10 premiers.
  const { data: vehicles = [], isLoading: vehiclesLoading } = useAllVehicles({ enabled: isRotationsTab || showRotationModal });

  // Toutes les rotations : la route lit `limit` sans l'appliquer et rend la liste entière
  // (vérifié par le garde-fou des lectures paginées).
  const rotationsQuery = useQuery<any[]>({
    queryKey: ["/api/tire-rotations"],
    enabled: isRotationsTab,
    ...liveQueryConfig,
  });
  const rotationsView = queryView(rotationsQuery);

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XAF',
      minimumFractionDigits: 0,
    }).format(price);
  };

  const getWearColor = (wearScore: number) => {
    if (wearScore >= 80) return "text-green-600";
    if (wearScore >= 60) return "text-yellow-600";
    if (wearScore >= 40) return "text-orange-600";
    return "text-red-600";
  };

  const getConditionBadge = (condition: string) => {
    const colors = {
      excellent: "bg-green-100 text-green-800",
      good: "bg-blue-100 text-blue-800", 
      fair: "bg-yellow-100 text-yellow-800",
      poor: "bg-red-100 text-red-800",
      excellente: "bg-green-100 text-green-800",
      bonne: "bg-blue-100 text-blue-800",
      correcte: "bg-yellow-100 text-yellow-800",
      mauvaise: "bg-red-100 text-red-800"
    };
    return colors[condition as keyof typeof colors] || "bg-gray-100 text-gray-800";
  };

  const translateCondition = (condition: string) => {
    const translations = {
      excellent: "Excellente",
      good: "Bonne", 
      fair: "Correcte",
      poor: "Mauvaise",
      continue: "Continuer",
      monitor: "Surveiller",
      normal: "Normale",
      edge_wear: "Usure latérale"
    };
    return translations[condition as keyof typeof translations] || condition;
  };

  const translateAction = (action: string) => {
    const translations = {
      continue: "Continuer",
      monitor: "Surveiller",
      rotate: "Rotation",
      repair: "Réparer", 
      replace: "Remplacer"
    };
    return translations[action as keyof typeof translations] || action;
  };

  const translatePosition = (position: string) => {
    const translations = {
      front_left: "Avant gauche",
      front_right: "Avant droit",
      rear_left: "Arrière gauche", 
      rear_right: "Arrière droit",
      rear_left_inner: "Arrière gauche int.",
      rear_left_outer: "Arrière gauche ext.",
      rear_right_inner: "Arrière droit int.",
      rear_right_outer: "Arrière droit ext.",
      spare: "Roue de secours"
    };
    return translations[position as keyof typeof translations] || position;
  };

  const translateWearPattern = (pattern: string) => {
    const translations = {
      normal: "Normale (uniforme)",
      center_wear: "Usure centre (surgonflage)",
      edge_wear: "Usure bords (sous-gonflage)",
      irregular: "Usure irrégulière",
      cupping: "Cupping (suspension)"
    };
    return translations[pattern as keyof typeof translations] || pattern;
  };

  // Permissions basées sur les rôles
  const canAddTires = user?.role === 'admin' || user?.role === 'warehouse';
  const canMountFromStock = canMountTiresFromStock(user);
  const canPlanRotations = user?.role === 'admin' || user?.role === 'workshop_manager';
  const canViewRotations =
    canPlanRotations ||
    canAddTires ||
    user?.role === "logistics" ||
    user?.role === "secretary";

  const openMountDialog = (tireId?: number) => {
    setMountPreselectedTireId(tireId);
    setShowMountDialog(true);
  };
  const canViewAll = user?.role === 'admin';
  const isTechnician = user?.role === 'technician';

  const tireNavTabs = useMemo(() => {
    // Onglet "Tableau de bord" retiré: ses deux blocs faisaient doublon.
    // Le stock critique est signalé par les lignes colorées et le filtre de
    // `TireTable`; les inspections ont leur propre onglet. Les KPI de l'en-tête,
    // désormais cliquables, servent de point d'entrée.
    const tabs = [
      { value: "inventory", label: "Inventaire", icon: <TabIcon icon={Package} />, testId: "tab-inventory" },
    ];
    if (canAddTires) {
      tabs.push({ value: "new-tire", label: "Nouveau pneu", icon: <TabIcon icon={Plus} />, testId: "tab-new-tire" });
    }
    tabs.push(
      { value: "mounted", label: "Pneus montes", icon: <TabIcon icon={Truck} />, testId: "tab-mounted" },
      { value: "inspections", label: "Inspections", icon: <TabIcon icon={Eye} />, testId: "tab-inspections" },
    );
    if (canViewRotations) {
      tabs.push({ value: "rotations", label: "Rotations", icon: <TabIcon icon={RotateCcw} />, testId: "tab-rotations" });
    }
    return tabs;
  }, [canAddTires, canViewRotations]);

  if (pageState.kind === "error") {
    return (
      <LoadingError
        error={pageState.error}
        isRetrying={pageState.isRetrying}
        onRetry={() => {
          void tiresQuery.refetch();
          void statsQuery.refetch();
        }}
      />
    );
  }

  if (pageState.kind === "loading") {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-96 mt-2" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-16" />
              </CardHeader>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Stock / Pneus"
        title="Suivi des pneus"
        subtitle="Gestion complete : inventaire, usure, rotations et maintenance preventive"
        icon={<Package className="h-5 w-5" />}
        actions={
          canAddTires || canMountFromStock ? (
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {canMountFromStock && (
              <Button
                variant="outline"
                  onClick={() => openMountDialog()}
                  data-testid="button-mount-tire"
                >
                  <CircleDot className="h-4 w-4 mr-2" />
                  Monter sur véhicule
                </Button>
              )}
              {canAddTires && (
                <>
                  <Button
                    variant="outline"
                    comingSoon="La commande de pneus auprès d'un fournisseur"
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                Commander
              </Button>
              <Button onClick={() => setActiveTab("new-tire")} data-testid="button-new-tire">
                <Plus className="h-4 w-4 mr-2" />
                Nouveau pneu
              </Button>
                </>
              )}
            </div>
          ) : null
        }
      >
        {/* Statistiques sans données : encart d'erreur à la place de tuiles à zéro ; la liste reste visible. */}
        {pageState.statsError ? (
          <LoadingError
            error={pageState.statsError.error}
            isRetrying={pageState.statsError.isRetrying}
            onRetry={() => void statsQuery.refetch()}
          />
        ) : (
        <KpiGrid columns={4}>
          {/* Tuiles cliquables: chacune mène à l'onglet qui détaille son chiffre.
              Même motif que les KPI de /maintenance/work-orders. */}
          <KpiTile
            data-testid="kpi-stock-quantity"
            className="cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => setActiveTab("inventory")}
            label="Pneus en stock"
            value={statText(statistics?.totalTires)}
            subValue={
              vehicleTiresView.kind === "ready"
                ? `${mountedTires.length} montés sur véhicules`
                : `Montés sur véhicules : ${vehicleTiresView.kind === "error" ? UNAVAILABLE.toLowerCase() : "…"}`
            }
            icon={<Package className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />

          {user?.role === "admin" && (
            <KpiTile
              data-testid="kpi-total-value"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inventory")}
              label="Valeur inventaire"
              value={statText(statistics?.totalValue, formatPrice)}
              subValue="Cout total des pneus en stock"
              icon={<DollarSign className="h-4 w-4" />}
              iconWrapperClassName="bg-emerald-50 text-emerald-600"
            />
          )}

          {user?.role === "warehouse" && (
            <KpiTile
              data-testid="kpi-low-stock"
              onClick={() => setActiveTab("inventory")}
              label="Stock critique"
              value={statText(statsActions ? stockAlertCount(statsActions) : null)}
              subValue="References sous le seuil minimal, ruptures comprises"
              valueClassName="text-orange-600"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
              className="border-orange-200 bg-orange-50 cursor-pointer transition-shadow hover:shadow-md"
            />
          )}

          {user?.role === "workshop_manager" && (
            <KpiTile
              data-testid="kpi-rotations-due"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("rotations")}
              label="Rotations a planifier"
              value={statText(rotationDueCount)}
              subValue="Vehicules necessitant rotation"
              valueClassName="text-blue-600"
              icon={<RotateCcw className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
          )}

          {user?.role === "technician" && (
            <KpiTile
              data-testid="kpi-inspections-due"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inspections")}
              label="Inspections dues"
              value={
                inspectionsView.kind === "ready"
                  ? inspectionsView.data.filter((i) => new Date(i.nextInspectionDate) <= new Date()).length
                  : inspectionsView.kind === "error" ? UNAVAILABLE : "…"
              }
              subValue="Controles a effectuer"
              valueClassName="text-orange-600"
              icon={<Timer className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
            />
          )}

          {user?.role === "logistics" && (
            <KpiTile
              data-testid="kpi-vehicles-waiting"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setLocation("/vehicles")}
              label="Véhicules immobilisés"
              value={fleetImmobilized}
              subValue="Maintenance ou hors service"
              valueClassName={fleetImmobilized > 0 ? "text-amber-600" : undefined}
              icon={<Truck className="h-4 w-4" />}
              iconWrapperClassName="bg-amber-50 text-amber-600"
            />
          )}

          {user?.role === "secretary" && (
            <KpiTile
              data-testid="kpi-low-stock-secretary"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inventory")}
              label="Alertes stock"
              value={statText(statsActions ? stockAlertCount(statsActions) : null)}
              subValue="Commandes a preparer"
              valueClassName="text-orange-600"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
            />
          )}

          {user?.role === "admin" && (
            <KpiTile
              data-testid="kpi-rotations-this-month"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("rotations")}
              label="Rotations ce mois"
              value={statText(statistics?.rotationsThisMonth)}
              subValue="Rotations enregistrées ce mois civil"
              icon={<TrendingUp className="h-4 w-4" />}
              iconWrapperClassName="bg-indigo-50 text-indigo-600"
            />
          )}

          {user?.role === "warehouse" && (
            <KpiTile
              data-testid="kpi-stock-rotation"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inventory")}
              label="Valeur stock"
              value={statText(statistics?.totalValue, formatPrice)}
              subValue="Total inventaire pneus"
              icon={<DollarSign className="h-4 w-4" />}
              iconWrapperClassName="bg-emerald-50 text-emerald-600"
            />
          )}

          {user?.role === "workshop_manager" && (
            <KpiTile
              data-testid="kpi-critical-wear"
              onClick={() => setActiveTab("mounted")}
              label="Usure critique"
              value={statText(listCount(statsActions?.criticalWear))}
              subValue="Pneus usure > 80%"
              valueClassName="text-red-600"
              icon={<Gauge className="h-4 w-4" />}
              iconWrapperClassName="bg-red-50 text-red-600"
              className="border-red-200 bg-red-50 cursor-pointer transition-shadow hover:shadow-md"
            />
          )}

          {user?.role === "technician" && (
            <KpiTile
              data-testid="kpi-pressure-check"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inspections")}
              label="Pressions a corriger"
              value={
                vehicleTiresView.kind === "ready"
                  ? mountedTires.filter((vt) => Math.abs(vt.currentPressure - vt.recommendedPressure) > 0.5).length
                  : vehicleTiresView.kind === "error" ? UNAVAILABLE : "…"
              }
              subValue="Ecarts de pression detectes"
              valueClassName="text-blue-600"
              icon={<Gauge className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
          )}

          {user?.role === "logistics" && (
            <KpiTile
              data-testid="kpi-fleet-availability"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setLocation("/vehicles")}
              label="Disponibilité flotte"
              value={fleetAvailabilityPct !== null ? `${fleetAvailabilityPct}%` : "—"}
              subValue={
                fleetTotal > 0
                  ? `${fleetOperational} opérationnels sur ${fleetTotal}`
                  : "Parc véhicules non renseigné"
              }
              valueClassName="text-green-600"
              icon={<Activity className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
          )}

          {user?.role === "secretary" && (
            <KpiTile
              data-testid="kpi-total-value-secretary"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inventory")}
              label="Valeur inventaire"
              value={statText(statistics?.totalValue, formatPrice)}
              subValue="Total pneus en stock"
              icon={<DollarSign className="h-4 w-4" />}
              iconWrapperClassName="bg-emerald-50 text-emerald-600"
            />
          )}

          {user?.role === "admin" && (
            <KpiTile
              data-testid="kpi-actions-required-admin"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inspections")}
              label="Actions requises"
              value={statText(statsActions ? actionCount(statsActions, ["criticalWear", "rotationDue"]) : null)}
              subValue="Actions preventives requises"
              valueClassName="text-orange-600"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
            />
          )}

          {user?.role === "warehouse" && (
            <KpiTile
              data-testid="kpi-locations"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inventory")}
              label="Emplacements"
              value={new Set(tires?.map((t) => t.location) || []).size}
              subValue="Zones de stockage utilisees"
              icon={<MapPin className="h-4 w-4" />}
              iconWrapperClassName="bg-slate-100 text-slate-600"
            />
          )}

          {user?.role === "workshop_manager" && (
            <KpiTile
              data-testid="kpi-average-wear"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("mounted")}
              label="Usure moy. flotte"
              value={statistics?.noInspection ? "Aucune inspection" : statText(statistics?.averageWear, (mm) => `${mm.toFixed(1)}mm`)}
              subValue="Profondeur sculpture moyenne"
              icon={<Gauge className="h-4 w-4" />}
              iconWrapperClassName="bg-slate-100 text-slate-600"
            />
          )}

          {user?.role === "technician" && (
            <KpiTile
              data-testid="kpi-rotations-this-month"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inspections")}
              label="Rotations ce mois"
              value={statText(statistics?.rotationsThisMonth)}
              subValue="Rotations enregistrées ce mois civil"
              valueClassName="text-green-600"
              icon={<RotateCcw className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
          )}

          {user?.role === "logistics" && (
            <KpiTile
              data-testid="kpi-next-maintenance"
              className={cn(
                "cursor-pointer transition-shadow hover:shadow-md",
                activeTab === "rotations" && (tireRotationsPending ?? 0) > 0 && "ring-2 ring-blue-200 shadow-md",
              )}
              onClick={() => setActiveTab("rotations")}
              label="Rotations à planifier"
              value={statText(tireRotationsPending)}
              subValue={rotationKpiSubValue}
              valueClassName={(tireRotationsPending ?? 0) > 0 ? "text-blue-600" : undefined}
              icon={<RotateCcw className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
          )}

          {user?.role === "secretary" && (
            <KpiTile
              data-testid="kpi-actions-secretary"
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => setActiveTab("inspections")}
              label="Actions requises"
              value={statText(statsActions ? actionCount(statsActions, ["criticalWear"]) : null)}
              subValue="Alertes a traiter"
              valueClassName="text-orange-600"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName="bg-orange-50 text-orange-600"
            />
          )}
        </KpiGrid>
        )}
      </HeaderCard>

      {/* Navigation Tabs - conditionnels selon le rôle */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <PremiumTabsNav className="mb-3 w-full flex flex-wrap" tabs={tireNavTabs} />

        <TabsContent value="inventory" className="mt-0">
          <TireTable
            tires={tires}
            isLoading={tiresQuery.isLoading}
            onRowClick={handleViewTire}
            onEdit={handleEditTire}
            onMountFromStock={canMountFromStock ? (tire) => openMountDialog(tire.id) : undefined}
          />
        </TabsContent>

        {/* Nouveau Pneu Tab — wizard 5 étapes + brouillon auto */}
        <TabsContent value="new-tire" className="space-y-6">
          <TireWizardForm
            onSuccess={() => setActiveTab("inventory")}
            onCancel={() => setActiveTab("inventory")}
          />
        </TabsContent>

        {/* Mounted Tires Tab */}
        <TabsContent value="mounted" className="space-y-6">
          <CardShell>
            <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
              <SectionLabel>Etat flotte</SectionLabel>
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mt-1">
                <Truck className="h-4 w-4 text-green-600" />
                Pneus montes sur vehicules
              </h3>
              </div>
              {canMountFromStock && (
                <Button size="sm" variant="outline" onClick={() => openMountDialog()} data-testid="button-mount-from-mounted-tab">
                  <CircleDot className="h-4 w-4 mr-2" />
                  Monter depuis le stock
                </Button>
              )}
            </div>
            <div className="px-5 py-4">
              {vehicleTiresView.kind === "loading" ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : vehicleTiresView.kind === "error" ? (
                <InlineQueryError
                  error={vehicleTiresView.error}
                  fallback="Les pneus montés sont momentanément indisponibles."
                  onRetry={() => void vehicleTiresQuery.refetch()}
                  isRetrying={vehicleTiresView.isRetrying}
                  data-testid="mounted-tires-error"
                />
              ) : mountedTires.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <Truck className="h-10 w-10 text-gray-200 mb-3" />
                  <p className="text-sm font-medium text-gray-600">Aucun pneu monté sur un véhicule</p>
                  <p className="text-xs text-gray-400 mt-1 max-w-md">
                    {/* Stock inconnu (statistiques en échec) : ni « 0 pneu » ni « réceptionner d'abord ». */}
                    {statistics?.totalTires == null
                      ? "Le montage se fait depuis l'atelier, à partir du stock magasin."
                      : statistics.totalTires > 0
                        ? `${statistics.totalTires} pneu(s) en stock magasin — le montage se fait depuis l'atelier.`
                        : "Le magasin doit d'abord réceptionner des pneus, puis l'atelier les monte sur les véhicules."}
                  </p>
                  {canMountFromStock && statistics?.totalTires !== 0 && (
                    <Button size="sm" className="mt-4" onClick={() => openMountDialog()}>
                      <CircleDot className="h-4 w-4 mr-2" />
                      Monter un pneu
                    </Button>
                  )}
                </div>
              ) : (
              <div className="space-y-4">
                {mountedTires.map((vt) => (
                  <div key={vt.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-xl bg-gray-50">
                    <div className="flex items-center space-x-4">
                      <div className="w-3 h-3 rounded-full bg-green-500"></div>
                      <div>
                        <div className="font-medium">
                          {vt.vehicleRegistration} • {translatePosition(vt.position)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {vt.tireBrand} {vt.tireModel} • {vt.tireSize}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Installé: {new Date(vt.installationDate).toLocaleDateString('fr-FR')} • {vt.installationMileage?.toLocaleString()} km
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-6">
                      <div className="text-center">
                        <div className="text-sm font-medium">Usure</div>
                        <div className={`text-lg font-bold ${getWearColor(vt.wearScore)}`}>
                          {vt.wearScore}%
                        </div>
                        <Progress value={vt.wearScore} className="w-16 mt-1" />
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium">Sculpture</div>
                        <div className="text-lg font-bold">
                          {vt.currentTreadDepth}mm
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium">Pression</div>
                        <div className="text-lg font-bold">
                          {vt.currentPressure} bar
                        </div>
                      </div>
                      <Badge className={getConditionBadge(vt.status)}>
                        {getVehicleTireStatusLabel(vt.status)}
                      </Badge>
                      {canMountFromStock && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTireToRemove(vt)}
                          data-testid={`button-remove-tire-${vt.id}`}
                        >
                          <PackageOpen className="h-4 w-4 mr-2" />
                          Démonter
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              )}
            </div>
          </CardShell>
        </TabsContent>

        {/* Inspections Tab */}
        <TabsContent value="inspections" className="space-y-6">
          <CardShell>
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex justify-between items-center">
                <div>
                  <SectionLabel>Controle qualite</SectionLabel>
                  <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mt-1">
                    <Eye className="h-4 w-4 text-green-600" />
                    Historique des inspections
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Contrôles visuels et mesures de l'état des pneus (usure, pression, défauts)
                  </p>
                </div>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button onClick={() => setShowInspectionModal(true)} data-testid="button-new-inspection">
                        <Plus className="h-4 w-4 mr-2" />
                        Nouvelle Inspection
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-xs">
                      <p className="font-semibold">Inspection = Diagnostic</p>
                      <p className="text-sm mt-1">
                        Contrôler l'état actuel d'un pneu : mesurer la profondeur de sculpture, 
                        vérifier la pression, noter les défauts visuels. 
                        Enregistre un rapport d'inspection.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="space-y-4">
                {inspectionsView.kind === "loading" ? (
                <div className="flex justify-center py-8">
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                    <span>Chargement des inspections...</span>
                  </div>
                </div>
              ) : inspectionsView.kind === "error" ? (
                <InlineQueryError
                  error={inspectionsView.error}
                  fallback="Les inspections de pneus sont momentanément indisponibles."
                  onRetry={() => void inspectionsQuery.refetch()}
                  isRetrying={inspectionsView.isRetrying}
                  data-testid="tire-inspections-error"
                />
              ) : inspectionsView.data.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Eye className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Aucune inspection enregistrée</p>
                  <p className="text-sm">Cliquez sur "Nouvelle Inspection" pour commencer</p>
                </div>
              ) : (
                inspectionsView.data.map((inspection) => (
                  <div 
                    key={`inspection-${inspection.id}`} 
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => {
                      setSelectedInspection(inspection);
                      setShowInspectionDetailModal(true);
                    }}
                    data-testid={`inspection-row-${inspection.id}`}
                  >
                    <div className="flex items-center space-x-4">
                      <div className={`w-3 h-3 rounded-full ${
                        inspection.hasDefects ? 'bg-red-500' : 'bg-green-500'
                      }`}></div>
                      <div>
                        <div className="font-medium">
                          {inspection.vehicleRegistration} • {inspection.position}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {inspection.tireBrand} {inspection.tireModel} • {new Date(inspection.inspectionDate).toLocaleDateString('fr-FR')}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Inspecteur: {inspection.inspectorName || 'Non spécifié'} • Prochaine: {inspection.nextInspectionDate ? new Date(inspection.nextInspectionDate).toLocaleDateString('fr-FR') : 'Non planifiée'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-6">
                      <div className="text-center">
                        <div className="text-sm font-medium">Sculpture</div>
                        <div className={`text-lg font-bold ${inspection.treadDepth < 3 ? 'text-red-600' : inspection.treadDepth < 5 ? 'text-yellow-600' : 'text-green-600'}`}>
                          {inspection.treadDepth}mm
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium">Pression</div>
                        <div className="text-lg font-bold">{inspection.pressure} bar</div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium">Usure</div>
                        <div className="text-sm">{translateWearPattern(inspection.wearPattern)}</div>
                      </div>
                      <Badge className={getConditionBadge(inspection.condition)}>
                        {translateCondition(inspection.condition)}
                      </Badge>
                      <Badge variant={inspection.recommendedAction === 'replace' ? 'destructive' : 'secondary'}>
                        {translateAction(inspection.recommendedAction)}
                      </Badge>
                      <Button 
                        variant="ghost" 
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInspection(inspection);
                          setShowInspectionDetailModal(true);
                        }}
                        data-testid={`button-view-inspection-${inspection.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
              </div>
            </div>
          </CardShell>
        </TabsContent>

        {/* Rotations Tab */}
        <TabsContent value="rotations" className="space-y-6">
          <CardShell>
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex justify-between items-center">
                <div>
                  <SectionLabel>Planification</SectionLabel>
                  <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2 mt-1">
                    <RotateCcw className="h-4 w-4 text-green-600" />
                    Planning des rotations
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Échanges de pneus entre positions pour uniformiser l'usure
                  </p>
                </div>
                {canPlanRotations && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button onClick={() => setShowRotationModal(true)} data-testid="button-plan-rotation">
                          <Plus className="h-4 w-4 mr-2" />
                          Planifier Rotation
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs">
                        <p className="font-semibold">Rotation = Maintenance Préventive</p>
                        <p className="text-sm mt-1">
                          Programmer un échange de pneus entre positions (ex: avant ↔ arrière) 
                          pour uniformiser l'usure. Crée un ordre de travail assigné à un technicien.
                        </p>
                      </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              </div>
            </div>
            <div className="px-5 py-4">
              {/* L'erreur et le bouton Réessayer sont dans l'encart en tête de page : ici, une simple mention. */}
              {pageState.kind === "ready" && pageState.statsError ? (
                <p className="mb-5 text-sm text-muted-foreground" data-testid="rotation-alerts-unavailable">
                  Alertes kilométriques indisponibles.
                </p>
              ) : null}
              {((rotationDueCount ?? 0) > 0 || (rotationApproachingCount ?? 0) > 0) && (
                <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50/60 p-4 space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                      Alertes kilométriques
                    </p>
                    <p className="text-xs text-blue-600/80 mt-0.5">
                      Véhicules dont le kilométrage dépasse ou approche le seuil de rotation prévu.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {statsActions?.rotationDue?.map((item) => (
                      <div
                        key={`due-${item.vehicle.vehicleId}`}
                        className="flex items-start gap-2 text-sm text-red-700 bg-white/70 border border-red-100 rounded-lg px-3 py-2"
                      >
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{item.message}</span>
                      </div>
                    ))}
                    {statsActions?.rotationApproaching?.map((item) => (
                      <div
                        key={`approaching-${item.vehicle.vehicleId}`}
                        className="flex items-start gap-2 text-sm text-amber-800 bg-white/70 border border-amber-100 rounded-lg px-3 py-2"
                      >
                        <Clock className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>{item.message}</span>
                      </div>
                    ))}
                  </div>
                  {!canPlanRotations && (
                    <p className="text-[11px] text-muted-foreground">
                      La planification au calendrier est réalisée par l&apos;atelier.
                    </p>
                  )}
                </div>
              )}

              {rotationsView.kind === "loading" ? (
                <div className="flex justify-center py-8">
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
                    <span className="text-muted-foreground">Chargement des rotations...</span>
                  </div>
                </div>
              ) : rotationsView.kind === "error" ? (
                <InlineQueryError
                  error={rotationsView.error}
                  fallback="Les rotations de pneus sont momentanément indisponibles."
                  onRetry={() => void rotationsQuery.refetch()}
                  isRetrying={rotationsView.isRetrying}
                  data-testid="tire-rotations-error"
                />
              ) : (
                <RotationsCalendar rotations={rotationsView.data} />
              )}
            </div>
          </CardShell>
        </TabsContent>
      </Tabs>

      {/* Modal de visualisation — motif design system: mini hero + tuiles info.
          Radix Dialog plutôt qu'une div en position fixe: on récupère la touche
          Échap, le piège de focus, la fermeture au clic extérieur et les rôles ARIA. */}
      <Dialog open={showViewModal && !!selectedTire} onOpenChange={(open) => !open && setShowViewModal(false)}>
        <DialogContent className="sm:max-w-[580px] p-0 overflow-hidden gap-0">
          {selectedTire && (
            <>
              <div
                className="px-5 pt-5 pb-4"
                style={{
                  background: "linear-gradient(135deg, #f0fdf4, #dcfce7)",
                  borderBottom: "1px solid #86efac",
                }}
              >
                <DialogTitle asChild>
              <div>
                    <p className="text-[10px] font-bold tracking-widest uppercase text-green-600 mb-1">
                      Inventaire pneus
                    </p>
                    <h2 className="font-black text-green-900 text-lg leading-tight">
                      {selectedTire.brand} {selectedTire.model}
                    </h2>
                    <p className="text-green-700/60 text-[12px] mt-0.5">
                      {selectedTire.size} · {formatTireUsageLabel(selectedTire.tireType)}
                    </p>
              </div>
                </DialogTitle>
              </div>

              <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-3">
                  <div
                    className="rounded-xl p-3"
                    style={
                      selectedTire.stockQuantity <= (selectedTire.minStockLevel ?? 0)
                        ? { background: "#fffbeb", border: "1px solid #fde68a" }
                        : { background: "#f0fdf4", border: "1px solid #bbf7d0" }
                    }
                  >
                    <div className="flex items-center gap-1 mb-0.5">
                      <Package
                        className={`w-3 h-3 ${
                          selectedTire.stockQuantity <= (selectedTire.minStockLevel ?? 0)
                            ? "text-amber-600"
                            : "text-green-600"
                        }`}
                      />
                      <p
                        className={`text-[10px] font-bold tracking-widest uppercase ${
                          selectedTire.stockQuantity <= (selectedTire.minStockLevel ?? 0)
                            ? "text-amber-600"
                            : "text-green-600"
                        }`}
                      >
                        En stock
                      </p>
              </div>
                    <p className="font-bold text-[15px] text-gray-800">
                      {selectedTire.stockQuantity} unité{selectedTire.stockQuantity > 1 ? "s" : ""}
                    </p>
                    {selectedTire.minStockLevel != null && (
                      <p className="text-[11px] text-gray-400">
                        seuil d'alerte : {selectedTire.minStockLevel}
                      </p>
                    )}
              </div>

                  <div className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <DollarSign className="w-3 h-3 text-gray-400" />
                      <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400">
                        Prix d'achat
                      </p>
              </div>
                    <p className="font-bold text-[15px] text-gray-800">
                      {formatPrice(selectedTire.purchasePrice)}
                    </p>
                    <p className="text-[11px] text-gray-400">par unité</p>
              </div>

                  <div className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <Truck className="w-3 h-3 text-gray-400" />
                      <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400">
                        Fournisseur
                      </p>
              </div>
                    <p className="text-sm font-semibold text-gray-800">
                      {selectedTire.supplier || "Non spécifié"}
                    </p>
              </div>

                  <div className="rounded-xl p-3" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <MapPin className="w-3 h-3 text-gray-400" />
                      <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400">
                        Emplacement
                      </p>
            </div>
                    <p className="text-sm font-semibold text-gray-800">
                      {selectedTire.location || "Non spécifié"}
                    </p>
            </div>
          </div>
        </div>
            </>
      )}
        </DialogContent>
      </Dialog>

      {/* Modal de planification de rotation */}
      {showRotationModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-green-700 flex items-center">
                <RotateCcw className="h-5 w-5 mr-2" />
                Planifier une Rotation de Pneus
              </h3>
              <Button variant="ghost" onClick={() => setShowRotationModal(false)}>
                ×
              </Button>
            </div>

            <Form {...rotationForm}>
              <form onSubmit={rotationForm.handleSubmit((data) => createRotationMutation.mutate(data))} className="space-y-6">
                {draftRotation && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FormDraftBadge savedAt={draftRotation} />
                    <FormDraftDiscardButton savedAt={draftRotation} onDiscard={() => discardDraftRotation(rotationForm.getValues())} />
                  </div>
                )}
                
                {/* Section Véhicule */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="text-md font-medium text-green-700 mb-3 flex items-center">
                    <Truck className="h-4 w-4 mr-2" />
                    Sélection du Véhicule
                  </h4>
                  
                  <FormField
                    control={rotationForm.control}
                    name="vehicleId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Véhicule *</FormLabel>
                        <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Sélectionnez un véhicule" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {vehicles?.map((vehicle: any) => (
                              <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                                {vehicle.registrationNumber} - {vehicle.make} {vehicle.model}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Section Planification */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="text-md font-medium text-green-700 mb-3 flex items-center">
                    <Calendar className="h-4 w-4 mr-2" />
                    Détails de la Rotation
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={rotationForm.control}
                      name="rotationDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date de Rotation *</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={rotationForm.control}
                      name="rotationMileage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kilométrage *</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              placeholder="Kilométrage actuel"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={rotationForm.control}
                      name="rotationType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Type de Rotation *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Sélectionnez le type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="front_to_back">Avant vers Arrière</SelectItem>
                              <SelectItem value="cross_rotation">Rotation Croisée</SelectItem>
                              <SelectItem value="rearward_cross">Croisée Arrière</SelectItem>
                              <SelectItem value="forward_cross">Croisée Avant</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={rotationForm.control}
                      name="cost"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Coût (XAF)</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              placeholder="Coût de la rotation"
                              {...field}
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Section Prochaine Rotation */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="text-md font-medium text-green-700 mb-3 flex items-center">
                    <Timer className="h-4 w-4 mr-2" />
                    Planification Future
                  </h4>
                  
                  <FormField
                    control={rotationForm.control}
                    name="nextRotationMileage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prochain Kilométrage de Rotation</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="Kilométrage pour la prochaine rotation"
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Section Notes */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="text-md font-medium text-green-700 mb-3 flex items-center">
                    <Edit className="h-4 w-4 mr-2" />
                    Notes et Observations
                  </h4>
                  
                  <FormField
                    control={rotationForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <textarea 
                            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Notes sur la rotation planifiée..."
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Boutons d'action */}
                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowRotationModal(false)}
                  >
                    Annuler
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createRotationMutation.isPending}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {createRotationMutation.isPending ? "Planification..." : "Planifier Rotation"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>
      )}

      {/* Modal de nouvelle inspection */}
      {showInspectionModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-blue-700 flex items-center">
                <Eye className="h-5 w-5 mr-2" />
                Nouvelle Inspection de Pneu
              </h3>
              <Button variant="ghost" onClick={() => setShowInspectionModal(false)}>
                ×
              </Button>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-700">
                <strong>Inspection = Diagnostic</strong> — Contrôlez l'état actuel d'un pneu monté sur véhicule : 
                mesurez la profondeur de sculpture, vérifiez la pression, notez les défauts visuels.
              </p>
            </div>

            <Form {...inspectionForm}>
              <form onSubmit={inspectionForm.handleSubmit((data) => createInspectionMutation.mutate(data))} className="space-y-6">
                {draftInspection && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <FormDraftBadge savedAt={draftInspection} />
                    <FormDraftDiscardButton savedAt={draftInspection} onDiscard={() => discardDraftInspection(inspectionForm.getValues())} />
                  </div>
                )}
                
                {/* Section Pneu à inspecter */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="text-md font-medium text-gray-700 mb-3 flex items-center">
                    <Car className="h-4 w-4 mr-2" />
                    Pneu à Inspecter
                  </h4>
                  
                  <FormField
                    control={inspectionForm.control}
                    name="vehicleTireId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pneu monté *</FormLabel>
                        {/* En échec sans données : encart « Réessayer », pas une liste vide (`queryView`). */}
                        <Select
                          onValueChange={(value) => field.onChange(parseInt(value))}
                          value={field.value?.toString()}
                          disabled={vehicleTiresView.kind !== "ready"}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue
                                placeholder={
                                  vehicleTiresView.kind === "loading"
                                    ? "Chargement..."
                                    : vehicleTiresView.kind === "error"
                                      ? "Pneus montés inconnus"
                                      : "Sélectionnez un pneu monté"
                                }
                              />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {mountedTires.length === 0 ? (
                              <SelectItem value="__empty" disabled>
                                Aucun pneu monté sur un véhicule
                              </SelectItem>
                            ) : (
                              mountedTires.map((vt: VehicleTire) => (
                                <SelectItem key={vt.id} value={vt.id.toString()}>
                                  {vt.vehicleRegistration} - {translatePosition(vt.position)} ({vt.tireBrand} {vt.tireModel})
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        {vehicleTiresView.kind === "error" ? (
                          <InlineQueryError
                            error={vehicleTiresView.error}
                            fallback="Les pneus montés sont momentanément indisponibles."
                            onRetry={() => void vehicleTiresQuery.refetch()}
                            isRetrying={vehicleTiresView.isRetrying}
                            data-testid="inspection-mounted-tires-error"
                          />
                        ) : null}
                        <FormDescription>Sélectionnez le pneu monté à inspecter</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Section Mesures */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-md font-medium text-blue-700 mb-3 flex items-center">
                    <Gauge className="h-4 w-4 mr-2" />
                    Mesures
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={inspectionForm.control}
                      name="inspectionDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date d'inspection *</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={inspectionForm.control}
                      name="inspectionMileage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kilométrage véhicule *</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              min="0"
                              placeholder="Ex: 145000"
                              {...field} 
                              onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                            />
                          </FormControl>
                          <FormDescription>Kilométrage au moment de l'inspection</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    
                    <FormField
                      control={inspectionForm.control}
                      name="treadDepth"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Profondeur sculpture (mm) *</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              step="0.1" 
                              min="0" 
                              max="20"
                              {...field} 
                              onChange={(e) => field.onChange(parseFloat(e.target.value))}
                            />
                          </FormControl>
                          <FormDescription>Minimum légal: 1.6mm</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={inspectionForm.control}
                      name="pressure"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Pression (bar) *</FormLabel>
                          <FormControl>
                            <Input 
                              type="number" 
                              step="0.1" 
                              min="0" 
                              max="15"
                              {...field} 
                              onChange={(e) => field.onChange(parseFloat(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={inspectionForm.control}
                      name="wearPattern"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Type d'usure *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Type d'usure" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="normal">Normale (uniforme)</SelectItem>
                              <SelectItem value="center_wear">Centre (surgonflage)</SelectItem>
                              <SelectItem value="edge_wear">Bords (sous-gonflage)</SelectItem>
                              <SelectItem value="irregular">Irrégulière</SelectItem>
                              <SelectItem value="cupping">Cupping (suspension)</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Section État */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="text-md font-medium text-gray-700 mb-3 flex items-center">
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    État et Défauts
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={inspectionForm.control}
                      name="condition"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>État général *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="État du pneu" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="excellent">Excellent</SelectItem>
                              <SelectItem value="good">Bon</SelectItem>
                              <SelectItem value="fair">Acceptable</SelectItem>
                              <SelectItem value="poor">Mauvais</SelectItem>
                              <SelectItem value="critical">Critique</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={inspectionForm.control}
                      name="hasDefects"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel>Défauts détectés</FormLabel>
                            <FormDescription>Cochez si des défauts sont présents</FormDescription>
                          </div>
                          <FormControl>
                            <input 
                              type="checkbox" 
                              checked={field.value} 
                              onChange={field.onChange}
                              className="h-5 w-5"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    {inspectionForm.watch("hasDefects") && (
                      <FormField
                        control={inspectionForm.control}
                        name="defectDescription"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Description des défauts</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder="Décrivez les défauts observés (coupures, hernies, fissures...)"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                </div>

                {/* Section Action recommandée */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="text-md font-medium text-green-700 mb-3 flex items-center">
                    <FileText className="h-4 w-4 mr-2" />
                    Recommandation et Suivi
                  </h4>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={inspectionForm.control}
                      name="recommendedAction"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Action recommandée *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Action à effectuer" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="continue">Continuer l'utilisation</SelectItem>
                              <SelectItem value="monitor">Surveiller de près</SelectItem>
                              <SelectItem value="rotate">Planifier une rotation</SelectItem>
                              <SelectItem value="replace">Remplacer le pneu</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={inspectionForm.control}
                      name="nextInspectionDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Prochaine inspection *</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={inspectionForm.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem className="col-span-2">
                          <FormLabel>Notes</FormLabel>
                          <FormControl>
                            <Textarea 
                              placeholder="Observations supplémentaires..."
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Boutons d'action */}
                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setShowInspectionModal(false)}
                  >
                    Annuler
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createInspectionMutation.isPending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {createInspectionMutation.isPending ? "Enregistrement..." : "Enregistrer l'Inspection"}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>
      )}

      {/* Modal de détail d'inspection / Livret d'inspection */}
      {showInspectionDetailModal && selectedInspection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-semibold text-blue-700 flex items-center">
                <FileText className="h-5 w-5 mr-2" />
                Livret d'Inspection N°{selectedInspection.id}
              </h3>
              <Button 
                variant="ghost" 
                onClick={() => {
                  setShowInspectionDetailModal(false);
                  setSelectedInspection(null);
                }}
                data-testid="button-close-inspection-detail"
              >
                ×
              </Button>
            </div>

            {/* En-tête avec informations véhicule et pneu */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="text-md font-medium text-gray-700 mb-3 flex items-center">
                  <Car className="h-4 w-4 mr-2" />
                  Véhicule
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Immatriculation:</span>
                    <span className="font-medium">{selectedInspection.vehicleRegistration}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Position:</span>
                    <span className="font-medium">{selectedInspection.position}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Kilométrage:</span>
                    <span className="font-medium">{selectedInspection.inspectionMileage?.toLocaleString()} km</span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="text-md font-medium text-gray-700 mb-3 flex items-center">
                  <CircleDot className="h-4 w-4 mr-2" />
                  Pneu Inspecté
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Marque:</span>
                    <span className="font-medium">{selectedInspection.tireBrand}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Modèle:</span>
                    <span className="font-medium">{selectedInspection.tireModel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Taille:</span>
                    <span className="font-medium">{selectedInspection.tireSize || 'N/A'}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Mesures */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <h4 className="text-md font-medium text-blue-700 mb-3 flex items-center">
                <Gauge className="h-4 w-4 mr-2" />
                Mesures
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center bg-white rounded-lg p-3">
                  <div className="text-sm text-muted-foreground">Profondeur sculpture</div>
                  <div className={`text-2xl font-bold ${selectedInspection.treadDepth < 3 ? 'text-red-600' : selectedInspection.treadDepth < 5 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {selectedInspection.treadDepth}mm
                  </div>
                  <div className="text-xs text-muted-foreground">Min. légal: 1.6mm</div>
                </div>
                <div className="text-center bg-white rounded-lg p-3">
                  <div className="text-sm text-muted-foreground">Pression</div>
                  <div className="text-2xl font-bold text-blue-600">{selectedInspection.pressure} bar</div>
                </div>
                <div className="text-center bg-white rounded-lg p-3">
                  <div className="text-sm text-muted-foreground">Type d'usure</div>
                  <div className="text-lg font-medium">{translateWearPattern(selectedInspection.wearPattern)}</div>
                </div>
                <div className="text-center bg-white rounded-lg p-3">
                  <div className="text-sm text-muted-foreground">État général</div>
                  <Badge className={`${getConditionBadge(selectedInspection.condition)} mt-1`}>
                    {translateCondition(selectedInspection.condition)}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Défauts et observations */}
            {selectedInspection.hasDefects && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                <h4 className="text-md font-medium text-red-700 mb-3 flex items-center">
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Défauts Détectés
                </h4>
                <p className="text-sm">{selectedInspection.defectDescription || 'Aucune description fournie'}</p>
              </div>
            )}

            {/* Conclusion et recommandation */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
              <h4 className="text-md font-medium text-green-700 mb-3 flex items-center">
                <FileText className="h-4 w-4 mr-2" />
                Conclusion et Recommandation
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Action recommandée:</div>
                  <Badge 
                    variant={selectedInspection.recommendedAction === 'replace' ? 'destructive' : 
                             selectedInspection.recommendedAction === 'rotate' ? 'default' : 'secondary'}
                    className="text-base px-3 py-1"
                  >
                    {translateAction(selectedInspection.recommendedAction)}
                  </Badge>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Prochaine inspection prévue:</div>
                  <div className="font-medium">
                    {selectedInspection.nextInspectionDate 
                      ? new Date(selectedInspection.nextInspectionDate).toLocaleDateString('fr-FR', { 
                          weekday: 'long', 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })
                      : 'Non planifiée'}
                  </div>
                </div>
              </div>
              {selectedInspection.notes && (
                <div className="mt-4 pt-4 border-t border-green-200">
                  <div className="text-sm text-muted-foreground mb-1">Notes:</div>
                  <p className="text-sm">{selectedInspection.notes}</p>
                </div>
              )}
            </div>

            {/* Informations d'inspection */}
            <div className="border-t pt-4 flex justify-between items-center text-sm text-muted-foreground">
              <div>
                <span>Inspecté par: </span>
                <span className="font-medium text-foreground">{selectedInspection.inspectorName || 'Non spécifié'}</span>
              </div>
              <div>
                <span>Date: </span>
                <span className="font-medium text-foreground">
                  {new Date(selectedInspection.inspectionDate).toLocaleDateString('fr-FR', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end space-x-3 pt-4 mt-4 border-t">
              {selectedInspection.recommendedAction === 'rotate' && canPlanRotations && (
                <Button 
                  onClick={() => {
                    // Pré-remplir le formulaire de rotation avec les données de l'inspection
                    if (selectedInspection.vehicleId) {
                      rotationForm.setValue('vehicleId', selectedInspection.vehicleId);
                    }
                    rotationForm.setValue('rotationMileage', selectedInspection.inspectionMileage || 0);
                    rotationForm.setValue('notes', `Suite à l'inspection #${selectedInspection.id} du ${new Date(selectedInspection.inspectionDate).toLocaleDateString('fr-FR')} - Rotation recommandée`);
                    setShowInspectionDetailModal(false);
                    setShowRotationModal(true);
                  }}
                  className="bg-orange-600 hover:bg-orange-700"
                  data-testid="button-plan-rotation-from-inspection"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Planifier la Rotation
                </Button>
              )}
              <Button 
                variant="outline"
                onClick={() => {
                  setShowInspectionDetailModal(false);
                  setSelectedInspection(null);
                }}
              >
                Fermer
              </Button>
            </div>
          </div>
        </div>
      )}

      {canMountFromStock && (
        <VehicleTireMountDialog
          open={showMountDialog}
          onOpenChange={(open) => {
            setShowMountDialog(open);
            if (!open) setMountPreselectedTireId(undefined);
          }}
          preselectedTireId={mountPreselectedTireId}
        />
      )}

      {canMountFromStock && (
        <VehicleTireRemoveDialog
          mountedTire={tireToRemove}
          onOpenChange={(open) => {
            if (!open) setTireToRemove(null);
          }}
        />
      )}
    </div>
  );
}
