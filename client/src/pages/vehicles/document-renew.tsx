import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileCheck,
  FileUp,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  User,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { userMessageOf } from "@/lib/api-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

// ── Types ──────────────────────────────────────────────────────────────────────

type VehicleDocumentType = "carte_grise" | "assurance" | "visite_technique" | "taxe" | "autre";

interface VehicleDocument {
  id: number;
  vehicleId: number;
  name: string;
  type: VehicleDocumentType;
  expiryDate: string | null;
}

interface RenewalCenter {
  id: number;
  name: string;
  documentType?: VehicleDocumentType | null;
  accreditationNumber?: string | null;
  address?: string | null;
  contact?: string | null;
}

interface RenewalRequest {
  id: number;
  vehicleId: number;
  vehicleDocumentId: number;
  documentType: VehicleDocumentType;
  status: "pending" | "in_progress" | "completed" | "rejected";
  assignedRole: string | null;
  centerId?: number | null;
  centerNameSnapshot: string | null;
  centerAccreditationSnapshot?: string | null;
  comment: string | null;
  renewalReference?: string | null;
  renewalVisitDate?: string | null;
  inspectorName?: string | null;
  inspectorCode?: string | null;
}

// ── Config ─────────────────────────────────────────────────────────────────────

const DOC_LABELS: Record<VehicleDocumentType, string> = {
  carte_grise: "Carte grise",
  assurance: "Assurance",
  visite_technique: "Visite technique",
  taxe: "Taxe",
  autre: "Document",
};

const DOC_ICON_BG: Record<VehicleDocumentType, string> = {
  carte_grise:      "bg-blue-50 text-blue-600",
  assurance:        "bg-purple-50 text-purple-600",
  visite_technique: "bg-warning/10 text-warning-text",
  taxe:             "bg-orange-50 text-orange-600",
  autre:            "bg-gray-50 text-gray-600",
};

const ASSIGN_OPTIONS = [
  { value: "secretary",        label: "Secrétariat" },
  { value: "logistics",        label: "Logistique" },
  { value: "workshop_manager", label: "Chef d'atelier" },
  { value: "admin",            label: "Administration" },
];

