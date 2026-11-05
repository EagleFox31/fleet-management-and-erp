import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import React, { useMemo, useRef, useState } from "react";
import { format, differenceInDays } from "date-fns";
import { fr } from "date-fns/locale";
import {
  FileCheck,
  FileWarning,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  ArrowLeft,
  Truck,
  FileText,
  RefreshCw,
  IdCard,
  Shield,
  ClipboardCheck,
  Receipt,
  Search,
  Download,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Vehicle } from "@shared/schema";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PremiumTabsNav, KpiGrid, KpiTile } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { DOCUMENT_RENEWAL_VIEWER_ROLES } from "@shared/constants/roles";
import { appToast } from "@/lib/app-toast";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest } from "@/lib/queryClient";

// ── Types ──────────────────────────────────────────────────────────────────────

interface VehicleDoc {
  id: number;
  vehicleId: number;
  vehicleRegistration: string;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  name: string;
  type: string;
  description: string | null;
  filename: string;
  expiryDate: string | null;
  expiryStatus: "valid" | "expiring" | "expired" | "none";
  createdAt: string;
}

interface RenewalRequest {
  id: number;
  vehicleId: number;
  vehicleDocumentId: number;
  documentType: string;
  status: "pending" | "in_progress" | "completed" | "rejected";
  requestedByName: string | null;
  assignedRole: string | null;
  centerNameSnapshot: string | null;
  targetDate: string | null;
  comment: string | null;
  proofFileName: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const DOC_TYPE_CONFIG: Record<string, { label: string; className: string; icon: LucideIcon }> = {
  carte_grise: {
    label: "Carte grise",
    className: "bg-blue-100 text-blue-700 border border-blue-200/80",
    icon: IdCard,
  },
  assurance: {
    label: "Assurance",
    className: "bg-emerald-100 text-emerald-700 border border-emerald-200/80",
    icon: Shield,
  },
  visite_technique: {
    label: "Visite technique",
    className: "bg-amber-100 text-amber-800 border border-amber-200/80",
    icon: ClipboardCheck,
  },
  taxe: {
    label: "Taxe",
    className: "bg-rose-100 text-rose-700 border border-rose-200/80",
    icon: Receipt,
  },
  autre: {
    label: "Autre",
    className: "bg-gray-100 text-gray-600 border border-gray-200/80",
    icon: FileText,
  },
};

function DocumentTypeBadge({ type }: { type: string }) {
  const config = DOC_TYPE_CONFIG[type] ?? DOC_TYPE_CONFIG.autre;
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[10px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap",
        config.className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {config.label}
    </span>
  );
}

/** Noms générés en seed / upload technique (ex. visite_technique_1) — pas un libellé métier. */
function isTechnicalDocumentName(name: string, type: string): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return true;
  const typeSlug = type.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (normalized === type.toLowerCase()) return true;
  if (new RegExp(`^${typeSlug}(_\\d+)?$`).test(normalized)) return true;
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+_\d+$/i.test(normalized)) return true;
  return false;
}

function getDocumentDisplayTitle(doc: VehicleDoc): string {
  const typeLabel = DOC_TYPE_CONFIG[doc.type]?.label ?? doc.type;
  if (!isTechnicalDocumentName(doc.name, doc.type)) {
    return doc.name.trim();
  }
  return typeLabel;
}

function getDocumentDisplaySubtitle(doc: VehicleDoc): string | null {
  if (doc.description?.trim()) {
    return doc.description.trim();
  }
  const fileLabel = doc.filename?.trim();
  if (fileLabel && !isTechnicalDocumentName(fileLabel, doc.type)) {
    return fileLabel;
  }
  if (doc.createdAt) {
    return `Enregistré le ${format(new Date(doc.createdAt), "dd/MM/yyyy", { locale: fr })}`;
  }
  return null;
}

function DocumentNameCell({ doc }: { doc: VehicleDoc }) {
  const title = getDocumentDisplayTitle(doc);
  const subtitle = getDocumentDisplaySubtitle(doc);
  return (
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-gray-800 truncate">{title}</p>
      {subtitle ? <p className="text-[11px] text-gray-400 truncate mt-0.5">{subtitle}</p> : null}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  in_progress: "En cours",
  completed: "Traité",
  rejected: "Rejeté",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  completed: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

function ExpiryBadge({ status, expiryDate }: { status: VehicleDoc["expiryStatus"]; expiryDate: string | null }) {
  if (status === "none" || !expiryDate) {
    return <span className="text-[11px] text-gray-400">—</span>;
  }
  const days = differenceInDays(new Date(expiryDate), new Date());
  const dateStr = format(new Date(expiryDate), "dd/MM/yyyy", { locale: fr });

  if (status === "expired") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 whitespace-nowrap">
        <AlertTriangle className="h-3 w-3" />
        Expiré · {dateStr}
      </span>
    );
  }
  if (status === "expiring") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 whitespace-nowrap">
        <Clock className="h-3 w-3" />
        {days}j · {dateStr}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-green-600 whitespace-nowrap">
      <CheckCircle2 className="h-3 w-3" />
      {dateStr}
    </span>
  );
}

