import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { bookingConflictsOf } from "@/lib/booking-conflict";
import type { BookingConflict } from "@shared/contracts/work-order-booking";
import { BookingConflictAlert } from "@/components/work-orders/booking-conflict-alert";
import { WorkOrderExportButton } from "@/components/work-orders/work-order-export-button";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { getPartRequirementStatusLabel } from "@shared/constants/part-requirements";
import { computeWorkOrderCost, partLineCost, totalLaborHours } from "@shared/work-order-cost";
import { useVehicle } from "@/context/vehicle-context";
import { useAuth } from "@/hooks/useAuth";
import { useHelpPagePrepare } from "@/hooks/useHelpPagePrepare";
import { Button } from "@/components/ui/button";
import { WorkOrder } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { WorkOrderForm } from "@/components/maintenance/work-order-form";
import { FormattedWorkOrderDescription } from "@/components/maintenance/formatted-work-order-description";
import {
  formatDate,
  formatCurrency,
  translateStatus,
  translatePriority,
} from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Clock,
  FileText,
  Wrench,
  AlertTriangle,
  CheckCircle,
  Calendar,
  User,
  Car,
  DollarSign,
  Package,
  Trash2,
  Plus,
  Edit,
  Printer,
  Play,
  ClipboardCheck,
  Loader2,
  Circle,
  Hammer,
} from "lucide-react";
import { WorkOrderItemsPanel } from "@/components/maintenance/work-order-items-panel";
import jsPDF from 'jspdf';
import headerImage from '@assets/TAY-header-final.png';

function getStatusColor(status: string) {
  switch (status) {
    case "pending":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
    case "in_progress":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300";
    case "awaiting_parts":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300";
    case "completed":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    case "cancelled":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  }
}

function getPriorityColor(priority: string) {
  switch (priority) {
    case "critical":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300";
    case "high":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300";
    case "medium":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300";
    case "low":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300";
  }
}

function getRotationTypeLabel(type: string) {
  switch (type) {
    case "front_to_back":
      return "Avant vers arrière";
    case "cross_rotation":
      return "Rotation croisée";
    case "rearward_cross":
      return "Croisement arrière";
    case "forward_cross":
      return "Croisement avant";
    default:
      return type;
  }
}

function getPendingRequirementStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Demande en attente";
    case "approved":
      return "Demande approuvée";
    case "ordered":
      return "Commandée fournisseur";
    case "partially_received":
      return "Réception partielle";
    case "received":
      return "Réceptionnée (à affecter)";
    case "partial":
      return "Partielle (ancien)";
    case "delivered":
      return "Livrée (ancien)";
    default:
      return status;
  }
}

function getWorkOrderCreatorLabel(workOrder: any): string {
  if (workOrder?.createdByName && String(workOrder.createdByName).trim().length > 0) {
    return workOrder.createdByName;
  }

  if (typeof workOrder?.createdBy === "number") {
    return `Utilisateur #${workOrder.createdBy}`;
  }

  const description = typeof workOrder?.description === "string" ? workOrder.description.toLowerCase() : "";
  const isSystemGenerated =
    Boolean(workOrder?.isPreventive) &&
    (description.includes("automatique") || description.includes("généré par le système"));

  return isSystemGenerated ? "Système" : "Non renseigné";
}

interface TechnicianData {
  id: number;
  name: string;
  role: string;
}