const RENEWAL_STATUS: Record<string, { label: string; color: string }> = {
  pending:     { label: "En attente",  color: "bg-warning/10 text-warning-text border-warning/30" },
  in_progress: { label: "En cours",   color: "bg-blue-50 text-blue-700 border-blue-200" },
  completed:   { label: "Traité",     color: "bg-success/10 text-success border-success/30" },
  rejected:    { label: "Rejeté",     color: "bg-destructive/10 text-destructive-text border-destructive/30" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

const buildReturnPath = (raw: string | null, fallback: string): string => {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  return trimmed.startsWith("/") ? trimmed : fallback;
};

const isRenewableType = (type: VehicleDocumentType): boolean =>
  ["carte_grise", "assurance", "visite_technique", "taxe"].includes(type);

// ── Composant ─────────────────────────────────────────────────────────────────

export default function VehicleDocumentRenewPage() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const { user } = useAuth();
  const { toast } = useToast();

  const params = useMemo(() => new URLSearchParams(search || ""), [search]);
  const vehicleId = Number.parseInt(params.get("vehicleId") || "", 10);
  const vehicleDocumentId = Number.parseInt(params.get("documentId") || "", 10);
  const requestIdParam = Number.parseInt(params.get("requestId") || "", 10);
  const source = params.get("source") || "documents";
  const fallbackReturnTo = Number.isInteger(vehicleId) && vehicleId > 0 ? `/vehicles/${vehicleId}` : "/vehicles/documents";
  const returnTo = buildReturnPath(params.get("returnTo"), fallbackReturnTo);

  const requestId = Number.isInteger(requestIdParam) && requestIdParam > 0 ? requestIdParam : null;
  const isValidContext =
    Number.isInteger(vehicleId) && vehicleId > 0 &&
    Number.isInteger(vehicleDocumentId) && vehicleDocumentId > 0;
  const canRenew = ["admin", "workshop_manager", "secretary", "logistics"].includes(user?.role || "");

  const [step, setStep] = useState<1 | 2>(1);
  const [centerSelection, setCenterSelection] = useState("");
  const [initializedKey, setInitializedKey] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    comment: "",
    assignedRole: "secretary",
    newExpiryDate: "",
    visitReference: "",
    visitDate: "",
    inspectorName: "",
    inspectorCode: "",
    centerName: "",
    centerAccreditationNumber: "",
    centerAddress: "",
    centerContact: "",
  });

  const { data: documents = [], isLoading: documentsLoading, refetch: refetchDocuments } = useQuery<VehicleDocument[]>({
    queryKey: [`/api/vehicles/${vehicleId}/documents`],
    enabled: isValidContext,
  });

  const { data: renewalRequests = [], isLoading: requestsLoading, refetch: refetchRequests } = useQuery<RenewalRequest[]>({
    queryKey: ["/api/document-renewals/requests", vehicleId],
    enabled: Number.isInteger(vehicleId) && vehicleId > 0,
    queryFn: async () => {
      const response = await fetch(`/api/document-renewals/requests?vehicleId=${vehicleId}`, { credentials: "include" });
      if (!response.ok) throw new Error("Impossible de charger les demandes.");
      return response.json();
    },
  });

  const selectedDocument = useMemo(
    () => documents.find((doc) => doc.id === vehicleDocumentId) ?? null,
    [documents, vehicleDocumentId],
  );

  const linkedRequest = useMemo(() => {
    if (!renewalRequests.length) return null;
    if (requestId) return renewalRequests.find((r) => r.id === requestId) ?? null;
    return renewalRequests.find(
      (r) => r.vehicleDocumentId === vehicleDocumentId && (r.status === "pending" || r.status === "in_progress"),
    ) ?? null;
  }, [renewalRequests, requestId, vehicleDocumentId]);

  const { data: centers = [], isLoading: centersLoading } = useQuery<RenewalCenter[]>({
    queryKey: ["/api/document-renewals/centers", selectedDocument?.type],
    enabled: !!selectedDocument?.type,
    queryFn: async () => {
      const query = selectedDocument?.type ? `?documentType=${encodeURIComponent(selectedDocument.type)}` : "";
      const response = await fetch(`/api/document-renewals/centers${query}`, { credentials: "include" });
      if (!response.ok) throw new Error("Impossible de charger les centres.");
      return response.json();
    },
  });

  const selectedCenter = useMemo(
    () => centers.find((center) => String(center.id) === centerSelection) ?? null,
    [centers, centerSelection],
  );

  useEffect(() => {
    if (!selectedDocument) return;
    const key = `${selectedDocument.id}:${linkedRequest?.id ?? "none"}`;
    if (initializedKey === key) return;
    setForm({
      comment: linkedRequest?.comment?.trim() || `Renouvellement ${DOC_LABELS[selectedDocument.type]} - ${selectedDocument.name}.`,
      assignedRole: linkedRequest?.assignedRole || "secretary",
      newExpiryDate: "",
      visitReference: linkedRequest?.renewalReference || "",
      visitDate: linkedRequest?.renewalVisitDate || "",
      inspectorName: linkedRequest?.inspectorName || "",
      inspectorCode: linkedRequest?.inspectorCode || "",
      centerName: linkedRequest?.centerNameSnapshot || "",
      centerAccreditationNumber: linkedRequest?.centerAccreditationSnapshot || "",
      centerAddress: "",
      centerContact: "",
    });
    if (linkedRequest?.centerId) setCenterSelection(String(linkedRequest.centerId));
    else if (linkedRequest?.centerNameSnapshot) setCenterSelection("__new__");
    else setCenterSelection("");
    setStep(1);
    setProofFile(null);
    setInitializedKey(key);
  }, [selectedDocument, linkedRequest, initializedKey]);

  useEffect(() => {
    if (centerSelection === "__new__") return;
    if (selectedCenter?.accreditationNumber) {
      updateField("centerAccreditationNumber", selectedCenter.accreditationNumber);
    }
  }, [centerSelection, selectedCenter]);

  const quickRenewMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await apiRequest("POST", "/api/document-renewals/quick-renew", formData);
      return response.json();
    },
    onSuccess: async (payload: any) => {
      const updatedDocument = payload?.document && typeof payload.document === "object" ? payload.document as Record<string, any> : null;
      const updatedDocumentId = Number(updatedDocument?.id ?? 0);
      const updatedVehicleId = Number(updatedDocument?.vehicleId ?? vehicleId ?? 0);
      const updatedDocumentType = String(updatedDocument?.type || selectedDocument?.type || "");
      const updatedExpiryDate = String(
        updatedDocument?.expiryDate ?? updatedDocument?.expiry_date ?? "",
      ).trim();
      const vehicleIdFromReturnPath = (() => {
        const match = returnTo.match(/^\/vehicles\/([^/?#]+)/);
        if (!match?.[1]) return null;
        return decodeURIComponent(match[1]);
      })();

      if (updatedDocumentId > 0 && updatedVehicleId > 0) {
        const docPatch = {
          id: updatedDocumentId,
          vehicleId: updatedVehicleId,
          type: updatedDocumentType || undefined,
          expiryDate: updatedExpiryDate || undefined,
          ...updatedDocument,
        };

        queryClient.setQueriesData(
          {
            predicate: (query) => {
              const [firstKey] = query.queryKey ?? [];
              return typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey);
            },
          },
          (currentData: unknown) => {
            if (!Array.isArray(currentData)) return currentData;
            return currentData.map((item: any) =>
              Number(item?.id) === updatedDocumentId ? { ...item, ...docPatch } : item,
            );
          },
        );

        if (updatedExpiryDate && ["carte_grise", "assurance", "visite_technique"].includes(updatedDocumentType)) {
          queryClient.setQueriesData(
            {
              predicate: (query) => {
                const [firstKey] = query.queryKey ?? [];
                return typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+$/.test(firstKey);
              },
            },
            (currentData: unknown) => {
              if (!currentData || typeof currentData !== "object" || Array.isArray(currentData)) return currentData;
              const next = { ...(currentData as Record<string, any>) };
              if (updatedDocumentType === "carte_grise") next.licensePlateExpiry = updatedExpiryDate;
              if (updatedDocumentType === "assurance") next.insuranceExpiry = updatedExpiryDate;
              if (updatedDocumentType === "visite_technique") next.technicalInspectionDate = updatedExpiryDate;
              return next;
            },
          );
        }
      }

      // Invalide aussi les clés dynamiques (/api/vehicles/:id ou /api/vehicles/:immatriculation)
      queryClient.invalidateQueries({
        predicate: (query) => {
          const [firstKey, secondKey, thirdKey] = query.queryKey ?? [];

          if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+$/.test(firstKey)) {
            return true;
          }

          if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey)) {
            return true;
          }

          if (firstKey === "/api/vehicles" && typeof secondKey === "number" && thirdKey === "status-history") {
            return true;
          }

          if (firstKey === "/api/document-renewals/requests" && typeof secondKey === "number") {
            return true;
          }

          return false;
        },
      });

      queryClient.invalidateQueries({ queryKey: ["/api/document-renewals/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/documents/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/all-with-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/document-stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expiring-docs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/vehicles/expired-docs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/statistics/fleet"] });
      // force le refetch y compris si la vue détail n'est pas active au moment du traitement
      queryClient.invalidateQueries({
        queryKey: [`/api/vehicles/${vehicleId}/documents`],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: [`/api/vehicles/${vehicleId}`],
        refetchType: "all",
      });
      if (vehicleIdFromReturnPath) {
        queryClient.invalidateQueries({
          queryKey: [`/api/vehicles/${vehicleIdFromReturnPath}`],
          refetchType: "all",
        });
        queryClient.invalidateQueries({
          queryKey: [`/api/vehicles/${vehicleIdFromReturnPath}/documents`],
          refetchType: "all",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/unread"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });

      await Promise.allSettled([
        queryClient.refetchQueries({ queryKey: [`/api/vehicles/${vehicleId}/documents`], type: "all" }),
        queryClient.refetchQueries({ queryKey: [`/api/vehicles/${vehicleId}`], type: "all" }),
        vehicleIdFromReturnPath
          ? queryClient.refetchQueries({ queryKey: [`/api/vehicles/${vehicleIdFromReturnPath}`], type: "all" })
          : Promise.resolve(),
        vehicleIdFromReturnPath
          ? queryClient.refetchQueries({ queryKey: [`/api/vehicles/${vehicleIdFromReturnPath}/documents`], type: "all" })
          : Promise.resolve(),
        queryClient.refetchQueries({ queryKey: ["/api/vehicles/document-stats"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/vehicles/expiring-docs"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/vehicles/expired-docs"], type: "active" }),
        queryClient.refetchQueries({ queryKey: ["/api/document-renewals/requests"], type: "active" }),
      ]);

      await queryClient.refetchQueries({
        predicate: (query) => {
          const [firstKey, secondKey, thirdKey] = query.queryKey ?? [];
          if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+$/.test(firstKey)) return true;
          if (typeof firstKey === "string" && /^\/api\/vehicles\/[^/]+\/documents$/.test(firstKey)) return true;
          if (firstKey === "/api/vehicles" && typeof secondKey === "number" && thirdKey === "status-history") return true;
          return (
            firstKey === "/api/vehicles" ||
            firstKey === "/api/vehicles/all" ||
            firstKey === "/api/vehicles/all-with-status" ||
            firstKey === "/api/vehicles/documents/all" ||
            firstKey === "/api/vehicles/document-stats" ||
            firstKey === "/api/vehicles/expiring-docs" ||
            firstKey === "/api/vehicles/expired-docs" ||
            firstKey === "/api/document-renewals/requests" ||
            firstKey === "/api/maintenance/date-alerts"
          );
        },
        type: "all",
      });

      toast({ title: "Document renouvelé", description: payload?.message || "Mise à jour enregistrée." });
      setLocation(returnTo);
    },
    onError: (error: unknown) => {
      toast({ title: "Échec", description: userMessageOf(error, "Impossible d'enregistrer."), variant: "destructive" });
    },
  });

  const updateField = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = () => {
    if (!selectedDocument) return;
    if (form.comment.trim().length < 3) {
      toast({ title: "Commentaire requis", description: "Min. 3 caractères.", variant: "destructive" });
      return;
    }
    if (!form.newExpiryDate) {
      toast({ title: "Date requise", description: "Renseignez la nouvelle date d'expiration.", variant: "destructive" });
      return;
    }
    if (selectedDocument.type === "visite_technique") {
      if (form.visitReference.trim().length < 2) {
        toast({
          title: "Référence obligatoire",
          description: "Saisissez la référence / numéro de visite technique.",
          variant: "destructive",
        });
        return;
      }
      if (!form.visitDate) {
        toast({
          title: "Date de visite obligatoire",
          description: "Renseignez la date de visite technique.",
          variant: "destructive",
        });
        return;
      }
      if (form.inspectorName.trim().length < 2) {
        toast({
          title: "Inspecteur obligatoire",
          description: "Saisissez le nom de l'inspecteur.",
          variant: "destructive",
        });
        return;
      }
    }
    if (!proofFile) {
      toast({ title: "Justificatif requis", description: "Ajoutez une preuve (PDF/image) du renouvellement.", variant: "destructive" });
      return;
    }
    if (!centerSelection) {
      toast({ title: "Centre requis", description: "Sélectionnez un centre agréé.", variant: "destructive" });
      return;
    }
    const isNewCenter = centerSelection === "__new__";
    if (isNewCenter && form.centerName.trim().length < 2) {
      toast({ title: "Centre requis", description: "Saisissez un nom de centre valide.", variant: "destructive" });
      return;
    }
    const centerId = !isNewCenter && centerSelection ? Number.parseInt(centerSelection, 10) : null;
    const formData = new FormData();
    formData.append("vehicleId", String(selectedDocument.vehicleId));
    formData.append("vehicleDocumentId", String(selectedDocument.id));
    formData.append("comment", form.comment.trim());
    formData.append("newExpiryDate", form.newExpiryDate);
    formData.append("proofFile", proofFile);
    if (selectedDocument.type === "visite_technique") {
      formData.append("visitReference", form.visitReference.trim());
      formData.append("visitDate", form.visitDate);
      formData.append("inspectorName", form.inspectorName.trim());
      if (form.inspectorCode.trim().length > 0) formData.append("inspectorCode", form.inspectorCode.trim());
    }
    if (linkedRequest?.id) {
      formData.append("requestId", String(linkedRequest.id));
    }
    if (form.assignedRole) {
      formData.append("assignedRole", form.assignedRole);
    }
    if (Number.isFinite(centerId as number)) {
      formData.append("centerId", String(centerId));
    }
    if (isNewCenter) {
      formData.append("centerName", form.centerName.trim());
      if (form.centerAccreditationNumber.trim().length > 0) {
        formData.append("centerAccreditationNumber", form.centerAccreditationNumber.trim());
      }
      if (form.centerAddress.trim().length > 0) formData.append("centerAddress", form.centerAddress.trim());
      if (form.centerContact.trim().length > 0) formData.append("centerContact", form.centerContact.trim());
    }
    quickRenewMutation.mutate(formData);
  };

  // ── Erreur contexte ──────────────────────────────────────────────────────────

  if (!isValidContext || !canRenew) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl overflow-hidden border border-destructive/20 shadow-sm bg-card">
          <div className="h-0.5 bg-gradient-to-r from-destructive to-rose-400" />
          <div className="px-6 py-6 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-destructive-text">
              <AlertTriangle className="h-5 w-5" />
              <span className="font-semibold">{!isValidContext ? "Contexte invalide" : "Accès refusé"}</span>
            </div>
            <p className="text-sm text-gray-500">
              {!isValidContext ? "Document ou véhicule manquant dans l'URL." : "Votre rôle ne permet pas de traiter un renouvellement."}
            </p>
            <Button variant="outline" size="sm" className="w-fit" onClick={() => setLocation("/vehicles/documents")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Retour Documents & Conformité
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const docType = selectedDocument?.type ?? "autre";
  const docIconClass = DOC_ICON_BG[docType];

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 animate-in fade-in-0 slide-in-from-right-4 duration-300">

      {/* ── Header card ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-card">
        <div className="h-0.5 bg-gradient-to-r from-success to-success" />
        <div className="px-5 py-5 md:px-7 md:py-6">

          {/* Back + Refresh */}
          <div className="flex items-start justify-between mb-5">
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground" onClick={() => setLocation(returnTo)}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              {source === "documents_conformity" ? "Documents & Conformité" : "Retour"}
            </Button>
            <Button variant="outline" size="sm" className="gap-2 h-8 text-xs" onClick={() => { refetchDocuments(); refetchRequests(); }}>
              <RefreshCw className="h-3.5 w-3.5" /> Actualiser
            </Button>
          </div>

          {/* Breadcrumb steps */}
          <div className="flex items-center gap-1.5 mb-4">
            <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full border",
              step === 1 ? "bg-success/10 text-success border-success/30" : "bg-gray-50 text-gray-400 border-gray-200"
            )}>
              1 · Contexte
            </span>
            <ChevronRight className="h-3 w-3 text-gray-300" />
            <span className={cn("text-[11px] font-semibold px-2.5 py-1 rounded-full border",
              step === 2 ? "bg-success/10 text-success border-success/30" : "bg-gray-50 text-gray-400 border-gray-200"
            )}>
              2 · Validation
            </span>
          </div>

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 border border-success/20 flex items-center justify-center">
              <FileCheck className="h-5 w-5 text-success" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-success">Renouvellement document</span>
              <h1 className="text-xl font-bold text-gray-900">Traiter le renouvellement</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Source : {source === "documents_conformity" ? "Documents & Conformité" : "Détail véhicule"} — retour automatique après enregistrement
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Corps ── */}
      <div className="grid gap-5 lg:grid-cols-12">

        {/* ── Sidebar — Document ciblé ── */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-blue-400 to-indigo-400" />
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                  <FileText className="h-3.5 w-3.5 text-blue-500" />
                </div>
                <span className="text-sm font-semibold text-gray-800">Document ciblé</span>
              </div>

              {documentsLoading || requestsLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
                  <Loader2 className="h-4 w-4 animate-spin" /> Chargement...
                </div>
              ) : !selectedDocument ? (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive-text flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Document introuvable pour ce véhicule.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Doc type badge + nom */}
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 border border-gray-100">
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center", docIconClass)}>
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{DOC_LABELS[docType]}</p>
                      <p className="text-[13px] font-semibold text-gray-800 leading-tight">{selectedDocument.name}</p>
                    </div>
                  </div>

                  {/* Expiration */}
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Expiration actuelle</p>
                    <p className={cn("text-[13px] font-semibold mt-0.5",
                      selectedDocument.expiryDate
                        ? new Date(selectedDocument.expiryDate) < new Date() ? "text-destructive-text" : "text-gray-800"
                        : "text-gray-400"
                    )}>
                      {selectedDocument.expiryDate
                        ? format(new Date(selectedDocument.expiryDate), "dd MMMM yyyy", { locale: fr })
                        : "Non définie"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Demande liée */}
          {linkedRequest && (
            <div className="rounded-2xl border border-warning/20 shadow-sm bg-card overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-warning to-orange-400" />
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg bg-warning/10 flex items-center justify-center">
                    <ShieldCheck className="h-3.5 w-3.5 text-warning-text" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">Demande liée</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">Référence</span>
                    <span className="text-[12px] font-semibold text-gray-800">#{linkedRequest.id}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-gray-500">Statut actuel</span>
                    <span className={cn("text-[10px] font-bold uppercase tracking-wide border rounded-full px-2 py-0.5",
                      RENEWAL_STATUS[linkedRequest.status]?.color ?? "bg-gray-100 text-gray-600 border-gray-200"
                    )}>
                      {RENEWAL_STATUS[linkedRequest.status]?.label ?? linkedRequest.status}
                    </span>
                  </div>
                  {linkedRequest.assignedRole && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Assigné à</span>
                      <span className="text-[12px] text-gray-700">
                        {ASSIGN_OPTIONS.find((o) => o.value === linkedRequest.assignedRole)?.label ?? linkedRequest.assignedRole}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Formulaire principal ── */}
        <div className="lg:col-span-8">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-success to-success" />
            <div className="px-5 py-5 md:px-6">

              {/* Titre step */}
              <div className="flex items-center gap-2 mb-5">
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center",
                  step === 1 ? "bg-success/10" : "bg-warning/10"
                )}>
                  {step === 1
                    ? <FileText className="h-3.5 w-3.5 text-success" />
                    : <CalendarDays className="h-3.5 w-3.5 text-warning-text" />
                  }
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Étape {step} sur 2</p>
                  <p className="text-sm font-semibold text-gray-800">
                    {step === 1 ? "Contexte de renouvellement" : "Mise à jour du document"}
                  </p>
                </div>
              </div>

              {/* ── Step 1 ── */}
              {step === 1 ? (
                <div className="space-y-5">
                  {/* Commentaire */}
                  <div className="space-y-1.5">
                    <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide">
                      Motif / commentaire <span className="text-destructive-text">*</span>
                    </Label>
                    <Textarea
                      placeholder="Ex: Visite technique effectuée ce jour au centre agréé."
                      className="resize-none min-h-[80px] text-sm rounded-xl border-gray-200 focus:border-success"
                      value={form.comment}
                      onChange={(e) => updateField("comment", e.target.value)}
                    />
                    <p className={cn("text-[10px]", form.comment.trim().length < 3 && form.comment.length > 0 ? "text-destructive-text" : "text-gray-400")}>
                      {form.comment.trim().length}/3 caractères minimum
                    </p>
                  </div>

                  {/* Service + Centre */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                        <User className="h-3 w-3" /> Service responsable
                      </Label>
                      <Select value={form.assignedRole || "none"} onValueChange={(v) => updateField("assignedRole", v === "none" ? "" : v)}>
                        <SelectTrigger className="rounded-xl border-gray-200 text-sm">
                          <SelectValue placeholder="Choisir un service" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Non assigné</SelectItem>
                          {ASSIGN_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                        <Building2 className="h-3 w-3" /> Centre agréé <span className="text-destructive-text">*</span>
                      </Label>
                      <Select value={centerSelection || "none"} onValueChange={(v) => setCenterSelection(v === "none" ? "" : v)}>
                        <SelectTrigger className="rounded-xl border-gray-200 text-sm">
                          <SelectValue placeholder="Sélectionner un centre" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sélectionner</SelectItem>
                          {centers.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                          ))}
                          <SelectItem value="__new__">+ Ajouter un nouveau centre</SelectItem>
                        </SelectContent>
                      </Select>
                      {centersLoading && <p className="text-[10px] text-gray-400">Chargement des centres...</p>}
                    </div>
                  </div>

                  {centerSelection && centerSelection !== "__new__" && selectedCenter && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                        Centre sélectionné
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-gray-800">{selectedCenter.name}</p>
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-card px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                          Agrément: {selectedCenter.accreditationNumber}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Nouveau centre */}
                  {centerSelection === "__new__" && (
                    <div className="rounded-xl border border-success/20 bg-success/10 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-success">
                        <Building2 className="h-4 w-4" /> Nouveau centre agréé
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-1.5 md:col-span-2">
                          <Label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                            Nom du centre <span className="text-destructive-text">*</span>
                          </Label>
                          <Input
                            placeholder="Ex: Centre Auto Contrôle Bonabéri"
                            className="rounded-xl border-gray-200 text-sm"
                            value={form.centerName}
                            onChange={(e) => updateField("centerName", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                          <Label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">
                            N° centre / agrément (optionnel)
                          </Label>
                          <Input
                            placeholder="Ex: CA-DOUALA-2026-018"
                            className="rounded-xl border-gray-200 text-sm"
                            value={form.centerAccreditationNumber}
                            onChange={(e) => updateField("centerAccreditationNumber", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Adresse</Label>
                          <Input
                            placeholder="Bonabéri, Douala"
                            className="rounded-xl border-gray-200 text-sm"
                            value={form.centerAddress}
                            onChange={(e) => updateField("centerAddress", e.target.value)}
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] font-semibold text-gray-600 uppercase tracking-wide">Contact</Label>
                          <Input
                            placeholder="+237 6xx xxx xxx"
                            className="rounded-xl border-gray-200 text-sm"
                            value={form.centerContact}
                            onChange={(e) => updateField("centerContact", e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Step 2 ── */
                <div className="space-y-5">
                  <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 border border-blue-100">
                    <AlertTriangle className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <p className="text-sm text-blue-800 leading-snug">
                      Cette action met à jour la date d'expiration du document et marque la demande comme <span className="font-semibold">traitée</span>.
                    </p>
                  </div>

                  <div className="space-y-1.5 max-w-xs">
                    <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                      <CalendarDays className="h-3 w-3" /> Nouvelle date d'expiration <span className="text-destructive-text">*</span>
                    </Label>
                    <Input
                      type="date"
                      className="rounded-xl border-gray-200 text-sm"
                      value={form.newExpiryDate}
                      onChange={(e) => updateField("newExpiryDate", e.target.value)}
                    />
                    {form.newExpiryDate && (
                      <p className="text-[11px] text-success font-medium">
                        {format(new Date(form.newExpiryDate), "dd MMMM yyyy", { locale: fr })}
                      </p>
                    )}
                  </div>

                  {selectedDocument?.type === "visite_technique" && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide">
                          Référence visite technique <span className="text-destructive-text">*</span>
                        </Label>
                        <Input
                          placeholder="Ex: VT-2026-00421"
                          className="rounded-xl border-gray-200 text-sm"
                          value={form.visitReference}
                          onChange={(e) => updateField("visitReference", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide">
                          Date de visite <span className="text-destructive-text">*</span>
                        </Label>
                        <Input
                          type="date"
                          className="rounded-xl border-gray-200 text-sm"
                          value={form.visitDate}
                          onChange={(e) => updateField("visitDate", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide">
                          Nom inspecteur <span className="text-destructive-text">*</span>
                        </Label>
                        <Input
                          placeholder="Ex: M. Ekani Pierre"
                          className="rounded-xl border-gray-200 text-sm"
                          value={form.inspectorName}
                          onChange={(e) => updateField("inspectorName", e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide">
                          Matricule / N° agent / Code inspecteur (optionnel)
                        </Label>
                        <Input
                          placeholder="Ex: CTRL-7421"
                          className="rounded-xl border-gray-200 text-sm"
                          value={form.inspectorCode}
                          onChange={(e) => updateField("inspectorCode", e.target.value)}
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5 max-w-lg">
                    <Label className="text-[12px] font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                      <FileUp className="h-3 w-3" /> Justificatif (PDF/Image) <span className="text-destructive-text">*</span>
                    </Label>
                    <Input
                      type="file"
                      accept=".pdf,image/png,image/jpeg,image/jpg,image/webp"
                      className="rounded-xl border-gray-200 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-success/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-success"
                      onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                    />
                    <p className="text-[10px] text-gray-400">
                      Obligatoire. Formats acceptés: PDF, JPG, PNG, WEBP (max 8 MB).
                    </p>
                    {proofFile && (
                      <p className="text-[11px] text-success font-medium">
                        Fichier sélectionné: {proofFile.name}
                      </p>
                    )}
                  </div>

                  {/* Récap */}
                  <div className="rounded-xl border border-gray-100 bg-gray-50 divide-y divide-gray-100">
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Document</span>
                      <span className="text-[12px] font-semibold text-gray-800">{selectedDocument?.name}</span>
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Type</span>
                      <span className="text-[12px] text-gray-700">{DOC_LABELS[docType]}</span>
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Centre</span>
                      <span className="text-[12px] text-gray-700">
                        {centerSelection === "__new__" ? form.centerName || "—" : (selectedCenter?.name ?? "—")}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">N° centre / agrément</span>
                      <span className="text-[12px] text-gray-700">
                        {centerSelection === "__new__"
                          ? (form.centerAccreditationNumber || "Fallback auto")
                          : (selectedCenter?.accreditationNumber ?? "—")}
                      </span>
                    </div>
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Assigné à</span>
                      <span className="text-[12px] text-gray-700">
                        {ASSIGN_OPTIONS.find((o) => o.value === form.assignedRole)?.label ?? "—"}
                      </span>
                    </div>
                    {selectedDocument?.type === "visite_technique" && (
                      <>
                        <div className="px-4 py-2.5 flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Référence visite</span>
                          <span className={cn("text-[12px]", form.visitReference ? "text-gray-700" : "text-destructive-text")}>
                            {form.visitReference || "Manquante"}
                          </span>
                        </div>
                        <div className="px-4 py-2.5 flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Date visite</span>
                          <span className={cn("text-[12px]", form.visitDate ? "text-gray-700" : "text-destructive-text")}>
                            {form.visitDate || "Manquante"}
                          </span>
                        </div>
                        <div className="px-4 py-2.5 flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Nom inspecteur</span>
                          <span className={cn("text-[12px]", form.inspectorName ? "text-gray-700" : "text-destructive-text")}>
                            {form.inspectorName || "Manquant"}
                          </span>
                        </div>
                        <div className="px-4 py-2.5 flex items-center justify-between">
                          <span className="text-[11px] text-gray-500">Code inspecteur</span>
                          <span className="text-[12px] text-gray-700">{form.inspectorCode || "—"}</span>
                        </div>
                      </>
                    )}
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-[11px] text-gray-500">Justificatif</span>
                      <span className={cn("text-[12px]", proofFile ? "text-success font-medium" : "text-destructive-text")}>
                        {proofFile ? proofFile.name : "Manquant"}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Actions ── */}
              <div className="flex items-center justify-between pt-5 mt-5 border-t border-gray-100">
                <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setLocation(returnTo)}>
                  Annuler
                </Button>

                {step === 1 ? (
                  <Button
                    onClick={() => setStep(2)}
                    disabled={
                      form.comment.trim().length < 3 ||
                      !centerSelection ||
                      (centerSelection === "__new__" && form.centerName.trim().length < 2)
                    }
                    className="gap-2"
                  >
                    Étape suivante <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                      <ArrowLeft className="h-4 w-4 mr-1" /> Précédent
                    </Button>
                    <Button
                      onClick={handleSubmit}
                      disabled={quickRenewMutation.isPending || !proofFile || !isRenewableType(selectedDocument?.type ?? "autre")}
                      className="gap-2 bg-success hover:brightness-90"
                    >
                      {quickRenewMutation.isPending ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Enregistrement...</>
                      ) : (
                        <><CheckCircle2 className="h-4 w-4" /> Enregistrer le renouvellement</>
                      )}
                    </Button>
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