/** Justificatif de renouvellement : le fichier est la reponse, recupere en blob sous le nom d'origine. */
async function downloadRenewalProof(request: Pick<RenewalRequest, "id" | "proofFileName">): Promise<void> {
  const res = await apiRequest("GET", `/api/document-renewals/requests/${request.id}/proof`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = request.proofFileName || `justificatif-renouvellement-${request.id}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ── Page ───────────────────────────────────────────────────────────────────────

type ExpiryFilter = "all" | "valid" | "expiring" | "expired";

export default function VehicleDocumentsPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  const canReadRenewals = (DOCUMENT_RENEWAL_VIEWER_ROLES as readonly string[]).includes(String(user?.role || ""));
  const [proofBusyId, setProofBusyId] = useState<number | null>(null);
  const proofInFlight = useRef(false);
  const handleProofDownload = async (request: RenewalRequest) => {
    // Le ref ferme la fenetre entre deux clics du meme rendu (l'etat ne change qu'au rendu suivant).
    if (proofInFlight.current) return;
    proofInFlight.current = true;
    setProofBusyId(request.id);
    try {
      await downloadRenewalProof(request);
    } catch (error) {
      appToast({
        title: "Téléchargement impossible",
        description: userMessageOf(error, "Le justificatif n'a pas pu être téléchargé."),
        variant: "destructive",
      });
    } finally {
      proofInFlight.current = false;
      setProofBusyId(null);
    }
  };
  const tableSectionRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<"documents" | "requests">(
    new URLSearchParams(search || "").get("tab") === "requests" ? "requests" : "documents",
  );
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("all");
  const [requestStatusFilter, setRequestStatusFilter] = useState<"all" | "pending">("all");
  const [vehicleFilter, setVehicleFilter] = useState<string | undefined>(undefined);
  const [vehicleSearch, setVehicleSearch] = useState("");

  const scrollToTable = () => {
    tableSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const focusDocuments = (filter: ExpiryFilter) => {
    setActiveTab("documents");
    setExpiryFilter(filter);
    setRequestStatusFilter("all");
    scrollToTable();
  };

  const focusPendingRequests = () => {
    setActiveTab("requests");
    setRequestStatusFilter("pending");
    setExpiryFilter("all");
    scrollToTable();
  };

  const { data: docs = [], isLoading: docsLoading, refetch: refetchDocs } = useQuery<VehicleDoc[]>({
    queryKey: ["/api/vehicles/documents/all"],
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: requests = [], isLoading: requestsLoading, refetch: refetchRequests } = useQuery<RenewalRequest[]>({
    queryKey: ["/api/document-renewals/requests"],
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: vehiclesData } = useQuery<{ vehicles: Vehicle[]; total: number }>({
    queryKey: ["/api/vehicles"],
  });
  const vehicles = vehiclesData?.vehicles ?? [];

  const vehicleById = useMemo(() => {
    const map = new Map<number, { registrationNumber: string; brand?: string | null; model?: string | null }>();
    for (const vehicle of vehicles) {
      map.set(vehicle.id, {
        registrationNumber: vehicle.registrationNumber,
        brand: vehicle.brand,
        model: vehicle.model,
      });
    }
    for (const doc of docs) {
      if (!map.has(doc.vehicleId)) {
        map.set(doc.vehicleId, {
          registrationNumber: doc.vehicleRegistration,
          brand: doc.vehicleBrand,
          model: doc.vehicleModel,
        });
      }
    }
    return map;
  }, [vehicles, docs]);

  const matchesVehicleScope = useMemo(() => {
    const normalizedSearch = vehicleSearch.trim().toLowerCase();
    const selectedVehicleId = vehicleFilter ? Number(vehicleFilter) : null;

    return (vehicleId: number) => {
      if (selectedVehicleId && vehicleId !== selectedVehicleId) return false;
      if (!normalizedSearch) return true;

      const vehicle = vehicleById.get(vehicleId);
      const haystack = [
        vehicle?.registrationNumber,
        vehicle?.brand,
        vehicle?.model,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    };
  }, [vehicleById, vehicleFilter, vehicleSearch]);

  const docsForVehicle = useMemo(
    () => docs.filter((doc) => matchesVehicleScope(doc.vehicleId)),
    [docs, matchesVehicleScope],
  );

  const requestsForVehicle = useMemo(
    () => requests.filter((req) => matchesVehicleScope(req.vehicleId)),
    [requests, matchesVehicleScope],
  );

  const vehicleFilterActive = Boolean(vehicleFilter) || vehicleSearch.trim().length > 0;

  const documentsReturnTo = `/vehicles/documents?tab=${activeTab}`;

  const openVehicleDocumentsTab = (vehicleRef: string | number) => {
    const slug =
      typeof vehicleRef === "number"
        ? String(vehicleRef)
        : encodeURIComponent(vehicleRef);
    const params = new URLSearchParams({
      tab: "documents",
      returnTo: documentsReturnTo,
    });
    setLocation(`/vehicles/${slug}?${params.toString()}`);
  };

  const openRenewalFlow = (request: RenewalRequest) => {
    const returnTo = documentsReturnTo;
    const params = new URLSearchParams({
      source: "documents_conformity",
      vehicleId: String(request.vehicleId),
      documentId: String(request.vehicleDocumentId),
      documentType: request.documentType,
      requestId: String(request.id),
      returnTo,
    });
    setLocation(`/vehicles/documents/renew?${params.toString()}`);
  };

  // KPIs (périmètre véhicule actif)
  const kpis = {
    valid: docsForVehicle.filter((d) => d.expiryStatus === "valid").length,
    expiring: docsForVehicle.filter((d) => d.expiryStatus === "expiring").length,
    expired: docsForVehicle.filter((d) => d.expiryStatus === "expired").length,
    pending: requestsForVehicle.filter((r) => r.status === "pending" || r.status === "in_progress").length,
  };

  const filteredDocs = useMemo(() => {
    if (expiryFilter === "all") return docsForVehicle;
    return docsForVehicle.filter((doc) => doc.expiryStatus === expiryFilter);
  }, [docsForVehicle, expiryFilter]);

  const filteredRequests = useMemo(() => {
    if (requestStatusFilter === "pending") {
      return requestsForVehicle.filter((r) => r.status === "pending" || r.status === "in_progress");
    }
    return requestsForVehicle;
  }, [requestsForVehicle, requestStatusFilter]);

  const isLoading = docsLoading || requestsLoading;

  const documentsTabBadgeCount = filteredDocs.length;
  const requestsTabBadgeCount = filteredRequests.length;
  const documentsFilterActive = expiryFilter !== "all" || vehicleFilterActive;
  const requestsFilterActive = requestStatusFilter === "pending" || vehicleFilterActive;

  const documentsTabLabel = (
    <span className="flex items-center gap-2">
      Documents véhicules
      {(documentsTabBadgeCount > 0 || documentsFilterActive) && (
        <span
          className={cn(
            "ml-1 text-[10px] font-semibold rounded-full px-1.5 py-0.5 tabular-nums",
            documentsFilterActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-200 text-gray-600",
          )}
        >
          {documentsTabBadgeCount}
        </span>
      )}
    </span>
  );

  const requestsTabLabel = (
    <span className="flex items-center gap-2">
      Demandes de renouvellement
      {(requestsTabBadgeCount > 0 || requestsFilterActive) && (
        <span
          className={cn(
            "ml-1 inline-flex items-center justify-center rounded-full text-[10px] font-bold leading-none px-1.5 min-w-[18px] h-[18px] tabular-nums",
            requestsFilterActive || kpis.pending > 0 ? "bg-amber-400 text-white" : "bg-gray-200 text-gray-600",
          )}
        >
          {requestsTabBadgeCount > 9 ? "9+" : requestsTabBadgeCount}
        </span>
      )}
    </span>
  );

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-4 md:px-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <Button variant="ghost" size="sm" className="-ml-1 h-8 text-xs text-muted-foreground" onClick={() => setLocation("/vehicles")}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Ressources Véhicules
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { refetchDocs(); refetchRequests(); }}>
              <RefreshCw className="h-3.5 w-3.5" /> Actualiser
            </Button>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-green-50 border border-green-100 flex items-center justify-center shrink-0">
                <FileCheck className="h-4 w-4 text-green-600" />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-gray-900 leading-tight">Documents & Conformité</h1>
                <p className="text-[11px] text-gray-400 truncate">Documents et demandes de renouvellement</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 w-full lg:w-auto lg:min-w-[min(100%,480px)] lg:max-w-xl shrink-0">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-green-600 pointer-events-none" />
                <Input
                  value={vehicleSearch}
                  onChange={(e) => setVehicleSearch(e.target.value)}
                  placeholder="Immatriculation, marque..."
                  className="pl-8 bg-gray-50 border-gray-100 h-8 text-sm"
                  data-testid="input-documents-vehicle-search"
                />
              </div>
              <Select
                value={vehicleFilter || "all"}
                onValueChange={(value) => setVehicleFilter(value === "all" ? undefined : value)}
              >
                <SelectTrigger
                  className="w-full sm:w-[220px] shrink-0 bg-gray-50 border-gray-100 h-8 text-sm"
                  data-testid="select-documents-vehicle-filter"
                >
                  <SelectValue placeholder="Tous les véhicules" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous les véhicules</SelectItem>
                  {vehicles.map((vehicle) => (
                    <SelectItem key={vehicle.id} value={vehicle.id.toString()}>
                      {vehicle.registrationNumber} — {vehicle.brand} {vehicle.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <KpiGrid columns={4} withTopBorder={false} className="gap-2 grid-cols-2 xl:grid-cols-4">
            <KpiTile
              label="Docs valides"
              value={kpis.valid}
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              iconWrapperClassName="bg-green-50 text-green-600 w-7 h-7"
              className={cn(
                "py-2.5 px-3",
                expiryFilter === "valid" && activeTab === "documents" && "ring-2 ring-green-200 shadow-md",
              )}
              onClick={() => focusDocuments("valid")}
              data-testid="kpi-docs-valid"
            />
            <KpiTile
              label="Expire bientôt"
              value={kpis.expiring}
              subValue="< 30 j"
              valueClassName={kpis.expiring > 0 ? "text-orange-600" : undefined}
              icon={<Clock className="h-3.5 w-3.5" />}
              iconWrapperClassName="bg-orange-50 text-orange-500 w-7 h-7"
              className={cn(
                "py-2.5 px-3",
                expiryFilter === "expiring" && activeTab === "documents" && "ring-2 ring-orange-200 shadow-md",
              )}
              onClick={() => focusDocuments("expiring")}
              data-testid="kpi-docs-expiring"
            />
            <KpiTile
              label="Expirés"
              value={kpis.expired}
              valueClassName={kpis.expired > 0 ? "text-red-600" : undefined}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              iconWrapperClassName={cn(
                "w-7 h-7",
                kpis.expired > 0 ? "bg-red-50 text-red-500" : "bg-gray-100 text-gray-400",
              )}
              className={cn(
                "py-2.5 px-3",
                expiryFilter === "expired" && activeTab === "documents" && "ring-2 ring-red-200 shadow-md",
              )}
              onClick={() => focusDocuments("expired")}
              data-testid="kpi-docs-expired"
            />
            <KpiTile
              label="Demandes"
              value={kpis.pending}
              subValue="En attente"
              valueClassName={kpis.pending > 0 ? "text-amber-600" : undefined}
              icon={<FileWarning className="h-3.5 w-3.5" />}
              iconWrapperClassName={cn(
                "w-7 h-7",
                kpis.pending > 0 ? "bg-amber-50 text-amber-500" : "bg-gray-100 text-gray-400",
              )}
              className={cn(
                "py-2.5 px-3",
                requestStatusFilter === "pending" && activeTab === "requests" && "ring-2 ring-amber-200 shadow-md",
              )}
              onClick={focusPendingRequests}
              data-testid="kpi-renewal-pending"
            />
          </KpiGrid>
        </div>
      </div>

      {/* Tabs */}
      <div ref={tableSectionRef} className="scroll-mt-4">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          const tab = value as "documents" | "requests";
          setActiveTab(tab);
          if (tab === "documents") setRequestStatusFilter("all");
          if (tab === "requests") setExpiryFilter("all");
        }}
      >
        <PremiumTabsNav
          tabs={[
            { value: "documents", label: documentsTabLabel, icon: <TabIcon icon={FileText} /> },
            { value: "requests", label: requestsTabLabel, icon: <TabIcon icon={FileWarning} /> },
          ]}
        />

        {/* Tab 1 — Documents */}
        <TabsContent value="documents" className="space-y-4">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Chargement...</div>
            ) : filteredDocs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm gap-2">
                <FileCheck className="h-8 w-8 text-gray-200" />
                {expiryFilter !== "all"
                  ? "Aucun document pour ce filtre d'expiration"
                  : vehicleFilterActive
                    ? "Aucun document pour ce véhicule"
                    : "Aucun document trouvé"}
              </div>
            ) : (
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[18%]">Véhicule</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3">Libellé</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[14%]">Type</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[16%]">Expiration</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[12%]">Statut</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[88px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDocs.map((doc) => (
                    <tr key={doc.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                            <Truck className="h-3.5 w-3.5 text-blue-500" />
                          </div>
                          <div>
                            <p className="text-[12px] font-semibold text-gray-800">{doc.vehicleRegistration}</p>
                            {doc.vehicleBrand && (
                              <p className="text-[11px] text-gray-400">{doc.vehicleBrand} {doc.vehicleModel}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <DocumentNameCell doc={doc} />
                      </td>
                      <td className="px-4 py-3">
                        <DocumentTypeBadge type={doc.type} />
                      </td>
                      <td className="px-4 py-3">
                        <ExpiryBadge status={doc.expiryStatus} expiryDate={doc.expiryDate} />
                      </td>
                      <td className="px-4 py-3">
                        {doc.expiryStatus === "expired" && (
                          <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide bg-red-50 text-red-600 border border-red-100 rounded-full px-2 py-0.5">Expiré</span>
                        )}
                        {doc.expiryStatus === "expiring" && (
                          <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide bg-orange-50 text-orange-600 border border-orange-100 rounded-full px-2 py-0.5">Expire bientôt</span>
                        )}
                        {doc.expiryStatus === "valid" && (
                          <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide bg-green-50 text-green-600 border border-green-100 rounded-full px-2 py-0.5">Valide</span>
                        )}
                        {doc.expiryStatus === "none" && (
                          <span className="text-[11px] text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Voir le document sur la fiche véhicule"
                            onClick={() => openVehicleDocumentsTab(doc.vehicleRegistration)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* Tab 2 — Demandes de renouvellement */}
        <TabsContent value="requests" className="space-y-4">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-gray-400 text-sm">Chargement...</div>
            ) : filteredRequests.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm gap-2">
                <FileWarning className="h-8 w-8 text-gray-200" />
                {requestStatusFilter === "pending"
                  ? "Aucune demande en attente ou en cours"
                  : vehicleFilterActive
                    ? "Aucune demande pour ce véhicule"
                    : "Aucune demande de renouvellement"}
              </div>
            ) : (
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60">
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[11%]">Date demande</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[16%]">Document</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3">Demandé par</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3">Centre</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[11%]">Délai cible</th>
                    <th className="text-left text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[11%]">Statut</th>
                    <th className="text-right text-[10px] font-bold uppercase tracking-widest text-gray-400 px-4 py-3 w-[108px]">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map((req) => {
                    const isOld = differenceInDays(new Date(), new Date(req.createdAt)) > 7 && req.status === "pending";
                    return (
                      <tr key={req.id} className="border-b border-gray-50 hover:bg-gray-50/60 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-[12px] text-gray-700">
                            {format(new Date(req.createdAt), "dd/MM/yyyy", { locale: fr })}
                          </p>
                          {isOld && (
                            <p className="text-[10px] text-red-500 font-semibold mt-0.5">En attente depuis {differenceInDays(new Date(), new Date(req.createdAt))}j</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <DocumentTypeBadge type={req.documentType} />
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[12px] text-gray-600">{req.requestedByName ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[12px] text-gray-600">{req.centerNameSnapshot ?? "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          {req.targetDate ? (
                            <span className="text-[12px] text-gray-600">{format(new Date(req.targetDate), "dd/MM/yyyy", { locale: fr })}</span>
                          ) : (
                            <span className="text-[11px] text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5", STATUS_COLORS[req.status])}>
                            {STATUS_LABELS[req.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            {(req.status === "pending" || req.status === "in_progress") && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0 text-green-600 hover:bg-green-50 hover:text-green-700"
                                title="Marquer comme traité"
                                onClick={() => openRenewalFlow(req)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canReadRenewals && req.proofFileName && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 w-7 p-0"
                                title={`Télécharger le justificatif (${req.proofFileName})`}
                                aria-label="Télécharger le justificatif"
                                disabled={proofBusyId !== null}
                                onClick={() => void handleProofDownload(req)}
                                data-testid={`renewal-proof-download-${req.id}`}
                              >
                                {proofBusyId === req.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 w-7 p-0"
                              title="Voir le document sur la fiche véhicule"
                              onClick={() => openVehicleDocumentsTab(req.vehicleId)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>
      </Tabs>
      </div>

    </div>
  );
}