export default function WorkOrderDetails({
  params,
}: {
  params: { id: string };
}) {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isAddPartDialogOpen, setIsAddPartDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const [selectedPartId, setSelectedPartId] = useState<number | null>(null);
  const [partQuantity, setPartQuantity] = useState(1);
  const [showStartConfirm, setShowStartConfirm] = useState(false);
  const [bookingConflicts, setBookingConflicts] = useState<BookingConflict[]>([]);
  // Reprise: quand celui qui démarre n'est pas le technicien assigné, on lui
  // demande s'il prend l'intervention à son nom. Deviner serait faux dans les
  // deux sens — le chef démarre souvent pour un technicien déjà sous le camion.
  const [reprendreAMonNom, setReprendreAMonNom] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<number | null>(null);
  const [issuingRequirementId, setIssuingRequirementId] = useState<number | null>(null);

  useHelpPagePrepare({
    "wo-tab-parts": () => setActiveTab("parts"),
    "wo-tab-details": () => setActiveTab("details"),
  });
  const { selectedVehicle } = useVehicle();
  const { user } = useAuth();

  const canEditWorkOrder = user?.role === 'admin' || user?.role === 'workshop_manager';
  const canProcessWorkOrder = user?.role === 'admin' || user?.role === 'workshop_manager' || user?.role === 'technician';

  // Sortir une pièce du stock, c'est le geste du magasin. Doit rester aligné
  // sur `isStockIssuer` côté serveur, sinon on affiche un bouton qui fait 403.
  const canIssueFromStock = user?.role === 'admin' || user?.role === 'warehouse';

  // Le chef d'atelier n'a pas ce droit: il a une dérogation motivée, pour les
  // soirs et week-ends où le magasin est fermé. Geste distinct, bouton distinct.
  // Retiré par l'admin : le bouton disparaît (le serveur refuse aussi, 403).
  const canOverrideIssue = user?.role === 'workshop_manager' && user?.canIssueStock !== false;

  // Motif de sortie exceptionnelle en cours de saisie.
  const [overrideRequirementId, setOverrideRequirementId] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  // Doit rester aligné sur OVERRIDE_REASON_MIN_LENGTH côté serveur.
  const MOTIF_MIN = 10;

  const workOrderId = parseInt(params.id);
  
  // Parse URL query parameters for tab and action
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const tab = params.get('tab');
    const action = params.get('action');
    
    if (tab === 'parts') {
      setActiveTab('parts');
    } else if (tab === 'work') {
      setActiveTab('work');
    } else if (tab === 'report') {
      setActiveTab('report');
    }

    if (action === 'start') {
      setShowStartConfirm(true);
    } else if (action === 'complete') {
      setShowCompleteConfirm(true);
    }
  }, [searchString]);

  // Fetch work order details
  const {
    data: workOrder,
    isLoading: workOrderLoading,
    error: workOrderError,
  } = useQuery<any>({
    queryKey: [`/api/work-orders/${workOrderId}`],
    enabled: !!workOrderId,
  });

  // Fetch vehicle details if vehicleId is available
  const {
    data: vehicle,
    isLoading: vehicleLoading,
  } = useQuery<any>({
    queryKey: [`/api/vehicles/${workOrder?.vehicleId}`],
    enabled: !!workOrder?.vehicleId,
  });

  // Fetch technicians list
  const { data: technicians = [] as any[] } = useQuery<any[]>({
    queryKey: ["/api/users/technicians"],
  });

  const technicianLabel = useMemo(() => {
    if (!workOrder?.technicianId) {
      return "Non assigné";
    }
    if (typeof workOrder.technicianName === "string" && workOrder.technicianName.trim()) {
      return workOrder.technicianName;
    }
    const match = technicians.find(
      (tech: TechnicianData) => Number(tech.id) === Number(workOrder.technicianId),
    );
    return match?.name || "Inconnu";
  }, [workOrder?.technicianId, workOrder?.technicianName, technicians]);

  // Celui qui démarre n'est pas le technicien assigné: on lui propose de
  // reprendre l'OT à son nom, sans le décider à sa place.
  const demarreurEstAutre = Boolean(
    workOrder?.technicianId && user?.id && Number(workOrder.technicianId) !== Number(user.id),
  );

  // Même cache que le panneau Travaux: sert seulement au compteur de l'onglet.
  const { data: workItemsData } = useQuery<{
    items: Array<{ actualHours?: number | string | null; status?: string | null }>;
  }>({
    queryKey: [`/api/work-orders/${workOrderId}/items`],
    enabled: !!workOrderId,
  });
  const workItemsCount = workItemsData?.items.length ?? 0;
  const laborHours = totalLaborHours(workItemsData?.items);

  // Taux horaire en vigueur pour cet OT (à sa clôture, sinon aujourd'hui) : même règle que le KPI.
  // La date de fin fait partie de la clé : clôturer l'OT relit le taux applicable.
  const { data: laborRate = null } = useQuery<{ effectiveFrom: string; hourlyRateHt: number } | null>({
    // Le second élément est lu comme paramètres de requête (ignorés par le serveur) : il faut un objet.
    queryKey: [`/api/work-orders/${workOrderId}/labor-rate`, { endDate: workOrder?.endDate ?? undefined }],
    enabled: !!workOrderId && !!workOrder,
  });
  // Saisie a posteriori permise sur un OT terminé; un OT annulé est figé.
  // Un technicien ne saisit que sur ses OT, et un OT clos est figé : même règle que le serveur.
  const canEditWorkItems =
    canProcessWorkOrder &&
    workOrder?.status !== 'cancelled' &&
    workOrder?.status !== 'completed' &&
    !(user?.role === 'technician' && demarreurEstAutre);

  // Fetch parts used in this work order
  const {
    data: partsUsed = [],
    refetch: refetchPartsUsed,
  } = useQuery<any[]>({
    queryKey: [`/api/work-orders/${workOrderId}/parts`],
    enabled: !!workOrderId,
    staleTime: 0,
    gcTime: 0,
  });

  const {
    data: pendingPartRequirements = [],
    refetch: refetchPendingPartRequirements,
  } = useQuery<any[]>({
    queryKey: [`/api/work-orders/${workOrderId}/pending-part-requirements`],
    enabled: !!workOrderId,
    staleTime: 0,
    gcTime: 0,
  });

  // Fetch tire rotations linked to this work order
  const {
    data: tireRotations = [],
    refetch: refetchTireRotations,
  } = useQuery<any[]>({
    queryKey: [`/api/work-orders/${workOrderId}/tire-rotations`],
    enabled: !!workOrderId,
  });

  // Tout le catalogue : `/api/parts` pagine à 10 par défaut, le sélecteur
  // n'aurait proposé que les 10 premières références.
  const { data: availableParts = { parts: [], total: 0 } } = useQuery<{ parts: any[]; total: number }>({
    queryKey: ["/api/parts", { limit: 1000 }],
    enabled: isAddPartDialogOpen,
  });
  
  // Fetch existing part requirements for the selected part
  const { data: existingRequests = [] as any[] } = useQuery<any[]>({
    queryKey: [`/api/part-requirements/by-part/${selectedPartId}`],
    enabled: !!selectedPartId,
  });
  
  // Find the selected part details
  const selectedPart = selectedPartId 
    ? (availableParts.parts || []).find((p: any) => p.id === selectedPartId)
    : null;
  
  // Check if there's an open request for this part
  const openRequest = existingRequests.find((r: any) => 
    r.partId === selectedPartId &&
    Number(r.workOrderId) === workOrderId &&
    ['pending', 'approved', 'ordered', 'partially_received', 'received', 'partial', 'delivered'].includes(r.status)
  );
  
  // Aperçu seulement : le serveur relit le stock au clic et décide.
  const stockAvailable = selectedPart?.quantity || 0;
  const isStockInsufficient = partQuantity > stockAvailable;
  const previewIssued = Math.min(partQuantity, Math.max(0, stockAvailable));
  const previewMissing = partQuantity - previewIssued;
  const stockStatus = stockAvailable <= 0 ? 'rupture' : 
    stockAvailable < (selectedPart?.minimumStock || 5) ? 'low' : 'ok';

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/work-orders/${workOrderId}`),
    onSuccess: () => {
      toast({
        title: "Ordre de travail supprimé",
        description: "L'ordre de travail a été supprimé avec succès.",
      });
      setLocation(user?.role === "technician" ? "/technician/my-work-orders" : "/maintenance/work-orders");
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: `Erreur lors de la suppression: ${error.message}`,
      });
    },
  });

  // « Demander la pièce » : le serveur décide au clic. Rien ne sort ici : le
  // rayon part « à sortir » chez le magasinier, le manquant en demande et l'OT
  // passe en attente de pièces.
  const requestPartMutation = useMutation({
    mutationFn: async ({ partId, quantity }: { partId: number; quantity: number }) => {
      const response = await apiRequest("POST", `/api/work-orders/${workOrderId}/parts`, {
        partId,
        quantity,
      });
      return response.json();
    },
    onSuccess: (payload: any, { partId }) => {
      toast({
        title: "Pièce demandée",
        description: payload?.message || "Demande transmise au magasinier.",
      });
      refetchPartsUsed();
      refetchPendingPartRequirements();
      queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${workOrderId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/awaiting-parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/part-requirements"] });
      queryClient.invalidateQueries({ queryKey: [`/api/part-requirements/by-part/${partId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/stock-movements"] });
      queryClient.invalidateQueries({ queryKey: [`/api/parts/${partId}/stock-history`] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/reorder-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/stock-value-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/top-consumed-parts"] });
      setIsAddPartDialogOpen(false);
      setSelectedPartId(null);
      setPartQuantity(1);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Demande impossible",
        description: userMessageOf(error, "La pièce n'a pas pu être demandée."),
      });
    },
  });
  // Sortie de stock : un seul envoi par clic, disabled={isPending} arrive au rendu suivant.
  const submitRequestPart = useSingleFlightMutate(requestPartMutation.mutate);

  const issuePendingRequirementMutation = useMutation({
    mutationFn: async ({
      requirementId,
      overrideReason,
    }: {
      requirementId: number;
      overrideReason?: string;
    }) => {
      const response = await apiRequest(
        "POST",
        `/api/work-orders/${workOrderId}/part-requirements/${requirementId}/issue`,
        overrideReason ? { overrideReason } : undefined
      );
      return response.json();
    },
    onMutate: ({ requirementId }) => {
      setIssuingRequirementId(requirementId);
    },
    onSuccess: (payload: any) => {
      setOverrideRequirementId(null);
      setOverrideReason("");
      toast({
        title: "Pièce sortie du stock",
        description: payload?.message || "La pièce est maintenant comptée dans les pièces utilisées.",
      });
      refetchPartsUsed();
      refetchPendingPartRequirements();
      queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${workOrderId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/part-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/parts/stock-movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/reorder-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/stock-value-history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/warehouse/top-consumed-parts"] });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Sortie impossible",
        description: userMessageOf(error, "La pièce n'a pas pu être sortie du stock."),
      });
    },
    onSettled: () => {
      setIssuingRequirementId(null);
    },
  });
  // Sortie de stock : un seul envoi par clic, disabled={isPending} arrive au rendu suivant.
  const submitIssueRequirement = useSingleFlightMutate(issuePendingRequirementMutation.mutate);

  const removePartMutation = useMutation({
    mutationFn: (partUsedId: number) =>
      apiRequest("DELETE", `/api/parts-used/${partUsedId}`),
    onSuccess: () => {
      toast({
        title: "Pièce supprimée",
        description: "La pièce a été supprimée de l'ordre de travail.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${workOrderId}/parts`] });
      queryClient.invalidateQueries({ queryKey: ['/api/parts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/parts/statistics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/parts/stock-movements'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/statistics'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/reorder-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/stock-value-history'] });
      queryClient.invalidateQueries({ queryKey: ['/api/warehouse/top-consumed-parts'] });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: `Erreur lors de la suppression: ${error.message}`,
      });
    },
  });

  // Mutation to start work order (pending -> in_progress)
  const startWorkOrderMutation = useMutation({
    mutationFn: (technicianId?: number) => {
      const updateData: any = {
        status: "in_progress",
        startDate: new Date().toISOString(),
      };
      // If a technician is selected (for unassigned work orders), include it
      if (technicianId) {
        updateData.technicianId = technicianId;
      }
      return apiRequest("PATCH", `/api/work-orders/${workOrderId}`, updateData);
    },
    onSuccess: () => {
      toast({
        title: "Travail commencé",
        description: "L'ordre de travail est maintenant en cours.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${workOrderId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
      setShowStartConfirm(false);
      setSelectedTechnicianId(null);
      setBookingConflicts([]);
      // Clear URL params
      setLocation(`/maintenance/work-orders/${workOrderId}`);
    },
    onError: (error) => {
      // Double affectation (409) : le dialogue reste ouvert et liste les OT en conflit.
      const conflicts = bookingConflictsOf(error);
      if (conflicts) {
        setBookingConflicts(conflicts);
        return;
      }
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Le travail n'a pas pu être commencé."),
      });
    },
  });

  // Mutation to complete work order (in_progress -> completed)
  const completeWorkOrderMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/work-orders/${workOrderId}`, {
        status: "completed",
        endDate: new Date().toISOString(),
      }),
    onSuccess: () => {
      toast({
        title: "Travail terminé",
        description: "L'ordre de travail a été complété avec succès.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/work-orders/${workOrderId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/work-orders'] });
      setShowCompleteConfirm(false);
      setLocation(`/maintenance/work-orders/${workOrderId}`);
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Erreur",
        description: `Erreur: ${error.message}`,
      });
    },
  });

  const handlePrintWorkOrder = () => {
    try {
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 12;
      const contentWidth = pageWidth - margin * 2;
      let currentY = 14;

      const parseMoney = (value: unknown): number => {
        const num = typeof value === "string" ? parseFloat(value) : Number(value);
        return Number.isFinite(num) ? num : 0;
      };

      const statusPalette = (() => {
        switch (workOrder.status) {
          case "completed":
            return { bg: [220, 252, 231] as const, text: [22, 101, 52] as const };
          case "in_progress":
            return { bg: [219, 234, 254] as const, text: [30, 64, 175] as const };
          case "awaiting_parts":
            return { bg: [254, 243, 199] as const, text: [146, 64, 14] as const };
          case "cancelled":
            return { bg: [254, 226, 226] as const, text: [153, 27, 27] as const };
          default:
            return { bg: [254, 249, 195] as const, text: [113, 63, 18] as const };
        }
      })();

      const priorityPalette = (() => {
        switch (workOrder.priority) {
          case "critical":
            return { bg: [254, 226, 226] as const, text: [153, 27, 27] as const };
          case "high":
            return { bg: [255, 237, 213] as const, text: [154, 52, 18] as const };
          case "low":
            return { bg: [220, 252, 231] as const, text: [21, 128, 61] as const };
          default:
            return { bg: [254, 249, 195] as const, text: [133, 77, 14] as const };
        }
      })();

      const ensureSpace = (neededHeight: number): boolean => {
        if (currentY + neededHeight <= pageHeight - 22) {
          return false;
        }
        doc.addPage();
        currentY = 14;
        return true;
      };

      const drawBadge = (
        x: number,
        y: number,
        text: string,
        colors: { bg: readonly [number, number, number]; text: readonly [number, number, number] },
      ) => {
        const badgeHeight = 6.5;
        const horizontalPadding = 2.5;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        const badgeWidth = doc.getTextWidth(text) + horizontalPadding * 2;
        doc.setFillColor(colors.bg[0], colors.bg[1], colors.bg[2]);
        doc.roundedRect(x, y, badgeWidth, badgeHeight, 2.5, 2.5, "F");
        doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
        doc.text(text, x + horizontalPadding, y + 4.5);
        doc.setTextColor(15, 23, 42);
        return badgeWidth;
      };

      const drawSectionTitle = (title: string) => {
        ensureSpace(8);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.setTextColor(15, 23, 42);
        doc.text(title, margin, currentY);
        currentY += 6;
      };

      const drawInfoCard = (
        x: number,
        y: number,
        width: number,
        title: string,
        fields: Array<{ label: string; value: string }>,
      ) => {
        const cardHeight = 45;
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(x, y, width, cardHeight, 2.5, 2.5, "FD");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);
        doc.text(title, x + 4, y + 6);

        let fieldY = y + 11;
        fields.forEach((field) => {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(`${field.label}:`, x + 4, fieldY);

          doc.setFont("helvetica", "normal");
          doc.setTextColor(15, 23, 42);
          const value = field.value && field.value.trim().length > 0 ? field.value : "-";
          const valueLines = doc.splitTextToSize(value, width - 8);
          doc.text(valueLines, x + 4, fieldY + 3.8);

          fieldY += 8.3;
        });
      };

      const drawTableHeader = () => {
        const headers = ["Pièce", "Qté", "Prix unitaire", "Total"];
        const colWidths = [90, 18, 34, 44];
        let cellX = margin;

        doc.setFillColor(30, 41, 59);
        doc.rect(margin, currentY, contentWidth, 7, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        headers.forEach((header, index) => {
          doc.text(header, cellX + 2, currentY + 4.5);
          cellX += colWidths[index];
        });
        doc.setTextColor(15, 23, 42);
        currentY += 7;
      };

      // En-tête officiel société
      let headerBottomY = 14;
      try {
        const pixelToMm = 25.4 / 72;
        const headerWidth = 1067 * pixelToMm * 0.4;
        const headerHeight = 236 * pixelToMm * 0.4;
        const headerX = (pageWidth - headerWidth) / 2;
        const headerY = 8;
        doc.addImage(headerImage, "PNG", headerX, headerY, headerWidth, headerHeight);
        headerBottomY = headerY + headerHeight;
      } catch (error) {
        console.error("Erreur chargement en-tête:", error);
      }
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.4);
      doc.line(margin, headerBottomY + 3, pageWidth - margin, headerBottomY + 3);

      currentY = headerBottomY + 12;

      // Titre + métadonnées
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(15, 23, 42);
      doc.text("Ordre de Travail", margin, currentY);
      currentY += 7;
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      const titleLines = doc.splitTextToSize(`N° ${workOrder.id} • ${workOrder.title || "Intervention"}`, contentWidth - 75);
      doc.text(titleLines, margin, currentY);

      const rightInfoX = pageWidth - margin;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(`Créée le ${formatDate(workOrder.createdAt)}`, rightInfoX, currentY, { align: "right" });
      doc.text(`Imprimée le ${new Date().toLocaleDateString("fr-FR")}`, rightInfoX, currentY + 4.5, { align: "right" });

      const badgeY = currentY + 7;
      const statusBadgeWidth = drawBadge(margin, badgeY, `Statut: ${translateStatus(workOrder.status)}`, statusPalette);
      drawBadge(margin + statusBadgeWidth + 3, badgeY, `Priorité: ${translatePriority(workOrder.priority)}`, priorityPalette);

      currentY = Math.max(currentY + titleLines.length * 5.2 + 6, badgeY + 10);

      // Cartes infos
      ensureSpace(52);
      const cardGap = 6;
      const cardWidth = (contentWidth - cardGap) / 2;
      const vehicleBrandModel = [workOrder.vehicleBrand || vehicle?.brand, workOrder.vehicleModel || vehicle?.model]
        .filter(Boolean)
        .join(" ");

      drawInfoCard(margin, currentY, cardWidth, "Véhicule", [
        {
          label: "Immatriculation",
          value: vehicle?.registrationNumber || workOrder.vehicleRegistration || `Véhicule #${workOrder.vehicleId}`,
        },
        { label: "Marque / Modèle", value: vehicleBrandModel || "Non spécifié" },
        { label: "Type OT", value: workOrder.isPreventive ? "Maintenance préventive" : "Maintenance curative" },
        { label: "Date planifiée", value: workOrder.scheduledDate ? formatDate(workOrder.scheduledDate) : "Non planifiée" },
      ]);

      drawInfoCard(margin + cardWidth + cardGap, currentY, cardWidth, "Responsables", [
        { label: "Créé par", value: getWorkOrderCreatorLabel(workOrder) },
        { label: "Technicien", value: technicianLabel },
        { label: "Début", value: workOrder.startDate ? formatDate(workOrder.startDate) : "Non démarré" },
        { label: "Fin", value: workOrder.endDate ? formatDate(workOrder.endDate) : "Non terminé" },
      ]);

      currentY += 50;

      // Description
      drawSectionTitle("Détails de l'intervention");
      const descriptionText = workOrder.description || "Aucune description fournie.";
      const descriptionLines = doc.splitTextToSize(descriptionText, contentWidth - 8);
      const descriptionHeight = Math.max(18, descriptionLines.length * 4.6 + 8);
      ensureSpace(descriptionHeight + 4);
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(margin, currentY, contentWidth, descriptionHeight, 2.5, 2.5, "FD");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(30, 41, 59);
      doc.text(descriptionLines, margin + 4, currentY + 6);
      currentY += descriptionHeight + 6;

      // Pièces utilisées
      drawSectionTitle("Pièces utilisées");
      const safeParts = Array.isArray(partsUsed) ? partsUsed : [];

      if (safeParts.length === 0) {
        ensureSpace(16);
        doc.setFillColor(250, 250, 250);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(margin, currentY, contentWidth, 14, 2.5, 2.5, "FD");
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text("Aucune pièce utilisée sur cette OT.", margin + 4, currentY + 8);
        currentY += 18;
      } else {
        ensureSpace(12);
        drawTableHeader();

        const colWidths = [90, 18, 34, 44];
        safeParts.forEach((part: any, index: number) => {
          if (ensureSpace(8)) {
            drawSectionTitle("Pièces utilisées (suite)");
            drawTableHeader();
          }

          const rowY = currentY;
          doc.setFillColor(index % 2 === 0 ? 255 : 248, index % 2 === 0 ? 255 : 250, index % 2 === 0 ? 255 : 252);
          doc.rect(margin, rowY, contentWidth, 7, "F");

          const partNameRaw = String(part.partName || `Pièce #${part.partId || ""}`);
          const partName = partNameRaw.length > 48 ? `${partNameRaw.slice(0, 47)}…` : partNameRaw;
          const quantity = Number(part.quantity || 0);
          const unitPrice = parseMoney(part.unitPrice);
          const total = partLineCost(part.unitPrice, part.quantity);

          const rowValues = [partName, String(quantity), formatCurrency(unitPrice), formatCurrency(total)];
          let cellX = margin;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(15, 23, 42);
          rowValues.forEach((value, cellIndex) => {
            const alignRight = cellIndex >= 2;
            doc.text(
              value,
              alignRight ? cellX + colWidths[cellIndex] - 2 : cellX + 2,
              rowY + 4.5,
              { align: alignRight ? "right" : "left" },
            );
            cellX += colWidths[cellIndex];
          });

          currentY += 7;
        });
        currentY += 5;
      }

      // Bloc des coûts
      // Même formule que l'écran et le KPI (WO5) : main-d'oeuvre + pièces + rotations de pneus.
      const {
        baseCost: laborCost,
        partsCost,
        tiresCost: tireCost,
        totalCost,
      } = computeWorkOrderCost({
        baseCost: workOrder.cost,
        parts: safeParts,
        tireRotations,
        laborHours,
        laborRate: laborRate?.hourlyRateHt ?? null,
      });
      const noteValue = typeof workOrder.notes === "string" ? workOrder.notes.trim() : "";

      const summaryWidth = 86;
      const notesBoxWidth = contentWidth - summaryWidth - 6;
      const notesLines = noteValue.length > 0 ? doc.splitTextToSize(noteValue, notesBoxWidth - 8) : [];
      const notesHeight = noteValue.length > 0 ? Math.max(24, notesLines.length * 4.5 + 8) : 0;

      ensureSpace(Math.max(38, notesHeight + 2));
      const summaryX = pageWidth - margin - summaryWidth;
      doc.setFillColor(240, 253, 250);
      doc.setDrawColor(167, 243, 208);
      doc.roundedRect(summaryX, currentY, summaryWidth, 32, 2.5, 2.5, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(5, 150, 105);
      doc.text("Synthèse des coûts", summaryX + 4, currentY + 6);

      const costRows = [
        { label: "Main d'oeuvre", value: formatCurrency(laborCost) },
        { label: "Pièces", value: formatCurrency(partsCost) },
        { label: "Rotations pneus", value: formatCurrency(tireCost) },
      ];

      let costY = currentY + 12;
      doc.setFontSize(8.8);
      costRows.forEach((row) => {
        doc.setFont("helvetica", "normal");
        doc.setTextColor(15, 23, 42);
        doc.text(row.label, summaryX + 4, costY);
        doc.text(row.value, summaryX + summaryWidth - 4, costY, { align: "right" });
        costY += 5.2;
      });

      doc.setDrawColor(110, 231, 183);
      doc.setLineWidth(0.35);
      doc.line(summaryX + 4, costY - 2.8, summaryX + summaryWidth - 4, costY - 2.8);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(6, 78, 59);
      doc.text("TOTAL", summaryX + 4, costY + 2.2);
      doc.text(formatCurrency(totalCost), summaryX + summaryWidth - 4, costY + 2.2, { align: "right" });

      // Notes d'intervention (si disponibles)
      if (noteValue.length > 0) {
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(margin, currentY, notesBoxWidth, notesHeight, 2.5, 2.5, "FD");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9.5);
        doc.setTextColor(30, 41, 59);
        doc.text("Notes d'intervention", margin + 4, currentY + 6);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.8);
        doc.text(notesLines, margin + 4, currentY + 11);
      }

      // Pied de page multi-pages
      const pageCount = doc.getNumberOfPages();
      for (let page = 1; page <= pageCount; page++) {
        doc.setPage(page);
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.2);
        doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text(`Généré le ${new Date().toLocaleString("fr-FR")}`, margin, pageHeight - 9);
        doc.text(`Page ${page}/${pageCount}`, pageWidth - margin, pageHeight - 9, { align: "right" });
      }

      doc.save(`Ordre_Travail_${workOrder.id}.pdf`);
      
      toast({
        title: "PDF généré",
        description: "L'ordre de travail a été exporté en PDF.",
      });
    } catch (error) {
      console.error('Erreur génération PDF:', error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de générer le PDF.",
      });
    }
  };

  if (workOrderLoading) {
    return (
      <div className="space-y-5">
        {/* Hero skeleton */}
        <div className="rounded-2xl overflow-hidden bg-green-50 p-6 md:p-8 space-y-5">
          <Skeleton className="h-5 w-40 bg-green-200/60" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-28 bg-green-200/60" />
            <Skeleton className="h-9 w-3/4 bg-green-200/60" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full bg-green-200/60" />
              <Skeleton className="h-5 w-16 rounded-full bg-green-200/60" />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-xl bg-white/55 border border-green-100 p-4 space-y-2">
                <Skeleton className="h-3 w-20 bg-green-200/60" />
                <Skeleton className="h-5 w-28 bg-green-200/60" />
              </div>
            ))}
          </div>
        </div>
        {/* Tabs skeleton */}
        <div className="space-y-4">
          <div className="flex gap-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-9 w-36 rounded-md" />
            ))}
          </div>
          <div className="rounded-xl border p-6 space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        </div>
      </div>
    );
  }

  if (workOrderError || !workOrder) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Ordre de travail introuvable</h2>
          <p className="text-muted-foreground mb-4">
            L'ordre de travail demandé n'existe pas ou n'a pas pu être chargé.
          </p>
          <Button onClick={() => setLocation(user?.role === "technician" ? "/technician/my-work-orders" : "/maintenance/work-orders")}>
            Retour {user?.role === "technician" ? "à mes interventions" : "aux ordres de travail"}
          </Button>
        </div>
      </div>
    );
  }

  // Détermine l'immatriculation du véhicule à afficher avec priorité
  const getVehicleRegistration = () => {
    // 1. Priorité à vehicleRegistration de l'ordre de travail
    if (workOrder.vehicleRegistration) {
      return workOrder.vehicleRegistration;
    }
    
    // 2. Ensuite le véhicule récupéré par API
    if (vehicle?.registrationNumber) {
      return vehicle.registrationNumber;
    }
    
    // 3. Ensuite le contexte global (véhicule sélectionné)
    if (selectedVehicle?.registrationNumber) {
      return selectedVehicle.registrationNumber;
    }
    
    // 4. En dernier recours, afficher l'ID du véhicule
    return `Véhicule #${workOrder.vehicleId}`;
  };

  const getVehicleBrandModel = () => {
    // Priorité similaire pour la marque et le modèle
    const brand = workOrder.vehicleBrand || vehicle?.brand || selectedVehicle?.brand;
    const model = workOrder.vehicleModel || vehicle?.model || selectedVehicle?.model;
    
    if (brand && model) {
      return `${brand} ${model}`;
    }
    return null;
  };

  const getAutoGeneratedInterventionNote = (): string | null => {
    if (!workOrder?.isPreventive) {
      return null;
    }

    const title = (workOrder.title || "").toLowerCase();
    const description = (workOrder.description || "").toLowerCase();

    if (workOrder.maintenanceScheduleId) {
      return `Pourquoi: cette OT a été générée automatiquement depuis la planification préventive #${workOrder.maintenanceScheduleId}.`;
    }

    if (title.includes("kilométr") || description.includes("kilométr")) {
      return "Pourquoi: le seuil kilométrique de maintenance préventive a été atteint ou dépassé.";
    }

    if (
      title.includes("assurance") ||
      title.includes("contrôle technique") ||
      title.includes("controle technique") ||
      title.includes("immatriculation") ||
      title.includes("plaque")
    ) {
      return "Pourquoi: échéance documentaire détectée (conformité administrative du véhicule).";
    }

    if (
      title.includes("maintenance préventive programmée") ||
      description.includes("date d'échéance") ||
      description.includes("date planifiée")
    ) {
      return "Pourquoi: la date de maintenance préventive planifiée est arrivée/échue.";
    }

    return "Pourquoi: maintenance préventive planifiée pour ce véhicule.";
  };

  const interventionNotes = (typeof workOrder?.notes === "string" && workOrder.notes.trim().length > 0)
    ? workOrder.notes
    : getAutoGeneratedInterventionNote();

  // Main-d'oeuvre + pièces + rotations : une seule formule pour l'écran, le PDF et le KPI (WO5).
  const {
    baseCost: baseWorkOrderCost,
    partsCost: totalPartsCost,
    tiresCost: totalTireRotationsCost,
    totalCost: grandTotal,
  } = computeWorkOrderCost({
    baseCost: workOrder.cost,
    parts: partsUsed,
    tireRotations,
    laborHours,
    laborRate: laborRate?.hourlyRateHt ?? null,
  });
  const pendingPartsCount = Array.isArray(pendingPartRequirements) ? pendingPartRequirements.length : 0;
  const usedPartsCount = Array.isArray(partsUsed) ? partsUsed.length : 0;
  const displayedPartsCount = usedPartsCount + pendingPartsCount;


  return (
    <div className="space-y-5">
      {/* Hero Banner */}
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #dcfce7 50%, #bbf7d0 100%)" }}
      >
        {/* Dot-grid texture */}
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: "radial-gradient(circle, #16a34a 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        <div className="relative px-3.5 py-3 sm:px-6 sm:py-5">
          {/* Back + Action buttons */}
          <div className="flex flex-wrap gap-2 justify-between mb-2">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-1 text-green-800 hover:bg-green-100/60"
              onClick={() => {
                if (window.history.length > 1) {
                  window.history.back();
                } else {
                  setLocation(user?.role === "technician" ? "/technician/my-work-orders" : "/maintenance/work-orders");
                }
              }}
              data-testid="btn-back-work-orders"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> {user?.role === "technician" ? "Mes interventions" : "Ordres de travail"}
            </Button>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {canProcessWorkOrder && workOrder.status === "pending" && (
                <Button
                  size="sm"
                  onClick={() => setShowStartConfirm(true)}
                  className="bg-green-600 hover:bg-green-700"
                  data-testid="button-start-work-order"
                  data-help-target="wo-start"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Commencer
                </Button>
              )}
              {canProcessWorkOrder && workOrder.status === "in_progress" && (
                <Button
                  size="sm"
                  onClick={() => setShowCompleteConfirm(true)}
                  className="bg-orange-600 hover:bg-orange-700"
                  data-testid="button-complete-work-order"
                  data-help-target="wo-complete"
                >
                  <ClipboardCheck className="h-4 w-4 mr-2" />
                  Terminer l'OT
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrintWorkOrder}
                className="bg-white/70 border-green-200 hover:bg-white text-green-800"
                data-testid="button-print-work-order"
              >
                <Printer className="h-4 w-4 mr-2" />
                Imprimer
              </Button>
              {(canEditWorkOrder || user?.role === "warehouse") && <WorkOrderExportButton workOrderId={workOrder.id} />}
              {canEditWorkOrder && !["completed", "cancelled"].includes(workOrder.status) && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="bg-white/70 border-green-200 hover:bg-white text-green-800">
                      <Edit className="h-4 w-4 mr-2" />
                      Modifier
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden rounded-2xl mx-auto shadow-2xl">
                    <DialogHeader className="p-4 sm:p-6 pb-3 shrink-0 border-b border-gray-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                      <DialogTitle>Modifier l'ordre de travail</DialogTitle>
                      <DialogDescription>
                        Modifiez les détails de l'ordre de travail.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                      <WorkOrderForm
                        initialData={workOrder}
                        isEdit
                        workOrderId={workOrder.id}
                        onSuccess={() => {
                          queryClient.invalidateQueries({ queryKey: ["/api/work-orders", workOrderId] });
                        }}
                      />
                    </div>
                  </DialogContent>
                </Dialog>
              )}

              {canEditWorkOrder && (
              <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Supprimer
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Confirmer la suppression</AlertDialogTitle>
                    <AlertDialogDescription>
                      Êtes-vous sûr de vouloir supprimer cet ordre de travail ? Cette action est irréversible.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteMutation.mutate()}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Supprimer
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              )}
            </div>
          </div>

          {/* Title + badges */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap mt-3">
            <h1 className="text-base sm:text-lg font-bold text-green-950 leading-tight">
              {workOrder.title || `Ordre de travail #${workOrder.id}`}
            </h1>
            <Badge className={getStatusColor(workOrder.status)}>
              {translateStatus(workOrder.status)}
            </Badge>
            <Badge className={getPriorityColor(workOrder.priority)}>
              {translatePriority(workOrder.priority)}
            </Badge>
            {workOrder.isPreventive && (
              <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                Préventive
              </Badge>
            )}
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
            <div className="bg-white/65 backdrop-blur-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5 border border-green-100/90 flex items-center gap-2.5 min-w-0">
              <Car className="h-4 w-4 text-green-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-green-600 font-medium uppercase tracking-wide">Véhicule</div>
                <div className="text-xs sm:text-sm font-semibold text-green-950 truncate">{getVehicleRegistration()}</div>
                {getVehicleBrandModel() && (
                  <div className="text-[10px] text-green-700 truncate">{getVehicleBrandModel()}</div>
                )}
              </div>
            </div>

            <div className="bg-white/65 backdrop-blur-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5 border border-green-100/90 flex items-center gap-2.5 min-w-0">
              <User className="h-4 w-4 text-green-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-green-600 font-medium uppercase tracking-wide">Technicien</div>
                <div className="text-xs sm:text-sm font-semibold text-green-950 truncate">
                  {technicianLabel}
                </div>
              </div>
            </div>

            <div className="bg-white/65 backdrop-blur-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5 border border-green-100/90 flex items-center gap-2.5 min-w-0">
              <Calendar className="h-4 w-4 text-green-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-green-600 font-medium uppercase tracking-wide">Date de fin</div>
                <div className="text-xs sm:text-sm font-semibold text-green-950 truncate">
                  {workOrder.endDate ? formatDate(workOrder.endDate) : "—"}
                </div>
              </div>
            </div>

            <div className="bg-white/65 backdrop-blur-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5 border border-green-100/90 flex items-center gap-2.5 min-w-0">
              <DollarSign className="h-4 w-4 text-green-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] text-green-600 font-medium uppercase tracking-wide">Coût total</div>
                <div className="text-xs sm:text-sm font-semibold text-green-950 truncate">{formatCurrency(grandTotal)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Start Work Order Confirmation Dialog */}
      <AlertDialog open={showStartConfirm} onOpenChange={(open) => {
        setShowStartConfirm(open);
        if (!open) setSelectedTechnicianId(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-green-600" />
              Commencer le travail
            </AlertDialogTitle>
            <AlertDialogDescription>
              {!workOrder?.technicianId ? (
                <span className="text-amber-600 font-medium">
                  Cet ordre de travail n'est pas encore assigné. Veuillez sélectionner un technicien avant de commencer.
                </span>
              ) : (
                demarreurEstAutre
                  ? `Cet ordre de travail est assigné à ${technicianLabel}. Le statut passera à « En cours ».`
                  : "Voulez-vous démarrer cet ordre de travail ? Le statut passera à \"En cours\" et la date de début sera enregistrée."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {/* Technician selector if not assigned */}
          {!workOrder?.technicianId && (
            <div className="py-4">
              <Label htmlFor="technician-select" className="text-sm font-medium mb-2 block">
                Assigner un technicien <span className="text-red-500">*</span>
              </Label>
              <Select
                value={selectedTechnicianId?.toString() || ""}
                onValueChange={(value) => setSelectedTechnicianId(parseInt(value))}
              >
                <SelectTrigger id="technician-select" className="w-full">
                  <SelectValue placeholder="Sélectionner un technicien..." />
                </SelectTrigger>
                <SelectContent>
                  {Array.isArray(technicians) && technicians.map((tech: TechnicianData) => (
                    <SelectItem key={tech.id} value={tech.id.toString()}>
                      {tech.name} {tech.role === 'workshop_manager' ? '(Chef d\'atelier)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <BookingConflictAlert conflicts={bookingConflicts} />

          {demarreurEstAutre && (
            <label className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={reprendreAMonNom}
                onChange={(event) => setReprendreAMonNom(event.target.checked)}
                className="mt-0.5"
              />
              <span className="text-sm text-amber-900">
                Je reprends cette intervention à mon nom
                <span className="block text-xs text-amber-700 mt-0.5">
                  Sans cette case, l'intervention reste assignée à {technicianLabel}.
                </span>
              </span>
            </label>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setLocation(`/maintenance/work-orders/${workOrderId}`);
              setSelectedTechnicianId(null);
              setReprendreAMonNom(false);
            }}>
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // If no technician assigned, use selected one; otherwise start without
                const techId = workOrder?.technicianId
                  ? (reprendreAMonNom && user?.id ? Number(user.id) : undefined)
                  : selectedTechnicianId || undefined;
                startWorkOrderMutation.mutate(techId);
              }}
              className="bg-green-600 hover:bg-green-700"
              disabled={startWorkOrderMutation.isPending || (!workOrder?.technicianId && !selectedTechnicianId)}
            >
              {startWorkOrderMutation.isPending ? "Démarrage..." : "Commencer"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Complete Work Order Confirmation Dialog */}
      <AlertDialog open={showCompleteConfirm} onOpenChange={setShowCompleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-orange-600" />
              Terminer l'ordre de travail
            </AlertDialogTitle>
            <AlertDialogDescription>
              Voulez-vous marquer cet ordre de travail comme terminé ? Le statut passera à "Terminé" et la date de fin sera enregistrée.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLocation(`/maintenance/work-orders/${workOrderId}`)}>
              Annuler
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => completeWorkOrderMutation.mutate()}
              className="bg-orange-600 hover:bg-orange-700"
              disabled={completeWorkOrderMutation.isPending}
            >
              {completeWorkOrderMutation.isPending ? "Finalisation..." : "Terminer l'OT"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <PremiumTabsNav tabs={[
          { value: "details", label: "Détails", icon: <TabIcon icon={Wrench} />, helpTarget: "wo-tab-details" },
          { value: "parts", label: displayedPartsCount > 0 ? `Pièces (${displayedPartsCount})` : "Pièces", icon: <TabIcon icon={Package} />, helpTarget: "wo-tab-parts" },
          { value: "work", label: workItemsCount > 0 ? `Travaux (${workItemsCount})` : "Travaux", icon: <TabIcon icon={Hammer} /> },
          { value: "tires", label: "Pneus", icon: <TabIcon icon={Circle} /> },
          ...(workOrder.status === 'completed' ? [{ value: "report", label: "Rapport", icon: <TabIcon icon={FileText} /> }] : []),
        ]} />

        {/* ── DÉTAILS ── */}
        <TabsContent value="details" data-help-target="wo-details">
          <div className="rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm bg-white dark:bg-slate-900 overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
            <div className="px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-green-50 dark:bg-green-950/40 flex items-center justify-center">
                  <Wrench className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                </div>
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">Détails de l'intervention</span>
              </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 text-emerald-600" />
                  Description & Contexte d'intervention
                </div>
                <FormattedWorkOrderDescription description={workOrder.description} />
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Diagnostic
                </div>
                <div className="p-3 bg-muted/50 rounded-lg text-sm leading-relaxed">
                  {workOrder.diagnosis || <span className="italic text-muted-foreground">Aucun diagnostic disponible.</span>}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Notes d'intervention
                </div>
                <div className="p-3 bg-muted/50 rounded-lg text-sm leading-relaxed">
                  {interventionNotes || <span className="italic text-muted-foreground">Aucune note d'intervention.</span>}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-3 border-t text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Créé le <span className="font-medium text-foreground">{formatDate(workOrder.createdAt)}</span>
                </div>
                {workOrder.estimatedDuration && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" />
                    Durée estimée <span className="font-medium text-foreground">{workOrder.estimatedDuration} h</span>
                  </div>
                )}
                {workOrder.isPreventive && (
                  <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">
                    Maintenance préventive
                  </Badge>
                )}
              </div>
            </div>
            </div>
          </div>
        </TabsContent>

        {/* ── PIÈCES ── */}
        <TabsContent value="parts">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-amber-400 to-orange-300" />
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Package className="h-3.5 w-3.5 text-amber-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">Pièces détachées utilisées</span>
                </div>
              {workOrder?.status === 'completed' ? (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle className="h-4 w-4 mr-1" />
                  OT Terminé - Modifications bloquées
                </Badge>
              ) : (
              <Dialog open={isAddPartDialogOpen} onOpenChange={setIsAddPartDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" data-help-target="wo-add-part">
                    <Plus className="h-4 w-4 mr-2" />
                    Demander une pièce
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px]">
                  <DialogHeader>
                    <DialogTitle>Demander une pièce</DialogTitle>
                    <DialogDescription>
                      Le stock disponible sort vers cet ordre de travail ; le manquant part en demande au magasin.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="part-select">Pièce</Label>
                      <Select
                        value={selectedPartId?.toString() || ""}
                        onValueChange={(value) => setSelectedPartId(parseInt(value))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Sélectionner une pièce" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableParts.parts?.map((part: any) => {
                            const partStock = part.quantity || 0;
                            const minStock = part.minimumStock || 5;
                            const stockBadge = partStock <= 0 
                              ? <Badge variant="destructive" className="ml-2 text-xs">Rupture</Badge>
                              : partStock < minStock 
                                ? <Badge variant="outline" className="ml-2 text-xs bg-orange-100 text-orange-800">Stock bas ({partStock})</Badge>
                                : <Badge variant="outline" className="ml-2 text-xs bg-green-100 text-green-800">{partStock} en stock</Badge>;
                            
                            return (
                              <SelectItem key={part.id} value={part.id.toString()}>
                                <div className="flex items-center justify-between w-full">
                                  <span>{part.name} - {part.reference}</span>
                                  {stockBadge}
                                </div>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Stock info card */}
                    {selectedPart && (
                      <div className={`p-3 rounded-lg border ${
                        stockStatus === 'rupture' ? 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800' :
                        stockStatus === 'low' ? 'bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800' :
                        'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Package className={`h-4 w-4 ${
                              stockStatus === 'rupture' ? 'text-red-600' :
                              stockStatus === 'low' ? 'text-orange-600' : 'text-green-600'
                            }`} />
                            <span className="text-sm font-medium">Stock disponible: {stockAvailable}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {formatCurrency(selectedPart.unitPrice)} / unité
                          </span>
                        </div>
                      </div>
                    )}
                    
                    <div>
                      <Label htmlFor="quantity">Quantité</Label>
                      <Input
                        id="quantity"
                        type="number"
                        min="1"
                        value={partQuantity}
                        onChange={(e) => setPartQuantity(parseInt(e.target.value) || 1)}
                      />
                    </div>

                    {/* Ce qui se passera au clic (le serveur relit le stock et tranche) */}
                    {isStockInsufficient && selectedPart && (
                      <div
                        className="p-3 rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-950 dark:border-amber-800"
                        data-testid="part-request-preview"
                      >
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                          <div className="space-y-1 flex-1 text-sm text-amber-800 dark:text-amber-200">
                            <p className="font-medium">
                              Stock insuffisant : {stockAvailable} disponible(s) pour {partQuantity} demandée(s).
                            </p>
                            {previewIssued > 0 && (
                              <p>{previewIssued} unité(s) en rayon : le magasinier les sortira pour cet OT.</p>
                            )}
                            {openRequest ? (
                              <p>
                                <CheckCircle className="h-4 w-4 inline mr-1" />
                                Une demande est déjà en cours pour cette pièce ({getPartRequirementStatusLabel(openRequest.status)}).
                              </p>
                            ) : (
                              <p>Une demande sera créée pour {previewMissing} unité(s) manquante(s).</p>
                            )}
                            <p>
                              {workOrder?.status === "awaiting_parts"
                                ? "L'OT reste en attente de pièces."
                                : "L'OT passera en attente de pièces."}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsAddPartDialogOpen(false);
                          setSelectedPartId(null);
                          setPartQuantity(1);
                        }}
                      >
                        Annuler
                      </Button>
                      <Button
                        onClick={() => {
                          if (selectedPartId) submitRequestPart({ partId: selectedPartId, quantity: partQuantity });
                        }}
                        disabled={!selectedPartId || requestPartMutation.isPending}
                        data-testid="btn-add-part-confirm"
                      >
                        {requestPartMutation.isPending ? "Demande en cours..." : "Demander la pièce"}
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              )}
              </div>
            </div>
              {(Array.isArray(partsUsed) && partsUsed.length > 0) || (Array.isArray(pendingPartRequirements) && pendingPartRequirements.length > 0) ? (
                <div className="overflow-x-auto border-t border-gray-100">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Pièce</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Référence</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Qté</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Prix unit.</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Total</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">État</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {partsUsed.map((partUsed: any) => (
                        <tr key={partUsed.id} className="group border-b border-gray-50 last:border-0 transition-colors hover:bg-amber-50/30">
                          <td className="px-5 py-3.5 font-medium text-gray-800">{partUsed.partName || "Pièce inconnue"}</td>
                          <td className="px-4 py-3.5 font-mono text-xs text-gray-400">{partUsed.partReference || "—"}</td>
                          <td className="px-4 py-3.5">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                              {partUsed.quantity}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-gray-500">{formatCurrency(partUsed.unitPrice)}</td>
                          <td className="px-4 py-3.5 font-semibold text-gray-800">{formatCurrency(partLineCost(partUsed.unitPrice, partUsed.quantity))}</td>
                          <td className="px-4 py-3.5">
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                              Utilisée
                            </Badge>
                          </td>
                          <td className="px-4 py-3.5">
                            {workOrder?.status !== 'completed' && (
                              <div className="flex justify-end flex">
                                <button
                                  onClick={() => removePartMutation.mutate(partUsed.id)}
                                  disabled={removePartMutation.isPending}
                                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                      {pendingPartRequirements.map((requirement: any) => (
                        <tr key={`pending-${requirement.id}`} className="border-b border-amber-100 bg-amber-50/40 last:border-0">
                          <td className="px-5 py-3.5 font-medium text-amber-900">
                            {requirement.partName || "Pièce demandée"}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs text-amber-700/80">
                            {requirement.partReference || "—"}
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                              {requirement.quantityNeeded}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-amber-700">
                            {formatCurrency(requirement.unitPrice || 0)}
                          </td>
                          <td className="px-4 py-3.5 font-semibold text-amber-900">
                            {formatCurrency((requirement.unitPrice || 0) * requirement.quantityNeeded)}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex flex-col gap-1">
                              <Badge variant="outline" className="w-fit bg-amber-100 text-amber-800 border-amber-200">
                                {getPendingRequirementStatusLabel(requirement.status)}
                              </Badge>
                              <span className="text-[11px] text-amber-700">
                                Stock: {requirement.stockAvailable}
                                {requirement.shortage > 0 ? ` (manque ${requirement.shortage})` : " (ok)"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="flex justify-end">
                              {workOrder?.status !== "completed" && (
                                canOverrideIssue && requirement.canBeIssued ? (
                                  // Pièce prête, magasin fermé: le chef ouvre,
                                  // en écrivant pourquoi. Bouton volontairement
                                  // secondaire — ce n'est pas le geste normal.
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
                                    onClick={() => {
                                      setOverrideRequirementId(requirement.id);
                                      setOverrideReason("");
                                    }}
                                  >
                                    Sortie exceptionnelle
                                  </Button>
                                ) : !canIssueFromStock || !requirement.canBeIssued ? (
                                  // Le technicien attend: on lui dit ce qu'on
                                  // attend et de qui, pas seulement qu'il ne
                                  // peut pas cliquer. Rouge = anomalie à
                                  // traiter, gris = le circuit suit son cours.
                                  <Badge
                                    variant="outline"
                                    className={
                                      requirement.progressBlocking
                                        ? "bg-red-50 text-red-700 border-red-200"
                                        : "bg-gray-50 text-gray-600 border-gray-200"
                                    }
                                  >
                                    {requirement.progressLabel || "En attente"}
                                  </Badge>
                                ) : (
                                  <Button
                                    size="sm"
                                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                                    onClick={() =>
                                      submitIssueRequirement({
                                        requirementId: requirement.id,
                                      })
                                    }
                                    disabled={issuePendingRequirementMutation.isPending}
                                  >
                                    {issuePendingRequirementMutation.isPending && issuingRequirementId === requirement.id ? (
                                      <>
                                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        Sortie...
                                      </>
                                    ) : (
                                      "Sortir du stock"
                                    )}
                                  </Button>
                                )
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400 border-t border-gray-100">
                  <div className="w-12 h-12 rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center">
                    <Package className="h-5 w-5 text-amber-400" />
                  </div>
                  <p className="text-sm">Aucune pièce utilisée dans cet ordre de travail.</p>
                </div>
              )}
              {Array.isArray(partsUsed) && partsUsed.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-2 flex items-center gap-3">
                    <span className="text-sm text-amber-700">Total pièces</span>
                    <span className="text-base font-bold text-amber-900">{formatCurrency(totalPartsCost)}</span>
                  </div>
                </div>
              )}
          </div>
        </TabsContent>

        {/* ── TRAVAUX ── */}
        <TabsContent value="work">
          <WorkOrderItemsPanel
            workOrderId={workOrderId}
            userId={user?.id}
            canEdit={canEditWorkItems}
            defaultTechnicianId={workOrder.technicianId}
          />
        </TabsContent>

        {/* ── PNEUS ── */}
        <TabsContent value="tires">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-blue-500 to-sky-300" />
            <div className="px-5 py-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-500 flex items-center justify-center">
                    <div className="w-1 h-1 rounded-full bg-blue-500" />
                  </div>
                </div>
                <div>
                  <span className="text-sm font-semibold text-gray-800">Rotations de pneus</span>
                  <p className="text-xs text-gray-400">Rotations effectuées dans le cadre de cet ordre de travail</p>
                </div>
              </div>
            </div>
              {Array.isArray(tireRotations) && tireRotations.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100">
                        <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Date</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Kilométrage</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Type</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Technicien</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Coût</th>
                        <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tireRotations.map((rotation: any) => (
                        <tr key={rotation.id} className="group border-b border-gray-50 last:border-0 transition-colors hover:bg-blue-50/30">
                          <td className="px-5 py-3.5 font-medium text-gray-800">
                            {new Date(rotation.rotationDate).toLocaleDateString('fr-FR')}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-sm text-gray-600">
                            {rotation.rotationMileage?.toLocaleString('fr-FR')} km
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                              {getRotationTypeLabel(rotation.rotationType)}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-gray-600">{rotation.technicianName || rotation.createdBy || "Non spécifié"}</td>
                          <td className="px-4 py-3.5 font-semibold text-gray-800">
                            {rotation.cost ? formatCurrency(rotation.cost) : "—"}
                          </td>
                          <td className="px-4 py-3.5 text-sm text-gray-400 max-w-xs truncate">
                            {rotation.notes || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
                  <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
                    <div className="w-6 h-6 rounded-full border-2 border-blue-300 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-blue-300" />
                    </div>
                  </div>
                  <p className="text-sm">Aucune rotation de pneus associée à cet ordre de travail.</p>
                </div>
              )}
              {Array.isArray(tireRotations) && tireRotations.length > 0 && (
                <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
                  <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2 flex items-center gap-3">
                    <span className="text-sm text-blue-700">Total rotations</span>
                    <span className="text-base font-bold text-blue-900">
                      {formatCurrency(totalTireRotationsCost)}
                    </span>
                  </div>
                </div>
              )}
          </div>
        </TabsContent>

        {/* ── RAPPORT ── */}
        {workOrder.status === 'completed' && (
          <TabsContent value="report">
            <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-purple-500 to-violet-300" />
              <div className="px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                    <FileText className="h-3.5 w-3.5 text-purple-600" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-gray-800">Rapport de réparation</span>
                    <p className="text-xs text-gray-400">Résumé complet de l'intervention réalisée</p>
                  </div>
                </div>
              </div>
              <div className="px-5 py-4 space-y-5">
                {/* Summary tiles */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Véhicule", value: getVehicleRegistration(), sub: getVehicleBrandModel(), icon: Car },
                    { label: "Technicien", value: technicianLabel, icon: User },
                    { label: "Date de début", value: workOrder.startDate ? formatDate(workOrder.startDate) : "N/A", icon: Calendar },
                    { label: "Date de fin", value: workOrder.endDate ? formatDate(workOrder.endDate) : "N/A", icon: Calendar },
                  ].map(({ label, value, sub, icon: Icon }) => (
                    <div key={label} className="rounded-lg bg-muted/40 px-3 py-2.5 flex items-center gap-3">
                      <Icon className="h-4 w-4 text-purple-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{label}</div>
                        <div className="text-sm font-semibold truncate">{value}</div>
                        {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Text blocks */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Wrench className="h-3.5 w-3.5" />Travaux réalisés
                  </div>
                  <div className="p-3 bg-muted/50 rounded-lg text-sm leading-relaxed">
                    {workOrder.description || <span className="italic text-muted-foreground">Aucune description fournie.</span>}
                  </div>
                </div>
                {workOrder.diagnosis && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5" />Diagnostic
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg text-sm leading-relaxed">{workOrder.diagnosis}</div>
                  </div>
                )}
                {interventionNotes && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <ClipboardCheck className="h-3.5 w-3.5" />Notes d'intervention
                    </div>
                    <div className="p-3 bg-muted/50 rounded-lg text-sm leading-relaxed">{interventionNotes}</div>
                  </div>
                )}

                {/* Parts summary */}
                {Array.isArray(partsUsed) && partsUsed.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Package className="h-3.5 w-3.5" />Pièces utilisées
                    </div>
                    <div className="divide-y rounded-lg border overflow-hidden">
                      {partsUsed.map((part: any) => (
                        <div key={part.id} className="flex justify-between items-center px-3 py-2 bg-muted/20 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{part.partName}</span>
                            <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">×{part.quantity}</span>
                          </div>
                          <span className="font-semibold">{formatCurrency(partLineCost(part.unitPrice, part.quantity))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cost recap */}
                <div className="rounded-xl border bg-purple-50/60 overflow-hidden">
                  <div className="px-4 py-2 bg-purple-100/60 text-xs font-semibold uppercase tracking-wide text-purple-700">
                    Récapitulatif des coûts
                  </div>
                  <div className="px-4 py-3 space-y-1.5 text-sm">
                    {baseWorkOrderCost > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Main d'œuvre</span><span>{formatCurrency(baseWorkOrderCost)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-muted-foreground">
                      <span>Pièces détachées</span><span>{formatCurrency(totalPartsCost)}</span>
                    </div>
                    {totalTireRotationsCost > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Rotations de pneus</span><span>{formatCurrency(totalTireRotationsCost)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-base pt-2 mt-1 border-t border-purple-200">
                      <span>Total</span><span className="text-purple-700">{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={handlePrintWorkOrder} className="bg-purple-600 hover:bg-purple-700">
                    <Printer className="h-4 w-4 mr-2" />
                    Imprimer le rapport
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Sortie exceptionnelle: la pièce a suivi tout le circuit, seul le
          « qui ouvre le magasin » change. Le motif est obligatoire et
          journalisé — c'est ce qui distingue une dérogation d'un contournement. */}
      <Dialog
        open={overrideRequirementId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOverrideRequirementId(null);
            setOverrideReason("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sortie exceptionnelle du stock</DialogTitle>
            <DialogDescription>
              Vous sortez cette pièce à la place du magasin. Indiquez pourquoi :
              le motif est enregistré avec votre nom et la date, et le magasinier
              en sera informé.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={overrideReason}
            onChange={(e) => setOverrideReason(e.target.value)}
            placeholder="Ex. : magasin fermé samedi soir, camion TN-2024-002 immobilisé, départ client prévu lundi."
            rows={4}
            autoFocus
          />
          <p className="text-xs text-gray-500">
            {overrideReason.trim().length < MOTIF_MIN
              ? `Encore ${MOTIF_MIN - overrideReason.trim().length} caractère(s) pour pouvoir valider.`
              : "Motif suffisant."}
          </p>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOverrideRequirementId(null);
                setOverrideReason("");
              }}
            >
              Annuler
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700"
              disabled={
                overrideReason.trim().length < MOTIF_MIN ||
                issuePendingRequirementMutation.isPending
              }
              onClick={() =>
                overrideRequirementId !== null &&
                submitIssueRequirement({
                  requirementId: overrideRequirementId,
                  overrideReason: overrideReason.trim(),
                })
              }
            >
              {issuePendingRequirementMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Sortie...
                </>
              ) : (
                "Confirmer la sortie"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
