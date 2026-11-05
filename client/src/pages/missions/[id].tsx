import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Package, MapPin, Truck, User, Calendar, FileText, Printer, Clock, AlertTriangle, CheckCircle2, XCircle, Wallet, Fuel, Plus, Receipt } from "lucide-react";
import { format, addDays, differenceInMinutes } from "date-fns";
import { fr } from "date-fns/locale";
import { formatPrice } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { MissionInvoicesTab } from "@/components/missions/mission-invoices-tab";
import { MissionBudgetPanel } from "@/components/missions/mission-budget-panel";
import { canReadMissionBudget } from "@/lib/mission-budget-ui";
import { useFeature } from "@/hooks/use-feature";
import { MissionPriceCard } from "@/components/missions/mission-price-card";
import { PremiumTabsNav, AlertModal, PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { extractMissionActualRoadExpensesHT } from "@shared/constants/management-mission-profitability";
import { MISSION_MANAGER_ROLES, canRoleSetMissionStatus } from "@shared/constants/roles";
import { isApiError, userMessageOf } from "@/lib/api-error";
import { useFuelPrice } from "@/hooks/use-fuel-price";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { localDateKey } from "@/lib/fuel-price-policy";
import { createSubmissionKeyStore, isIndeterminateOutcome, missionFuelKeyScope } from "@/lib/submission-key";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-800",
  planned: "bg-blue-100 text-blue-800",
  assigned: "bg-purple-100 text-purple-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  delivered: "bg-success/15 text-success",
  completed: "bg-success text-success-foreground",
  cancelled: "bg-destructive/15 text-destructive-text",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  planned: "Planifiée",
  assigned: "Assignée",
  in_progress: "En cours",
  delivered: "Livrée",
  completed: "Terminée",
  cancelled: "Annulée",
};

const MISSION_TYPE_LABELS: Record<string, string> = {
  delivery: "Livraison",
  pickup: "Récupération",
  round_trip: "Aller-Retour",
};

type MissionBudgetField = "fuelBudget" | "roadExpensesBudget" | "contingencyBudget";

const MISSION_BUDGET_FIELDS: MissionBudgetField[] = [
  "fuelBudget",
  "roadExpensesBudget",
  "contingencyBudget",
];

const MISSION_BUDGET_LABELS: Record<MissionBudgetField, string> = {
  fuelBudget: "Budget carburant",
  roadExpensesBudget: "Budget frais de route (FDR)",
  contingencyBudget: "Budget imprévus",
};

const CHECK_TO_BUDGET_FIELD: Record<string, MissionBudgetField | undefined> = {
  budget_fuel: "fuelBudget",
  fuel_budget: "fuelBudget", // compat ancien payload
  budget_road_expenses: "roadExpensesBudget",
  budget_contingency: "contingencyBudget",
};

function safeFormat(dateStr: string | null | undefined, fmt: string): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "—";
    return format(d, fmt);
  } catch {
    return "—";
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ApiErrorInfo {
  title: string;
  description?: string;
  details?: string[];
  /** Motifs complets d'un refus de lancement (`motifs` du corps), absents du message qui est borné. */
  motifs?: string[];
}

type MissionDocumentType = "carte_grise" | "assurance" | "visite_technique";

const DOCUMENT_ISSUE_MATCHERS: Array<{ type: MissionDocumentType; terms: string[] }> = [
  { type: "carte_grise", terms: ["carte grise", "plaque"] },
  { type: "assurance", terms: ["assurance"] },
  { type: "visite_technique", terms: ["visite technique", "controle technique"] },
];

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function extractDocumentIssueTypes(details?: string[]): MissionDocumentType[] {
  if (!Array.isArray(details) || details.length === 0) return [];

  const found = new Set<MissionDocumentType>();
  for (const item of details) {
    const normalizedItem = normalizeForMatch(String(item || ""));
    for (const matcher of DOCUMENT_ISSUE_MATCHERS) {
      if (matcher.terms.some((term) => normalizedItem.includes(normalizeForMatch(term)))) {
        found.add(matcher.type);
      }
    }
  }

  return Array.from(found);
}

function extractApiError(error: unknown): ApiErrorInfo {
  if (!(error instanceof Error)) return { title: "Erreur inconnue" };
  // Contrat shared/errors.ts : motifs dans `errors[{ field, message }]`, repris
  // dans `message`. On garde les motifs en liste et on retire leur doublon du titre.
  if (isApiError(error) && !error.fieldErrors?.length) {
    const body = error.body as { motifs?: unknown } | null;
    const motifs = Array.isArray(body?.motifs) ? body.motifs.filter((m): m is string => typeof m === "string") : [];
    if (motifs.length > 0) return { title: userMessageOf(error), motifs };
  }
  if (isApiError(error) && error.fieldErrors?.length) {
    const motifs = error.fieldErrors.map((item) => item.message).filter(Boolean);
    const separator = error.message.indexOf(" : ");
    const title =
      separator > 0 && motifs.length > 0 && error.message.endsWith(motifs[motifs.length - 1])
        ? error.message.slice(0, separator)
        : error.message;
    return { title, details: motifs };
  }
  const raw = error.message;
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(raw.slice(jsonStart));
      if (Array.isArray(payload?.details) && payload.details.length > 0) {
        return {
          title: payload.message ?? "Erreur",
          details: payload.details as string[],
        };
      }
      if (payload?.message) return { title: payload.message };
    } catch {
      // ignore parse errors and fallback to raw error
    }
  }
  return { title: raw };
}

// Kept for non-launch mutations that don't return details
function extractApiErrorMessage(error: unknown): string {
  const info = extractApiError(error);
  return info.title;
}

function toNumericBudget(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) return null;
  return parsedValue;
}

function formatBudgetInputValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractMissionBudgetValues(mission: any): Record<MissionBudgetField, number | null> {
  const workflowData = asRecord(mission?.workflowData);
  const budgetPlan = asRecord(workflowData?.budgetPlan);

  const fuelBudget =
    toNumericBudget(budgetPlan?.fuelBudget) ??
    toNumericBudget(budgetPlan?.fuel) ??
    toNumericBudget(mission?.estimatedFuelCost);
  const roadExpensesBudget =
    toNumericBudget(budgetPlan?.roadExpensesBudget) ??
    toNumericBudget(budgetPlan?.roadBudget) ??
    toNumericBudget(budgetPlan?.fdrBudget);
  const contingencyBudget =
    toNumericBudget(budgetPlan?.contingencyBudget) ??
    toNumericBudget(budgetPlan?.unexpectedBudget) ??
    toNumericBudget(budgetPlan?.imprevuBudget);

  return {
    fuelBudget,
    roadExpensesBudget,
    contingencyBudget,
  };
}

function buildMissionBudgetFormValues(
  missionBudgetValues: Record<MissionBudgetField, number | null>,
  missionBudgetSuggestionValues: Record<MissionBudgetField, number | null>,
): Record<MissionBudgetField, string> {
  const getBudgetInputValue = (field: MissionBudgetField): string => {
    const existing = missionBudgetValues[field];
    if (existing !== null && Number.isFinite(existing)) {
      return formatBudgetInputValue(existing);
    }
    const suggested = missionBudgetSuggestionValues[field];
    if (suggested !== null && Number.isFinite(suggested)) {
      return formatBudgetInputValue(suggested);
    }
    return "";
  };

  return {
    fuelBudget: getBudgetInputValue("fuelBudget"),
    roadExpensesBudget: getBudgetInputValue("roadExpensesBudget"),
    contingencyBudget: getBudgetInputValue("contingencyBudget"),
  };
}

function mergeMissionBudgetPlanForCache(
  existingWorkflowData: unknown,
  patch: Partial<Record<MissionBudgetField, number | null>>,
): Record<string, unknown> {
  const workflowDataObj = asRecord(existingWorkflowData) ?? {};
  const budgetPlanObj = asRecord(workflowDataObj.budgetPlan) ?? {};
  const nextBudgetPlan: Record<string, unknown> = { ...budgetPlanObj };

  for (const field of MISSION_BUDGET_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    nextBudgetPlan[field] = patch[field] ?? null;
  }

  return {
    ...workflowDataObj,
    budgetPlan: nextBudgetPlan,
  };
}

function applyMissionBudgetPatchToMissionCache(
  missionData: any,
  patch: Partial<Record<MissionBudgetField, number | null>>,
): any {
  if (!missionData || typeof missionData !== "object") return missionData;

  const nextMission = {
    ...missionData,
    workflowData: mergeMissionBudgetPlanForCache(missionData.workflowData, patch),
  };

  if (Object.prototype.hasOwnProperty.call(patch, "fuelBudget")) {
    const fuelBudget = patch.fuelBudget;
    nextMission.estimatedFuelCost =
      fuelBudget !== null && fuelBudget !== undefined && Number(fuelBudget) > 0
        ? String(fuelBudget)
        : null;
  }

  return nextMission;
}

function applyMissionBudgetPatchToLaunchReadinessCache(
  readinessData: any,
  patch: Partial<Record<MissionBudgetField, number | null>>,
): any {
  if (!readinessData || typeof readinessData !== "object") return readinessData;

  const next = { ...readinessData };
  const budgetsObj = asRecord(next.budgets) ?? {};
  const nextBudgets: Record<string, unknown> = { ...budgetsObj };

  const mapToCheckKey: Record<MissionBudgetField, string> = {
    fuelBudget: "budget_fuel",
    roadExpensesBudget: "budget_road_expenses",
    contingencyBudget: "budget_contingency",
  };

  const checkPass = (field: MissionBudgetField, value: number | null | undefined): boolean => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return false;
    if (field === "fuelBudget") return Number(value) > 0;
    return Number(value) >= 0;
  };

  for (const field of MISSION_BUDGET_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const value = patch[field] ?? null;
    nextBudgets[field] = value;
  }

  const fuelBudget = toNumericBudget(nextBudgets.fuelBudget);
  const roadExpensesBudget = toNumericBudget(nextBudgets.roadExpensesBudget);
  const contingencyBudget = toNumericBudget(nextBudgets.contingencyBudget);
  nextBudgets.total =
    (fuelBudget && Number.isFinite(fuelBudget) ? fuelBudget : 0) +
    (roadExpensesBudget && Number.isFinite(roadExpensesBudget) ? roadExpensesBudget : 0) +
    (contingencyBudget && Number.isFinite(contingencyBudget) ? contingencyBudget : 0);
  next.budgets = nextBudgets;

  if (Array.isArray(next.checks)) {
    next.checks = next.checks.map((check: any) => {
      const checkKey = String(check?.key || "");
      const mappedField = (Object.entries(mapToCheckKey).find(([, key]) => key === checkKey)?.[0] || null) as MissionBudgetField | null;
      if (!mappedField || !Object.prototype.hasOwnProperty.call(patch, mappedField)) {
        return check;
      }

      const value = patch[mappedField];
      const passed = checkPass(mappedField, value);

      return {
        ...check,
        passed,
        detail: passed
          ? `${Math.round(Number(value || 0))} FCFA renseigné.`
          : mappedField === "fuelBudget"
            ? "Renseignez le budget carburant pour activer le contrôle de solde."
            : `Renseignez ${MISSION_BUDGET_LABELS[mappedField].toLowerCase()}.`,
      };
    });
  }

  return next;
}

async function parseJsonIfPresent(response: Response): Promise<any> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return null;
  const body = await response.text();
  if (!body) return null;
  return JSON.parse(body);
}

interface MissionFuelRecord {
  id: number;
  date: string | null;
  quantity: number;
  unitPrice: number | string | null;
  debitAmount: number | string | null;
  stationName?: string | null;
  notes?: string | null;
  createdBy?: number | null;
  createdByName?: string | null;
  createdByRole?: string | null;
  isPreDeparture?: boolean | null;
}

interface MissionNoRefuelDeclaration {
  reason: string;
  declaredAt: string;
  declaredBy: number | null;
  declaredRole: string | null;
}

interface MissionFuelRecordsResponse {
  records: MissionFuelRecord[];
  totalQuantity: number;
  totalCost: number;
  noRefuelDeclaration: MissionNoRefuelDeclaration | null;
}

interface MissionFuelMutationPayload {
  record: MissionFuelRecord | null;
  totalQuantity: number | null;
  totalCost: number | null;
}

function toNumberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateTimeLocalValue(dateValue?: string | null): string {
  if (!dateValue) return "";
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatFuelQuantity(value: number | string | null | undefined): string {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return "0 L";
  return `${new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: numericValue % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  }).format(numericValue)} L`;
}

function normalizeMissionFuelRecordsResponse(raw: any): MissionFuelRecordsResponse {
  const rawRecords = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.records)
      ? raw.records
      : Array.isArray(raw?.fuelRecords)
        ? raw.fuelRecords
        : [];

  const records = rawRecords.map((entry: any) => {
    const noteText = String(entry?.notes || "");
    const isPreDeparture =
      typeof entry?.isPreDeparture === "boolean"
        ? entry.isPreDeparture
        : noteText.includes("[PRE_DEPART]");
    return {
      ...entry,
      isPreDeparture,
    };
  });

  const noRefuelDeclarationRaw = raw?.tracking?.noRefuelDeclaration;
  const noRefuelDeclaration =
    noRefuelDeclarationRaw &&
    typeof noRefuelDeclarationRaw === "object" &&
    typeof noRefuelDeclarationRaw.reason === "string"
      ? {
          reason: String(noRefuelDeclarationRaw.reason || ""),
          declaredAt: String(noRefuelDeclarationRaw.declaredAt || ""),
          declaredBy:
            typeof noRefuelDeclarationRaw.declaredBy === "number"
              ? noRefuelDeclarationRaw.declaredBy
              : noRefuelDeclarationRaw.declaredBy !== null && noRefuelDeclarationRaw.declaredBy !== undefined
                ? Number.parseInt(String(noRefuelDeclarationRaw.declaredBy), 10) || null
                : null,
          declaredRole: noRefuelDeclarationRaw.declaredRole ? String(noRefuelDeclarationRaw.declaredRole) : null,
        }
      : null;

  return {
    records,
    totalQuantity: toNumberOrZero(raw?.totalQuantity ?? raw?.totals?.totalQuantity),
    totalCost: toNumberOrZero(raw?.totalCost ?? raw?.totals?.totalCost),
    noRefuelDeclaration,
  };
}

function normalizeMissionFuelMutationPayload(raw: any): MissionFuelMutationPayload {
  return {
    record: raw?.record ?? raw?.fuelRecord ?? raw?.data ?? null,
    totalQuantity:
      raw?.totalQuantity !== undefined || raw?.totals?.totalQuantity !== undefined
        ? toNumberOrZero(raw?.totalQuantity ?? raw?.totals?.totalQuantity)
        : null,
    totalCost:
      raw?.totalCost !== undefined || raw?.totals?.totalCost !== undefined
        ? toNumberOrZero(raw?.totalCost ?? raw?.totals?.totalCost)
        : null,
  };
}

function resolveFuelRecordedBy(record: MissionFuelRecord): { name: string; role: string } {
  const roleLabelByCode: Record<string, string> = {
    admin: "Administrateur",
    secretary: "Secrétaire",
    logistics: "Logisticien",
    workshop_manager: "Chef d'atelier",
    technician: "Technicien",
    driver: "Chauffeur",
    warehouse: "Magasinier",
  };
  const normalizedRole = String(record.createdByRole || "")
    .trim()
    .toLowerCase();

  return {
    name: record.createdByName || (record.createdBy ? `Utilisateur #${record.createdBy}` : "Système"),
    role:
      roleLabelByCode[normalizedRole] ||
      (normalizedRole ? normalizedRole : "Profil utilisateur"),
  };
}

export default function MissionDetailsPage() {
  const [, params] = useRoute("/missions/:id");
  const [, setLocation] = useLocation();
  const missionId = params?.id;
  const { user } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("details");
  // Budget de mission (L1f) : drapeau finance et rôles de lecture ; le serveur garde les deux.
  const financeEnabled = useFeature("finance");
  const showBudgetTab = financeEnabled && canReadMissionBudget(user?.role);
  const [openInvoiceDialog, setOpenInvoiceDialog] = useState(false);
  const [openEditDialog, setOpenEditDialog] = useState(false);
  const [openMissionBudgetDialog, setOpenMissionBudgetDialog] = useState(false);
  const [openFuelDialog, setOpenFuelDialog] = useState(false);
  const [openNoFuelConfirm, setOpenNoFuelConfirm] = useState(false);
  const [openCloseMissionDialog, setOpenCloseMissionDialog] = useState(false);
  const [closeMissionFdrInput, setCloseMissionFdrInput] = useState("");
  const [fuelDialogMode, setFuelDialogMode] = useState<"standard" | "regularization">("standard");
  const [fuelRegularizationReason, setFuelRegularizationReason] = useState("");
  const [noFuelDeclarationReason, setNoFuelDeclarationReason] = useState("");
  const [budgetDialogMode, setBudgetDialogMode] = useState<"manual" | "launch">("manual");
  const [missingBudgetFields, setMissingBudgetFields] = useState<MissionBudgetField[]>([]);
  const [missionBudgetForm, setMissionBudgetForm] = useState<Record<MissionBudgetField, string>>({
    fuelBudget: "",
    roadExpensesBudget: "",
    contingencyBudget: "",
  });
  const [fuelForm, setFuelForm] = useState({
    quantity: "",
    unitPrice: "",
    stationName: "",
    dateTime: "",
    notes: "",
    isPreDeparture: false,
  });
  // Prix du litre : saisi par l'administrateur et la logistique, imposé (prix du jour) aux autres.
  const { canEdit: canEditFuelPrice, priceAt: fuelPriceAtDate, isLoading: fuelPriceLoading } = useFuelPrice(user?.role);
  const fuelFormUnitPrice = canEditFuelPrice
    ? fuelForm.unitPrice
    : String(fuelPriceAtDate(fuelForm.dateTime || localDateKey()));
  const [errorModal, setErrorModal] = useState<{ title: string; description?: string; details?: string[] } | null>(null);
  const [launchBlockedDocumentTypes, setLaunchBlockedDocumentTypes] = useState<MissionDocumentType[]>([]);
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(format(addDays(new Date(), 30), "yyyy-MM-dd"));
  const [includeVAT, setIncludeVAT] = useState(true);
  const [editForm, setEditForm] = useState({
    orderNumber: "",
    missionType: "delivery",
    pickupAddress: "",
    pickupDate: "",
    pickupTime: "",
    deliveryAddress: "",
    deliveryDate: "",
    deliveryTime: "",
    cargoDescription: "",
    weight: "",
    volume: "",
    estimatedDistance: "",
    specialInstructions: "",
    vehicleId: "",
    driverId: "",
  });

  const { data: mission, isLoading, isError, error } = useQuery<any>({
    queryKey: [`/api/missions/${missionId}`],
    enabled: !!missionId,
  });

  const { data: renewalRequests } = useQuery<any[]>({
    queryKey: [`/api/missions/${missionId}/document-renewal-requests`],
    enabled: !!missionId,
    staleTime: 30_000,
  });

  const {
    data: launchReadiness,
    isLoading: isLaunchReadinessLoading,
    isError: isLaunchReadinessError,
    error: launchReadinessError,
  } = useQuery<any>({
    queryKey: [`/api/missions/${missionId}/launch-readiness`],
    enabled: !!missionId,
    staleTime: 10_000,
  });

  const {
    data: missionFuelData,
    isLoading: isMissionFuelLoading,
    isError: isMissionFuelError,
    error: missionFuelError,
  } = useQuery<MissionFuelRecordsResponse>({
    queryKey: [`/api/missions/${missionId}/fuel-records`],
    enabled: !!missionId,
    staleTime: 10_000,
    select: normalizeMissionFuelRecordsResponse,
  });

  const { data: availableVehicles } = useQuery<any>({
    queryKey: ["/api/vehicles/all"],
    enabled: openEditDialog,
    select: (data: any[]) => data?.filter((v) => v.status === "operational") || [],
  });

  const { data: activeDrivers } = useQuery<any>({
    queryKey: ["/api/drivers"],
    enabled: openEditDialog,
    select: (data: any[]) => data?.filter((d) => d.isActive) || [],
  });

  const missionBudgetValues = extractMissionBudgetValues(mission);
  const missionActualFdrCost = extractMissionActualRoadExpensesHT(mission?.workflowData);
  const missionBudgetSuggestionValues: Record<MissionBudgetField, number | null> = {
    fuelBudget: toNumericBudget(launchReadiness?.budgetSuggestion?.fuelBudget),
    roadExpensesBudget: toNumericBudget(launchReadiness?.budgetSuggestion?.roadExpensesBudget),
    contingencyBudget: toNumericBudget(launchReadiness?.budgetSuggestion?.contingencyBudget),
  };
  const missionBudgetSuggestionConfidence = String(launchReadiness?.budgetSuggestion?.confidence || "");

  const applyBudgetSuggestionToForm = () => {
    setMissionBudgetForm((prev) => {
      const next = { ...prev };
      for (const field of MISSION_BUDGET_FIELDS) {
        const suggested = missionBudgetSuggestionValues[field];
        if (suggested !== null && Number.isFinite(suggested)) {
          next[field] = formatBudgetInputValue(suggested);
        }
      }
      return next;
    });
  };

  useEffect(() => {
    if (openMissionBudgetDialog) return;
    setMissionBudgetForm(
      buildMissionBudgetFormValues(missionBudgetValues, missionBudgetSuggestionValues),
    );
  }, [
    mission?.id,
    openMissionBudgetDialog,
    missionBudgetValues.fuelBudget,
    missionBudgetValues.roadExpensesBudget,
    missionBudgetValues.contingencyBudget,
    missionBudgetSuggestionValues.fuelBudget,
    missionBudgetSuggestionValues.roadExpensesBudget,
    missionBudgetSuggestionValues.contingencyBudget,
  ]);

  useEffect(() => {
    if (!openFuelDialog) return;
    setFuelForm((current) => ({
      quantity: current.quantity,
      unitPrice:
        current.unitPrice ||
        (launchReadiness?.fuel?.fuelUnitPriceUsed
          ? String(Math.round(Number(launchReadiness.fuel.fuelUnitPriceUsed)))
          : ""),
      stationName: current.stationName,
      dateTime: current.dateTime || toDateTimeLocalValue(new Date().toISOString()),
      notes: current.notes,
      isPreDeparture: current.isPreDeparture,
    }));
    if (fuelDialogMode !== "regularization") {
      setFuelRegularizationReason("");
    }
  }, [openFuelDialog, launchReadiness?.fuel?.fuelUnitPriceUsed, fuelDialogMode]);

  const getMissingBudgetFieldsForLaunch = (): MissionBudgetField[] => {
    const missingFromReadiness = new Set<MissionBudgetField>();

    if (Array.isArray(launchReadiness?.checks)) {
      for (const check of launchReadiness.checks) {
        const key = String(check?.key || "");
        const mapped = CHECK_TO_BUDGET_FIELD[key];
        if (!mapped) continue;
        if (!check?.passed) {
          missingFromReadiness.add(mapped);
        }
      }
    }

    if (missingFromReadiness.size > 0) {
      return MISSION_BUDGET_FIELDS.filter((field) => missingFromReadiness.has(field));
    }
    // Finance active : seul le serveur (budget de mission) fait foi, l'ancien budget n'est plus un repli.
    if (financeEnabled) return [];

    const fallbackMissing: MissionBudgetField[] = [];
    if (missionBudgetValues.fuelBudget === null || missionBudgetValues.fuelBudget <= 0) {
      fallbackMissing.push("fuelBudget");
    }
    if (missionBudgetValues.roadExpensesBudget === null || missionBudgetValues.roadExpensesBudget < 0) {
      fallbackMissing.push("roadExpensesBudget");
    }
    if (missionBudgetValues.contingencyBudget === null || missionBudgetValues.contingencyBudget < 0) {
      fallbackMissing.push("contingencyBudget");
    }
    return fallbackMissing;
  };

  const generateInvoiceMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/billing/invoices/generate", {
        missionId: mission.id,
        amount: parseFloat(amount),
        dueDate,
        includeVAT,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices"] });
      toast({ title: "Facture créée avec succès", description: `Facture ${data.invoice.invoiceNumber} créée` });
      setOpenInvoiceDialog(false);
      setLocation(`/operations/invoices/${data.invoice.id}`);
    },
    onError: (error: Error) => {
      setErrorModal({ title: "Erreur facturation", description: userMessageOf(error, "La facturation de la mission a échoué.") });
    },
  });
  // Un double clic créait deux factures pour la même saisie.
  const submitGenerateInvoice = useSingleFlightMutate(generateInvoiceMutation.mutate);

  const updateMissionStatusMutation = useMutation({
    mutationFn: async (
      params: string | { nextStatus: string; actualFdrCost?: number },
    ) => {
      const nextStatus = typeof params === "string" ? params : params.nextStatus;
      const actualFdrCost = typeof params === "string" ? undefined : params.actualFdrCost;
      const body: Record<string, unknown> = { status: nextStatus };
      if (actualFdrCost !== undefined) {
        body.actualFdrCost = actualFdrCost;
      }
      const response = await apiRequest("PUT", `/api/missions/${missionId}/status`, body);
      return parseJsonIfPresent(response);
    },
    onSuccess: (data: any, params) => {
      const nextStatus = typeof params === "string" ? params : params.nextStatus;
      setOpenCloseMissionDialog(false);
      setCloseMissionFdrInput("");
      setLaunchBlockedDocumentTypes([]);
      const updatedMissionRecord =
        data && typeof data === "object" ? (data as Record<string, any>) : null;
      const missionNumericId = missionId ? Number.parseInt(missionId, 10) : null;
      const nowIso = new Date().toISOString();

      // Mise à jour immédiate du cache — pas d'attente de refetch
      queryClient.setQueryData([`/api/missions/${missionId}`], (old: any) => {
        if (!old || typeof old !== "object") return old;
        const nextMission = {
          ...old,
          status: nextStatus,
          workflowData: updatedMissionRecord?.workflowData ?? old.workflowData,
          updatedAt: updatedMissionRecord?.updatedAt ?? nowIso,
          actualStartDate:
            nextStatus === "in_progress"
              ? updatedMissionRecord?.actualStartDate ?? old.actualStartDate ?? nowIso
              : old.actualStartDate,
          actualDeliveryDate:
            nextStatus === "delivered" || nextStatus === "completed"
              ? updatedMissionRecord?.actualDeliveryDate ?? old.actualDeliveryDate ?? nowIso
              : old.actualDeliveryDate,
          currentStep:
            updatedMissionRecord?.currentStep ??
            (nextStatus === "in_progress" ? Math.max(Number(old.currentStep || 1), 3) : old.currentStep),
          completedAt:
            nextStatus === "completed"
              ? updatedMissionRecord?.completedAt ?? nowIso
              : old.completedAt,
          cancelledAt:
            nextStatus === "cancelled"
              ? updatedMissionRecord?.cancelledAt ?? nowIso
              : old.cancelledAt,
        };
        return nextMission;
      });

      queryClient.setQueriesData({ queryKey: ["/api/missions"] }, (existing: any) => {
        if (!existing) return existing;
        if (!missionNumericId || Number.isNaN(missionNumericId)) return existing;

        const patchMission = (item: any) => {
          if (!item || typeof item !== "object") return item;
          if (Number(item.id) !== missionNumericId) return item;
          return {
            ...item,
            status: nextStatus,
            updatedAt: updatedMissionRecord?.updatedAt ?? nowIso,
            actualStartDate:
              nextStatus === "in_progress"
                ? updatedMissionRecord?.actualStartDate ?? item.actualStartDate ?? nowIso
                : item.actualStartDate,
            actualDeliveryDate:
              nextStatus === "delivered" || nextStatus === "completed"
                ? updatedMissionRecord?.actualDeliveryDate ?? item.actualDeliveryDate ?? nowIso
                : item.actualDeliveryDate,
            currentStep:
              updatedMissionRecord?.currentStep ??
              (nextStatus === "in_progress" ? Math.max(Number(item.currentStep || 1), 3) : item.currentStep),
            completedAt:
              nextStatus === "completed"
                ? updatedMissionRecord?.completedAt ?? nowIso
                : item.completedAt,
            cancelledAt:
              nextStatus === "cancelled"
                ? updatedMissionRecord?.cancelledAt ?? nowIso
                : item.cancelledAt,
          };
        };

        if (Array.isArray(existing)) {
          return existing.map(patchMission);
        }

        if (Array.isArray(existing?.missions)) {
          return {
            ...existing,
            missions: existing.missions.map(patchMission),
          };
        }

        return existing;
      });

      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/document-renewal-requests`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/launch-readiness`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/fuel-records`] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      toast({
        title: "Statut mission mis à jour",
        description: `Nouveau statut: ${STATUS_LABELS[nextStatus] || nextStatus}`,
      });
      if (nextStatus === "completed" && Array.isArray(data?.warnings) && data.warnings.includes("no_fuel_records")) {
        toast({
          title: "Mission clôturée sans carburant réel",
          description: "Aucun plein n'est rattaché à cette mission. Le coût carburant réel reste vide.",
          variant: "destructive",
        });
      }
    },
    onError: (error: unknown, nextStatus) => {
      const apiError = extractApiError(error);
      if (nextStatus === "in_progress") {
        const detectedDocumentTypes = extractDocumentIssueTypes([...(apiError.details ?? []), ...(apiError.motifs ?? [])]);
        setLaunchBlockedDocumentTypes(detectedDocumentTypes);
      } else {
        setLaunchBlockedDocumentTypes([]);
      }
      setErrorModal(apiError);
    },
  });

  const saveMissionBudgetsMutation = useMutation({
    mutationFn: async ({
      budgetPayload,
      launchAfterSave,
    }: {
      budgetPayload: Partial<Record<MissionBudgetField, number | null>>;
      launchAfterSave: boolean;
    }) => {
      const response = await apiRequest("PATCH", `/api/missions/${missionId}`, {
        budget: budgetPayload,
      });
      const updatedMission = await parseJsonIfPresent(response);
      return { launchAfterSave, budgetPayload, updatedMission };
    },
    onSuccess: ({ launchAfterSave, budgetPayload, updatedMission }) => {
      queryClient.setQueryData([`/api/missions/${missionId}`], (currentMission: any) => {
        const missionFromApi =
          updatedMission && typeof updatedMission === "object"
            ? {
                ...currentMission,
                ...updatedMission,
                client: updatedMission.client ?? currentMission?.client ?? null,
                assignment: updatedMission.assignment ?? currentMission?.assignment ?? null,
              }
            : currentMission;

        return applyMissionBudgetPatchToMissionCache(missionFromApi, budgetPayload);
      });

      queryClient.setQueryData([`/api/missions/${missionId}/launch-readiness`], (currentReadiness: any) =>
        applyMissionBudgetPatchToLaunchReadinessCache(currentReadiness, budgetPayload),
      );

      setOpenMissionBudgetDialog(false);
      setMissingBudgetFields([]);
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/launch-readiness`] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });

      toast({
        title: "Budgets mission enregistrés",
        description: "Les budgets ont été mis à jour.",
      });

      if (launchAfterSave) {
        updateMissionStatusMutation.mutate("in_progress");
      }
    },
    onError: (error: unknown) => {
      setErrorModal({
        title: "Échec enregistrement budgets",
        description: extractApiErrorMessage(error),
      });
    },
  });

  const createDocumentRenewalRequestMutation = useMutation({
    mutationFn: async (documentTypes: MissionDocumentType[]) => {
      const response = await apiRequest("POST", `/api/missions/${missionId}/document-renewal-requests`, {
        documentTypes,
      });
      return parseJsonIfPresent(response);
    },
    onSuccess: (payload: any) => {
      setLaunchBlockedDocumentTypes([]);
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/document-renewal-requests`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/launch-readiness`] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts/count"] });

      const createdCount = Number(payload?.createdCount || 0);
      toast({
        title: createdCount > 0 ? "Demande envoyée" : "Demande déjà existante",
        description:
          createdCount > 0
            ? `${createdCount} notification(s) envoyée(s) à l'administration documentaire.`
            : "Une demande est déjà ouverte pour ces documents.",
      });
    },
    onError: (error: unknown) => {
      const info = extractApiError(error);
      setErrorModal({
        title: "Échec création demande",
        description: info.title,
        details: info.details,
      });
    },
  });

  const declareMissionNoFuelMutation = useMutation({
    mutationFn: async ({ closeAfterDeclaration }: { closeAfterDeclaration: boolean }) => {
      const reason = noFuelDeclarationReason.trim();
      if (reason.length < 8) {
        throw new Error("Le motif est obligatoire (minimum 8 caractères).");
      }

      const response = await apiRequest("POST", `/api/missions/${missionId}/fuel-records/declare-no-refuel`, {
        reason,
      });
      const payload = await parseJsonIfPresent(response);
      return { payload, closeAfterDeclaration };
    },
    onSuccess: ({ payload, closeAfterDeclaration }) => {
      const declaration = payload?.declaration ?? null;

      queryClient.setQueryData([`/api/missions/${missionId}/fuel-records`], (current: any) => {
        const normalizedCurrent = normalizeMissionFuelRecordsResponse(current);
        return {
          records: normalizedCurrent.records,
          totalQuantity: normalizedCurrent.totalQuantity,
          totalCost: normalizedCurrent.totalCost,
          tracking: {
            noRefuelDeclaration: declaration,
          },
        };
      });

      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/fuel-records`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/launch-readiness`] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });

      setOpenNoFuelConfirm(false);
      setNoFuelDeclarationReason("");

      toast({
        title: "Mission déclarée sans plein",
        description: "Le motif a été enregistré pour la traçabilité carburant.",
      });

      if (closeAfterDeclaration) {
        openMissionCloseDialog();
      }
    },
    onError: (error: unknown) => {
      setErrorModal({
        title: "Échec déclaration sans plein",
        description: extractApiErrorMessage(error),
      });
    },
  });

  // Clé du plein en cours de saisie (normal ou régularisation), par mission, en sessionStorage :
  // libérée au succès, sur un 4xx et à l'annulation ; CONSERVÉE sur une issue inconnue (réseau,
  // 5xx), même si la fiche est fermée puis rouverte, pour que le serveur rejoue au lieu de débiter
  // une seconde fois. Deux onglets ont deux stockages : deux saisies, donc deux débits (voulu).
  const fuelSubmissionKeys = useMemo(() => createSubmissionKeyStore(missionFuelKeyScope(missionId ?? "inconnue")), [missionId]);

  const addMissionFuelMutation = useMutation({
    mutationFn: async () => {
      const assignedVehicleId = Number(mission?.assignment?.vehicle?.id || 0);
      if (!assignedVehicleId) {
        throw new Error("Aucun véhicule n'est affecté à cette mission.");
      }

      const quantity = Number(String(fuelForm.quantity).replace(",", "."));
      const unitPrice = Number(String(fuelFormUnitPrice).replace(",", "."));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("La quantité doit être strictement positive.");
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error("Le prix par litre doit être strictement positif.");
      }
      if (!fuelForm.dateTime) {
        throw new Error("La date et l'heure du plein sont obligatoires.");
      }

      const recordDate = new Date(fuelForm.dateTime);
      if (Number.isNaN(recordDate.getTime())) {
        throw new Error("La date du plein est invalide.");
      }

      const isRegularizationRequest = fuelDialogMode === "regularization" || String(mission?.status || "") === "completed";
      if (isRegularizationRequest && fuelRegularizationReason.trim().length < 8) {
        throw new Error("Le motif de régularisation est obligatoire (minimum 8 caractères).");
      }

      const endpoint = isRegularizationRequest
        ? `/api/missions/${missionId}/fuel-records/regularize`
        : `/api/missions/${missionId}/fuel-records`;

      const response = await apiRequest("POST", endpoint, {
        vehicleId: assignedVehicleId,
        quantity,
        unitPrice,
        date: recordDate.toISOString(),
        stationName: fuelForm.stationName || undefined,
        notes: fuelForm.notes || undefined,
        regularizationReason: isRegularizationRequest ? fuelRegularizationReason.trim() : undefined,
        isPreDeparture: fuelForm.isPreDeparture,
        // Empreinte de la saisie : une saisie différente après une issue incertaine reçoit une nouvelle clé.
        requestKey: fuelSubmissionKeys.take({
          endpoint,
          day: recordDate.toISOString().slice(0, 10),
          quantity,
          unitPrice,
          stationName: fuelForm.stationName || null,
          notes: fuelForm.notes || null,
          reason: isRegularizationRequest ? fuelRegularizationReason.trim() : null,
          isPreDeparture: fuelForm.isPreDeparture,
        }),
      });

      return {
        normalizedPayload: normalizeMissionFuelMutationPayload(await parseJsonIfPresent(response)),
        isRegularizationRequest,
      };
    },
    onSuccess: ({ normalizedPayload: payload, isRegularizationRequest }) => {
      fuelSubmissionKeys.settle();
      queryClient.setQueryData([`/api/missions/${missionId}/fuel-records`], (current: any) => {
        const normalizedCurrent = normalizeMissionFuelRecordsResponse(current);
        const nextRecords = payload.record
          ? [payload.record, ...normalizedCurrent.records.filter((item) => Number(item.id) !== Number(payload.record?.id))]
          : normalizedCurrent.records;

        return {
          records: nextRecords,
          totalQuantity: payload.totalQuantity ?? normalizedCurrent.totalQuantity,
          totalCost: payload.totalCost ?? normalizedCurrent.totalCost,
          tracking: {
            noRefuelDeclaration: null,
          },
        };
      });

      if (payload.totalCost !== null || payload.totalQuantity !== null) {
        queryClient.setQueryData([`/api/missions/${missionId}`], (currentMission: any) => {
          if (!currentMission || typeof currentMission !== "object") return currentMission;
          return {
            ...currentMission,
            actualFuelCost:
              payload.totalCost !== null ? String(payload.totalCost) : currentMission.actualFuelCost,
            actualFuelQuantity:
              payload.totalQuantity !== null ? payload.totalQuantity : currentMission.actualFuelQuantity,
          };
        });
      }

      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/fuel-records`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/launch-readiness`] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });

      setOpenFuelDialog(false);
      setFuelDialogMode("standard");
      setFuelRegularizationReason("");
      setFuelForm({
        quantity: "",
        unitPrice: "",
        stationName: "",
        dateTime: "",
        notes: "",
        isPreDeparture: false,
      });

      toast({
        title: isRegularizationRequest ? "Régularisation enregistrée" : "Plein enregistré",
        description: isRegularizationRequest
          ? "Le plein a été rattaché à la mission terminée."
          : "Le carburant réel mission a été mis à jour.",
      });
    },
    onError: (error: unknown) => {
      // 4xx : clé libérée. Réseau ou 5xx : clé conservée, le prochain envoi sera rejoué.
      fuelSubmissionKeys.settle(error);
      if ((isApiError(error) && error.status === 409) || isIndeterminateOutcome(error)) {
        // Plein peut-être déjà enregistré : l'écran relit les pleins pour le montrer.
        queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/fuel-records`] });
      }
      setErrorModal({
        title: "Échec enregistrement plein",
        description: extractApiErrorMessage(error),
      });
    },
  });

  // Débit de la carte carburant : un double clic ne doit envoyer qu'une requête.
  const submitMissionFuel = useSingleFlightMutate(addMissionFuelMutation.mutate);

  const updateMissionMutation = useMutation({
    mutationFn: async () => {
      const pickupDateTime = editForm.pickupDate
        ? new Date(`${editForm.pickupDate}T${editForm.pickupTime || "00:00"}`)
        : null;
      const deliveryDateTime = editForm.deliveryDate
        ? new Date(`${editForm.deliveryDate}T${editForm.deliveryTime || "00:00"}`)
        : null;

      const payload = {
        orderNumber: editForm.orderNumber,
        missionType: editForm.missionType,
        pickupAddress: editForm.pickupAddress,
        pickupDate: pickupDateTime ? pickupDateTime.toISOString() : null,
        deliveryAddress: editForm.deliveryAddress,
        deliveryDate: deliveryDateTime ? deliveryDateTime.toISOString() : null,
        cargoDescription: editForm.cargoDescription || null,
        weight: editForm.weight !== "" ? Number(editForm.weight) : null,
        volume: editForm.volume !== "" ? Number(editForm.volume) : null,
        estimatedDistance: editForm.estimatedDistance !== "" ? Number(editForm.estimatedDistance) : null,
        specialInstructions: editForm.specialInstructions || null,
        assignment: editForm.vehicleId && editForm.driverId
          ? {
              vehicleId: Number(editForm.vehicleId),
              driverId: Number(editForm.driverId),
            }
          : null,
      };

      const response = await apiRequest("PATCH", `/api/missions/${missionId}`, payload);
      return parseJsonIfPresent(response);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${missionId}/launch-readiness`] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
      toast({
        title: "Mission mise à jour",
        description: "Les informations de mission ont été enregistrées.",
      });
      setOpenEditDialog(false);
    },
    onError: (error: unknown) => {
      setErrorModal({
        title: "Échec de mise à jour",
        description: extractApiErrorMessage(error),
      });
    },
  });

  const calculateTTC = () => {
    const v = parseFloat(amount) || 0;
    return includeVAT ? v * 1.1925 : v;
  };

  const handleGenerateInvoice = () => {
    if (!amount || parseFloat(amount) <= 0) {
      setErrorModal({ title: "Montant invalide", description: "Veuillez saisir un montant valide." });
      return;
    }
    submitGenerateInvoice();
  };

  const toDateInputValue = (dateValue: string | null | undefined): string => {
    if (!dateValue) return "";
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const toTimeInputValue = (dateValue: string | null | undefined): string => {
    if (!dateValue) return "";
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return "";
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="h-52 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
        <div className="h-10 rounded-xl border border-gray-100 bg-gray-50 animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            <div className="h-40 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
            <div className="h-48 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
          </div>
          <div className="h-64 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse" />
        </div>
      </div>
    );
  }

  if (isError) {
    const errorMessage = error instanceof Error ? error.message : "Une erreur est survenue";
    const is404 = isApiError(error, 404) || errorMessage.toLowerCase().includes("not found");
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
          <div className="h-0.5 bg-gradient-to-r from-success to-success" />
          <div className="p-6">
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground mb-4" onClick={() => setLocation("/missions")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Missions
            </Button>
            <h2 className="text-lg font-bold text-gray-800 mb-2">{is404 ? "Mission non trouvée" : "Erreur de chargement"}</h2>
            <p className="text-sm text-gray-500 mb-4">
              {is404 ? "Cette mission n'existe pas dans la base de données." : "Impossible de charger les détails de la mission."}
            </p>
            {!is404 && <p className="text-xs text-destructive-text font-mono bg-destructive/10 p-2 rounded mb-4">Erreur: {errorMessage}</p>}
            <Button onClick={() => setLocation("/missions")} data-testid="btn-back-error">
              <ArrowLeft className="h-4 w-4 mr-2" /> Retour aux missions
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!mission) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
          <div className="h-0.5 bg-gradient-to-r from-success to-success" />
          <div className="p-6">
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground mb-4" onClick={() => setLocation("/missions")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Missions
            </Button>
            <h2 className="text-lg font-bold text-gray-800 mb-2">Données manquantes</h2>
            <p className="text-sm text-gray-500 mb-4">Le serveur n'a renvoyé aucune donnée pour cette mission. Veuillez réessayer.</p>
            <Button onClick={() => setLocation("/missions")} data-testid="btn-back-no-data">
              <ArrowLeft className="h-4 w-4 mr-2" /> Retour aux missions
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const primaryMissionAction =
    mission.status === "planned" || mission.status === "assigned"
      ? { nextStatus: "in_progress", label: "Lancer la mission", helper: "Déclenche les contrôles métier avant départ." }
      : mission.status === "in_progress"
        ? { nextStatus: "delivered", label: "Marquer livrée", helper: "Confirme l'arrivée et la livraison." }
        : mission.status === "delivered"
          ? { nextStatus: "completed", label: "Clôturer la mission", helper: "Ferme définitivement la mission." }
          : null;

  const canTriggerPrimaryAction = Boolean(primaryMissionAction);
  const canGenerateClientInvoice = ["delivered", "completed"].includes(String(mission.status || ""));

  // Calcul retard départ (utilisé dans header + suivi d'exécution)
  const departureDelay: { type: "late_not_started" | "late_started" | "on_time"; parts: string } | null = (() => {
    const startedAt = mission.assignment?.startedAt;
    const pickupDate = mission.pickupDate;
    if (!startedAt && pickupDate && ["planned", "assigned"].includes(mission.status)) {
      const delayMin = differenceInMinutes(new Date(), new Date(pickupDate));
      if (delayMin > 0) {
        const days = Math.floor(delayMin / 1440);
        const hours = Math.floor((delayMin % 1440) / 60);
        const mins = delayMin % 60;
        const parts = [days > 0 ? `${days}j` : "", hours > 0 ? `${hours}h` : "", mins > 0 ? `${mins}min` : ""].filter(Boolean).join(" ");
        return { type: "late_not_started", parts };
      }
    }
    if (startedAt && pickupDate) {
      const delayMin = differenceInMinutes(new Date(startedAt), new Date(pickupDate));
      if (!isNaN(delayMin)) {
        if (delayMin > 0) {
          const days = Math.floor(delayMin / 1440);
          const hours = Math.floor((delayMin % 1440) / 60);
          const mins = delayMin % 60;
          const parts = [days > 0 ? `${days}j` : "", hours > 0 ? `${hours}h` : "", mins > 0 ? `${mins}min` : ""].filter(Boolean).join(" ");
          return { type: "late_started", parts };
        }
        return { type: "on_time", parts: "" };
      }
    }
    return null;
  })();

  const openMissionCloseDialog = () => {
    const existingFdr = extractMissionActualRoadExpensesHT(mission?.workflowData);
    setCloseMissionFdrInput(
      existingFdr !== null && Number.isFinite(existingFdr) ? String(Math.round(existingFdr)) : "",
    );
    setOpenCloseMissionDialog(true);
  };

  const submitMissionClosure = () => {
    const rawValue = closeMissionFdrInput.trim();
    if (rawValue === "") {
      setErrorModal({
        title: "FDR réels obligatoires",
        description:
          "Saisissez le montant HT réel des frais de route pour clôturer la mission. Indiquez 0 s'il n'y en a pas eu.",
      });
      return;
    }

    const parsedValue = Number(rawValue.replace(",", "."));
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      setErrorModal({
        title: "Montant invalide",
        description: "Le montant FDR doit être un nombre ≥ 0.",
      });
      return;
    }

    updateMissionStatusMutation.mutate({
      nextStatus: "completed",
      actualFdrCost: Math.round(parsedValue),
    });
  };

  const handlePrimaryMissionAction = () => {
    if (!primaryMissionAction) return;

    if (primaryMissionAction.nextStatus === "in_progress") {
      const missingFields = getMissingBudgetFieldsForLaunch();
      // Finance active : le budget de mission (onglet Budget) remplace l'ancien bloc, qui n'est plus saisi ici.
      if (financeEnabled && missingFields.length > 0) {
        const budgetCheck = launchReadiness?.checks?.find((check: { key?: string; passed?: boolean }) => CHECK_TO_BUDGET_FIELD[String(check?.key || "")] && !check?.passed);
        toast({
          title: "Lancement impossible",
          description: budgetCheck?.detail || "Créer et faire approuver le budget dans l'onglet Budget.",
          variant: "destructive",
        });
        if (showBudgetTab) setActiveTab("budget");
        return;
      }
      if (missingFields.length > 0) {
        setBudgetDialogMode("launch");
        setMissingBudgetFields(missingFields);
        setOpenMissionBudgetDialog(true);
        return;
      }
    }

    if (
      primaryMissionAction.nextStatus === "completed" &&
      missionFuelRecords.length === 0 &&
      !missionNoRefuelDeclaration
    ) {
      setOpenNoFuelConfirm(true);
      return;
    }

    if (primaryMissionAction.nextStatus === "completed") {
      openMissionCloseDialog();
      return;
    }

    updateMissionStatusMutation.mutate(primaryMissionAction.nextStatus);
  };

  const openMissionFuelDialog = () => {
    setFuelDialogMode(canRegularizeMissionFuel ? "regularization" : "standard");
    setOpenFuelDialog(true);
  };

  const openMissionBudgetManagerDialog = () => {
    setMissionBudgetForm(
      buildMissionBudgetFormValues(missionBudgetValues, missionBudgetSuggestionValues),
    );
    setBudgetDialogMode("manual");
    setMissingBudgetFields([]);
    setOpenMissionBudgetDialog(true);
  };

  const handleSaveMissionBudgets = () => {
    const targetFields =
      budgetDialogMode === "launch" && missingBudgetFields.length > 0
        ? missingBudgetFields
        : MISSION_BUDGET_FIELDS;

    const budgetPayload: Partial<Record<MissionBudgetField, number | null>> = {};

    for (const field of targetFields) {
      const rawValue = String(missionBudgetForm[field] ?? "").trim();

      if (rawValue === "") {
        if (budgetDialogMode === "launch") {
          setErrorModal({
            title: "Budget manquant",
            description: `${MISSION_BUDGET_LABELS[field]} est requis pour lancer la mission.`,
          });
          return;
        }
        budgetPayload[field] = null;
        continue;
      }

      const parsedValue = Number(rawValue.replace(",", "."));
      if (!Number.isFinite(parsedValue)) {
        setErrorModal({
          title: "Montant invalide",
          description: `${MISSION_BUDGET_LABELS[field]} doit être un nombre valide.`,
        });
        return;
      }

      if (field === "fuelBudget" && parsedValue <= 0) {
        setErrorModal({
          title: "Budget carburant invalide",
          description: "Le budget carburant doit être strictement positif.",
        });
        return;
      }

      if ((field === "roadExpensesBudget" || field === "contingencyBudget") && parsedValue < 0) {
        setErrorModal({
          title: "Montant invalide",
          description: `${MISSION_BUDGET_LABELS[field]} doit être supérieur ou égal à 0.`,
        });
        return;
      }

      budgetPayload[field] = parsedValue;
    }

    saveMissionBudgetsMutation.mutate({
      budgetPayload,
      launchAfterSave: budgetDialogMode === "launch",
    });
  };

  const missionBudgetTotal = MISSION_BUDGET_FIELDS.reduce((sum, field) => {
    const value = missionBudgetValues[field];
    if (value === null || !Number.isFinite(value)) return sum;
    return sum + value;
  }, 0);

  const hasAnyMissionBudget = MISSION_BUDGET_FIELDS.some((field) => {
    const value = missionBudgetValues[field];
    return value !== null && Number.isFinite(value);
  });

  const showMissionCostCard = hasAnyMissionBudget || Boolean(mission.actualFuelCost);
  const hasCargoCard = Boolean(mission.cargo?.description || mission.weight || mission.volume);
  const missionFuelRecords = missionFuelData?.records || [];
  const missionNoRefuelDeclaration = missionFuelData?.noRefuelDeclaration || null;
  const missionFuelTotalQuantity =
    missionFuelData?.totalQuantity && missionFuelData.totalQuantity > 0
      ? missionFuelData.totalQuantity
      : toNumberOrZero(mission?.actualFuelQuantity);
  const missionFuelTotalCost =
    missionFuelData?.totalCost && missionFuelData.totalCost > 0
      ? missionFuelData.totalCost
      : toNumberOrZero(mission?.actualFuelCost);
  const missionFuelDelta =
    missionBudgetValues.fuelBudget !== null && Number.isFinite(missionBudgetValues.fuelBudget)
      ? missionBudgetValues.fuelBudget - missionFuelTotalCost
      : null;
  // Consommation réelle de la mission, en L/100 km.
  // Étape 0 de docs/plans/fuel-consumption-performance.md: dérivée de l'existant,
  // sans migration. `null` dès qu'une des deux données manque — on n'affiche
  // jamais une estimation à la place d'une mesure.
  const missionDistanceReelle = toNumberOrZero(mission?.actualDistance);
  const missionConsumption =
    missionDistanceReelle > 0 && missionFuelTotalQuantity > 0
      ? (missionFuelTotalQuantity / missionDistanceReelle) * 100
      : null;

  const canManageMission = (MISSION_MANAGER_ROLES as readonly string[]).includes(String(user?.role || ""));
  // Carburant de mission : mêmes gestionnaires que la mission (MISSION_FUEL_MANAGERS côté serveur).
  const canManageMissionFuel = canManageMission;
  // PUT /status : gestionnaires, plus le chauffeur affecté. Un chauffeur ne charge cette page
  // que pour ses propres missions (cloison serveur), le rôle suffit donc ici. Il démarre et livre ;
  // « Clôturer » (coût réel) et l'annulation restent aux gestionnaires, comme côté serveur.
  const canChangeMissionStatus = Boolean(
    primaryMissionAction && canRoleSetMissionStatus(user?.role, primaryMissionAction.nextStatus),
  );
  const isMissionCompleted = String(mission?.status || "") === "completed";
  const canDeclareMissionWithoutFuel =
    canManageMissionFuel &&
    ["delivered", "completed"].includes(String(mission?.status || "")) &&
    missionFuelRecords.length === 0 &&
    !missionNoRefuelDeclaration;
  const shouldCloseMissionAfterNoFuelDeclaration = String(mission?.status || "") === "delivered";
  const canRegularizeMissionFuel = canManageMissionFuel && isMissionCompleted;
  const fuelUnitPriceSuggestion =
    launchReadiness?.fuel?.fuelUnitPriceUsed
      ? `${Math.round(Number(launchReadiness.fuel.fuelUnitPriceUsed))} FCFA/L`
      : "Prix non suggéré";

  const missionFuelTableColumns: PremiumDataTableColumn<MissionFuelRecord>[] = [
    {
      id: "date",
      header: "Date",
      cell: (row) => (
        <div className="min-w-[120px]">
          <p className="text-sm font-semibold text-gray-800">{safeFormat(row.date, "dd/MM/yyyy")}</p>
          <p className="text-xs text-gray-500">{safeFormat(row.date, "HH:mm")}</p>
        </div>
      ),
    },
    {
      id: "quantity",
      header: "Quantité",
      cell: (row) => <span className="text-sm font-semibold text-gray-800">{formatFuelQuantity(row.quantity)}</span>,
      align: "right",
    },
    {
      id: "unitPrice",
      header: "Prix/L",
      cell: (row) => <span className="text-sm text-gray-700">{formatPrice(row.unitPrice || 0)}</span>,
      align: "right",
    },
    {
      id: "cost",
      header: "Coût total",
      cell: (row) => <span className="text-sm font-semibold text-gray-900">{formatPrice(row.debitAmount || 0)}</span>,
      align: "right",
    },
    {
      id: "station",
      header: "Station",
      cell: (row) => <span className="text-sm text-gray-700">{row.stationName || "Non précisée"}</span>,
    },
    {
      id: "createdBy",
      header: "Enregistré par",
      cell: (row) => {
        const recordedBy = resolveFuelRecordedBy(row);
        return (
          <div>
            <p className="text-sm font-semibold text-gray-800">{recordedBy.name}</p>
            <p className="text-xs text-gray-500 capitalize">{recordedBy.role}</p>
          </div>
        );
      },
    },
    {
      id: "preDeparture",
      header: "Pré-départ",
      cell: (row) => (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            row.isPreDeparture
              ? "bg-success/10 text-success border border-success/30"
              : "bg-gray-100 text-gray-600 border border-gray-200"
          }`}
        >
          {row.isPreDeparture ? "Oui" : "Non"}
        </span>
      ),
      align: "center",
    },
  ];

  const missionBudgetFieldsInDialog =
    budgetDialogMode === "launch" && missingBudgetFields.length > 0
      ? missingBudgetFields
      : MISSION_BUDGET_FIELDS;

  const launchMissingBudgetLabels =
    budgetDialogMode === "launch"
      ? missingBudgetFields.map((field) => MISSION_BUDGET_LABELS[field])
      : [];

  // Q19 : montant retiré par le serveur hors des rôles qui le lisent : afficher « — », jamais 0 ni « Non renseigné ».
  const budgetAmountsHidden = !canReadMissionBudget(user?.role);
  const budgetAmountText = (value: number | null) =>
    budgetAmountsHidden ? "—" : value !== null ? formatPrice(value) : "Non renseigné";
  const launchFuelBalanceRaw = launchReadiness?.fuel?.balance;
  const launchFuelBalance = Number(launchFuelBalanceRaw || 0);
  const launchFuelUnitPriceUsedRaw = Number(launchReadiness?.fuel?.fuelUnitPriceUsed || 0);
  const launchFuelUnitPriceFallbackRaw = Number(launchReadiness?.fuel?.fuelUnitPriceFallback || 0);
  const launchFuelUnitPriceRealRaw = Number(launchReadiness?.fuel?.fuelUnitPriceReal || 0);
  const launchFuelUnitPriceUsed =
    Number.isFinite(launchFuelUnitPriceUsedRaw) && launchFuelUnitPriceUsedRaw > 0
      ? launchFuelUnitPriceUsedRaw
      : 828;
  const launchFuelUnitPriceFallback =
    Number.isFinite(launchFuelUnitPriceFallbackRaw) && launchFuelUnitPriceFallbackRaw > 0
      ? launchFuelUnitPriceFallbackRaw
      : 828;
  const launchFuelUnitPriceReal =
    Number.isFinite(launchFuelUnitPriceRealRaw) && launchFuelUnitPriceRealRaw > 0
      ? launchFuelUnitPriceRealRaw
      : null;
  const launchFuelUnitPriceSource =
    launchReadiness?.fuel?.fuelUnitPriceSource === "real" ? "real" : "fallback";

  // Décision utilisateur (3 novembre 2026) : seuls les gestionnaires saisissent les budgets.
  // Le chauffeur affecté qui lance une mission incomplète voit ce qui manque, sans champ de saisie.
  const budgetEntryAllowed = canManageMission;

  const launchHint =
    budgetDialogMode === "launch"
      ? budgetEntryAllowed
        ? "Complétez uniquement les budgets manquants pour lancer la mission."
        : "La mission ne peut pas partir tant que ces budgets ne sont pas renseignés."
      : "Renseignez ou ajustez les budgets prévisionnels de mission.";

  const hasMissingBudgetWarning =
    budgetDialogMode === "launch" && launchMissingBudgetLabels.length > 0;

  const launchActionLabel =
    budgetDialogMode === "launch"
      ? "Enregistrer et lancer"
      : "Enregistrer les budgets";

  const launchActionPendingLabel =
    budgetDialogMode === "launch"
      ? "Enregistrement..."
      : "Enregistrement...";

  const hasBudgetSuggestion = MISSION_BUDGET_FIELDS.some((field) => {
    const value = missionBudgetSuggestionValues[field];
    return value !== null && Number.isFinite(value) && value > 0;
  });

  const suggestionConfidenceLabel =
    missionBudgetSuggestionConfidence === "high"
      ? "Fiabilité élevée"
      : missionBudgetSuggestionConfidence === "medium"
        ? "Fiabilité moyenne"
        : missionBudgetSuggestionConfidence === "low"
          ? "Fiabilité faible"
          : null;

  const actualStartDateValue =
    mission.actualStartDate ??
    mission.startedAt ??
    mission.assignment?.startedAt ??
    null;

  const actualDeliveryDateValue =
    mission.actualDeliveryDate ??
    mission.completedAt ??
    mission.assignment?.completedAt ??
    null;

  const missionDriverName = mission.assignment?.driver
    ? `${mission.assignment.driver.firstName} ${mission.assignment.driver.lastName}`
    : "Non assigné";
  const missionDriverCode = mission.assignment?.driver?.driverNumber || "—";
  const missionVehicleLabel = mission.assignment?.vehicle?.registrationNumber || "Non assigné";
  const missionVehicleModel = mission.assignment?.vehicle?.model || "—";

  const buildRoadSheetHtml = (): string => {
    const checklistRows = Array.isArray(launchReadiness?.checks)
      ? launchReadiness.checks
          .map((check: any) => {
            const passed = Boolean(check?.passed);
            const label = escapeHtml(check?.label || "Contrôle");
            const detail = escapeHtml(check?.detail || "—");
            return `
              <tr>
                <td>${label}</td>
                <td class="${passed ? "ok" : "ko"}">${passed ? "OK" : "À corriger"}</td>
                <td>${detail}</td>
              </tr>
            `;
          })
          .join("")
      : `
        <tr>
          <td>Checklist lancement</td>
          <td class="ko">Indisponible</td>
          <td>Données de vérification non disponibles.</td>
        </tr>
      `;

    const generatedAt = safeFormat(new Date().toISOString(), "dd/MM/yyyy HH:mm");
    const budgetTotal = missionBudgetTotal > 0 ? formatPrice(missionBudgetTotal) : "Non renseigné";

    return `
      <!doctype html>
      <html lang="fr">
        <head>
          <meta charset="utf-8" />
          <title>Feuille de route - ${escapeHtml(mission.orderNumber || "Mission")}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              color: #0f172a;
              background: #f8fafc;
            }
            .page {
              width: 210mm;
              min-height: 297mm;
              margin: 0 auto;
              background: #ffffff;
              padding: 18mm 14mm 14mm;
            }
            .header {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              padding-bottom: 10px;
              border-bottom: 2px solid #22c55e;
              margin-bottom: 14px;
            }
            .brand {
              font-size: 11px;
              letter-spacing: 0.08em;
              color: #16a34a;
              font-weight: 700;
              text-transform: uppercase;
            }
            .title {
              margin-top: 4px;
              font-size: 26px;
              line-height: 1.2;
              font-weight: 800;
              color: #111827;
            }
            .subtitle {
              margin-top: 4px;
              font-size: 12px;
              color: #6b7280;
            }
            .chip {
              display: inline-block;
              margin-top: 6px;
              padding: 4px 10px;
              border-radius: 999px;
              font-size: 11px;
              font-weight: 700;
              background: #dcfce7;
              color: #166534;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 10px;
              margin-bottom: 10px;
            }
            .card {
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              padding: 10px 11px;
            }
            .card h4 {
              margin: 0 0 6px;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              color: #6b7280;
            }
            .kv {
              display: grid;
              grid-template-columns: 130px 1fr;
              gap: 5px 10px;
              font-size: 12px;
            }
            .kv span:nth-child(odd) { color: #6b7280; }
            .section {
              margin-top: 12px;
              border: 1px solid #e5e7eb;
              border-radius: 10px;
              overflow: hidden;
            }
            .section-title {
              padding: 8px 11px;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              background: #f9fafb;
              color: #374151;
              font-weight: 700;
            }
            .section-content {
              padding: 10px 11px;
              font-size: 12px;
              color: #111827;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 12px;
            }
            th, td {
              border-bottom: 1px solid #e5e7eb;
              text-align: left;
              padding: 8px 8px;
              vertical-align: top;
            }
            th {
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              color: #6b7280;
              background: #f9fafb;
            }
            .ok { color: #15803d; font-weight: 700; }
            .ko { color: #b91c1c; font-weight: 700; }
            .signatures {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
              margin-top: 12px;
            }
            .sig {
              border: 1px dashed #cbd5e1;
              border-radius: 10px;
              min-height: 95px;
              padding: 10px;
              font-size: 12px;
            }
            .footer {
              margin-top: 12px;
              font-size: 10px;
              color: #6b7280;
              display: flex;
              justify-content: space-between;
            }
            @media print {
              body { background: #ffffff; }
              .page { width: auto; min-height: auto; margin: 0; padding: 0; }
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="header">
              <div>
                <div class="brand">YaroFleetOS · Feuille de route</div>
                <div class="title">${escapeHtml(mission.orderNumber || "Mission sans référence")}</div>
                <div class="subtitle">Client: ${escapeHtml(mission.client?.name || "Non spécifié")} · Type: ${escapeHtml(MISSION_TYPE_LABELS[mission.missionType] || "Autre")}</div>
                <div class="chip">${escapeHtml(STATUS_LABELS[mission.status] || mission.status || "Inconnu")}</div>
              </div>
              <div class="subtitle">Éditée le ${generatedAt}</div>
            </div>

            <div class="grid">
              <div class="card">
                <h4>Ressources</h4>
                <div class="kv">
                  <span>Véhicule</span><span>${escapeHtml(missionVehicleLabel)} · ${escapeHtml(missionVehicleModel)}</span>
                  <span>Chauffeur</span><span>${escapeHtml(missionDriverName)}</span>
                  <span>Code chauffeur</span><span>${escapeHtml(missionDriverCode)}</span>
                </div>
              </div>
              <div class="card">
                <h4>Planning</h4>
                <div class="kv">
                  <span>Départ prévu</span><span>${escapeHtml(safeFormat(mission.pickupDate, "dd/MM/yyyy HH:mm"))}</span>
                  <span>Départ réel</span><span>${escapeHtml(safeFormat(actualStartDateValue, "dd/MM/yyyy HH:mm"))}</span>
                  <span>Livraison prévue</span><span>${escapeHtml(safeFormat(mission.deliveryDate, "dd/MM/yyyy HH:mm"))}</span>
                  <span>Livraison réelle</span><span>${escapeHtml(safeFormat(actualDeliveryDateValue, "dd/MM/yyyy HH:mm"))}</span>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Itinéraire & Cargo</div>
              <div class="section-content">
                <div class="kv">
                  <span>Départ</span><span>${escapeHtml(mission.pickupAddress || "Non renseigné")}</span>
                  <span>Destination</span><span>${escapeHtml(mission.deliveryAddress || "Non renseigné")}</span>
                  <span>Distance estimée</span><span>${escapeHtml(mission.estimatedDistance ? `${mission.estimatedDistance} km` : "Non renseignée")}</span>
                  <span>Cargo</span><span>${escapeHtml(mission.cargo?.description || "Non renseigné")}</span>
                  <span>Poids / Volume</span><span>${escapeHtml(mission.weight ? `${mission.weight} T` : "—")} · ${escapeHtml(mission.volume ? `${mission.volume} m³` : "—")}</span>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Budget mission</div>
              <div class="section-content">
                <div class="kv">
                  <span>Carburant</span><span>${escapeHtml(budgetAmountText(missionBudgetValues.fuelBudget))}</span>
                  <span>Frais de route</span><span>${escapeHtml(budgetAmountText(missionBudgetValues.roadExpensesBudget))}</span>
                  <span>Imprévus</span><span>${escapeHtml(budgetAmountText(missionBudgetValues.contingencyBudget))}</span>
                  <span>Total budget</span><span>${escapeHtml(budgetTotal)}</span>
                </div>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Checklist de lancement</div>
              <div class="section-content" style="padding:0">
                <table>
                  <thead>
                    <tr>
                      <th>Contrôle</th>
                      <th>Résultat</th>
                      <th>Détail</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${checklistRows}
                  </tbody>
                </table>
              </div>
            </div>

            <div class="section">
              <div class="section-title">Consignes</div>
              <div class="section-content">${escapeHtml(mission.specialInstructions || "Aucune consigne particulière.")}</div>
            </div>

            <div class="signatures">
              <div class="sig"><strong>Signature chauffeur</strong><br /><br />Nom, date et signature:</div>
              <div class="sig"><strong>Signature responsable logistique</strong><br /><br />Nom, date et signature:</div>
            </div>

            <div class="footer">
              <span>Document opérationnel - YaroFleetOS</span>
              <span>Mission #${escapeHtml(mission.id)}</span>
            </div>
          </div>
        </body>
      </html>
    `;
  };

  const openRoadSheetPrint = (triggerPrint: boolean) => {
    const printWindow = window.open("", "_blank", "width=1100,height=900");
    if (!printWindow) {
      toast({
        title: "Popup bloquée",
        description: "Autorisez les popups pour imprimer la feuille de route.",
        variant: "destructive",
      });
      return;
    }

    const html = buildRoadSheetHtml();
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();

    if (triggerPrint) {
      setTimeout(() => {
        printWindow.print();
      }, 250);
    }
  };

  const openEditMissionDialog = () => {
    setEditForm({
      orderNumber: mission.orderNumber || "",
      missionType: mission.missionType || "delivery",
      pickupAddress: mission.pickupAddress || "",
      pickupDate: toDateInputValue(mission.pickupDate),
      pickupTime: toTimeInputValue(mission.pickupDate),
      deliveryAddress: mission.deliveryAddress || "",
      deliveryDate: toDateInputValue(mission.deliveryDate),
      deliveryTime: toTimeInputValue(mission.deliveryDate),
      cargoDescription: mission.cargo?.description || "",
      weight: mission.weight ? String(mission.weight) : "",
      volume: mission.volume ? String(mission.volume) : "",
      estimatedDistance: mission.estimatedDistance ? String(mission.estimatedDistance) : "",
      specialInstructions: mission.specialInstructions || "",
      vehicleId: mission.assignment?.vehicle?.id ? String(mission.assignment.vehicle.id) : "",
      driverId: mission.assignment?.driver?.id ? String(mission.assignment.driver.id) : "",
    });
    setOpenEditDialog(true);
  };

  return (
    <div className="space-y-5">
      {/* ── Header card ── */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-card">
        <div className="h-0.5 bg-gradient-to-r from-success to-success" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          <div className="flex items-start justify-between mb-4">
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground" onClick={() => setLocation("/missions")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Missions
            </Button>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* Édition et budgets : gestionnaires de missions seulement (PATCH /api/missions/:id, R3). */}
              {canManageMission && (
                <Button variant="outline" size="sm" className="h-8 px-3 text-xs gap-1.5" onClick={openEditMissionDialog}>
                  <FileText className="h-3.5 w-3.5" /> Modifier
                </Button>
              )}
              {canManageMission && !financeEnabled && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={openMissionBudgetManagerDialog}
                  data-testid="button-open-mission-budgets"
                >
                  <Wallet className="h-3.5 w-3.5" /> Budgets mission
                </Button>
              )}
              {financeEnabled && showBudgetTab && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5"
                  onClick={() => setActiveTab("budget")}
                  data-testid="button-go-mission-budget-tab"
                >
                  <Wallet className="h-3.5 w-3.5" /> Voir l'onglet Budget
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs gap-1.5"
                onClick={() => setActiveTab("print")}
              >
                <Printer className="h-3.5 w-3.5" /> Feuille de route
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs gap-1.5"
                onClick={() => setOpenInvoiceDialog(true)}
                disabled={!canGenerateClientInvoice}
                title={canGenerateClientInvoice ? "Créer une facture client pour cette mission" : "Disponible une fois la mission livrée"}
                data-testid="button-open-generate-invoice-dialog"
              >
                <FileText className="h-3.5 w-3.5" /> Générer facture
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs gap-1.5 opacity-50 cursor-not-allowed"
                disabled
                title={mission.status === "delivered" || mission.status === "completed" ? undefined : "Disponible une fois la mission livrée"}
              >
                <Package className="h-3.5 w-3.5" /> POD {(mission.status === "delivered" || mission.status === "completed") ? "" : "non disponible"}
              </Button>
              {primaryMissionAction && canChangeMissionStatus && (
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5 bg-success hover:brightness-90 text-white"
                  onClick={handlePrimaryMissionAction}
                  disabled={updateMissionStatusMutation.isPending || !canTriggerPrimaryAction}
                  data-testid="button-transition-mission-status-header"
                >
                  <Truck className="h-3.5 w-3.5" />
                  {updateMissionStatusMutation.isPending ? "..." : primaryMissionAction.label}
                </Button>
              )}
            </div>
          </div>

          {/* Status badge */}
          <div className="flex gap-2 mb-4 flex-wrap items-center">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[mission.status] || "bg-gray-100 text-gray-700"}`}>
              {STATUS_LABELS[mission.status] || mission.status}
            </span>
            {departureDelay?.type === "late_not_started" && (
              <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-destructive/15 text-destructive-text">
                <AlertTriangle className="h-3 w-3" /> En retard au départ · {departureDelay.parts}
              </span>
            )}
            {departureDelay?.type === "late_started" && (
              <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-destructive/15 text-destructive-text">
                <AlertTriangle className="h-3 w-3" /> Départ en retard · {departureDelay.parts}
              </span>
            )}
            {departureDelay?.type === "on_time" && (
              <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-success/15 text-success">
                <CheckCircle2 className="h-3 w-3" /> Départ à l'heure
              </span>
            )}
          </div>

          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 border border-success/20 flex items-center justify-center shrink-0">
              <Truck className="h-5 w-5 text-success" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-success">Opérations · Transport</span>
              <h1 className="text-xl font-bold text-gray-900">{mission.orderNumber}</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">{mission.client?.name || "Client non spécifié"}</p>
            </div>
          </div>

          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 mt-5 pt-5 border-t border-gray-100">
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <Package className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Type</p>
              <p className="text-[13px] font-bold text-gray-800">{MISSION_TYPE_LABELS[mission.missionType] || "Autre"}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <Calendar className="h-4 w-4 text-success" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Date de départ prévu</p>
              <p className="text-[13px] font-bold text-gray-800">{safeFormat(mission.pickupDate, "dd/MM/yyyy")}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
                <Clock className="h-4 w-4 text-cyan-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Date de départ réel</p>
              <p className="text-[13px] font-bold text-gray-800">{safeFormat(actualStartDateValue, "dd/MM/yyyy")}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                <MapPin className="h-4 w-4 text-purple-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Date de livraison prévue</p>
              <p className="text-[13px] font-bold text-gray-800">{safeFormat(mission.deliveryDate, "dd/MM/yyyy")}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
                <Clock className="h-4 w-4 text-indigo-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Date de livraison réelle</p>
              <p className="text-[13px] font-bold text-gray-800">{safeFormat(actualDeliveryDateValue, "dd/MM/yyyy")}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
                <Truck className="h-4 w-4 text-orange-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Véhicule</p>
              <p className="text-[13px] font-bold text-gray-800 truncate">{mission.assignment?.vehicle?.registrationNumber || "Non assigné"}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
              <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center">
                <User className="h-4 w-4 text-gray-500" />
              </div>
              <p className="text-[11px] font-medium text-gray-500 mt-1">Chauffeur</p>
              <p className="text-[13px] font-bold text-gray-800 truncate">
                {mission.assignment?.driver
                  ? `${mission.assignment.driver.firstName} ${mission.assignment.driver.lastName}`
                  : "Non assigné"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <PremiumTabsNav tabs={[
          { value: "details", label: "Détails", icon: <TabIcon icon={FileText} /> },
          { value: "fuel", label: "Carburant", icon: <TabIcon icon={Fuel} /> },
          { value: "invoices", label: "Factures", icon: <TabIcon icon={Receipt} /> },
          ...(showBudgetTab ? [{ value: "budget", label: "Budget", icon: <TabIcon icon={Wallet} /> }] : []),
          { value: "print", label: "Imprimer", icon: <TabIcon icon={Printer} /> },
        ]} />

        <TabsContent value="details" className="space-y-4 mt-4">
          <MissionPriceCard
            missionId={mission.id}
            status={mission.status}
            clientId={mission.clientId ? String(mission.clientId) : ""}
            pickupAddress={mission.pickupAddress || ""}
            deliveryAddress={mission.deliveryAddress || ""}
            cargoDescription={mission.cargoDescription || ""}
            pickupDate={mission.pickupDate ? String(mission.pickupDate).slice(0, 10) : ""}
            weight={mission.weight != null ? String(mission.weight) : ""}
          />
          {/* ── Rangée 1 : Informations Mission + Ressources (même hauteur) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 flex flex-col">
              {/* Informations Mission */}
              <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden flex-1">
                <div className="h-0.5 bg-gradient-to-r from-success to-success" />
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Package className="h-3.5 w-3.5 text-blue-500" />
                    </div>
                    <span className="text-sm font-semibold text-gray-800">Informations Mission</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">N° Commande</p>
                      <p className="text-sm font-medium text-gray-800">{mission.orderNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Type Mission</p>
                      <p className="text-sm font-medium text-gray-800">{MISSION_TYPE_LABELS[mission.missionType] || "Autre"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Client</p>
                      <p className="text-sm font-medium text-gray-800">{mission.client?.name || "N/A"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Date Création</p>
                      <p className="text-sm font-medium text-gray-800">{safeFormat(mission.createdAt, "dd/MM/yyyy")}</p>
                    </div>
                  </div>
                  {mission.specialInstructions && (
                    <div className="mt-4 p-3 bg-warning/10 border border-warning/20 rounded-xl">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-warning-text mb-1">Instructions spéciales</p>
                      <p className="text-sm text-gray-700">{mission.specialInstructions}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Ressources (même rangée → même hauteur) */}
            <div className="flex flex-col">
              <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden flex-1">
                <div className="h-0.5 bg-gradient-to-r from-success to-success" />
                <div className="px-5 py-4 h-full flex flex-col">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                      <Truck className="h-3.5 w-3.5 text-blue-500" />
                    </div>
                    <span className="text-sm font-semibold text-gray-800">Ressources</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 flex-1">
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Véhicule</p>
                      {mission.assignment?.vehicle ? (
                        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
                          <p className="text-sm font-semibold text-gray-800">{mission.assignment.vehicle.registrationNumber}</p>
                          <p className="text-xs text-gray-500">{mission.assignment.vehicle.brand} {mission.assignment.vehicle.model}</p>
                          <p className="text-xs text-gray-400">{mission.assignment.vehicle.tonnage}T · {mission.assignment.vehicle.fuelType}</p>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-center">
                          <p className="text-xs text-gray-400">Non assigné</p>
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">Chauffeur</p>
                      {mission.assignment?.driver ? (
                        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
                          <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-gray-400" />
                            {mission.assignment.driver.firstName} {mission.assignment.driver.lastName}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{mission.assignment.driver.employeeNumber}</p>
                          {typeof mission.assignment.driver.cpcEligible === "boolean" ? (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-1.5 inline-block ${
                              mission.assignment.driver.cpcEligible
                                ? "bg-success/15 text-success"
                                : "bg-orange-100 text-orange-700"
                            }`}>
                              {mission.assignment.driver.cpcStatus}
                            </span>
                          ) : (
                            // Verdict non communiqué à ce lecteur : on ne conclut pas à l'éligibilité.
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full mt-1.5 inline-block bg-gray-100 text-gray-500">
                              Verdict CPC indisponible
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-center">
                          <p className="text-xs text-gray-400">Non assigné</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Rangée 2 : Itinéraire + Cargo + Suivi d'exécution ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
            <div className="lg:col-span-2 flex flex-col gap-4">
              {/* Itinéraire */}
              <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
                <div className="h-0.5 bg-gradient-to-r from-success to-success" />
                <div className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center">
                      <MapPin className="h-3.5 w-3.5 text-success" />
                    </div>
                    <span className="text-sm font-semibold text-gray-800">Itinéraire</span>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">A</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400">Point de départ</p>
                        <p className="text-sm font-medium text-gray-800">{mission.pickupAddress}</p>
                        {mission.pickupDate && (
                          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {safeFormat(mission.pickupDate, "dd/MM/yyyy 'à' HH:mm")}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="ml-4 border-l-2 border-dashed border-gray-200 h-6" />
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-success rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0">B</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400">Destination</p>
                        <p className="text-sm font-medium text-gray-800">{mission.deliveryAddress}</p>
                        {mission.deliveryDate && (
                          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {safeFormat(mission.deliveryDate, "dd/MM/yyyy 'à' HH:mm")}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                  {(mission.estimatedDistance || mission.actualDistance) && (
                    <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
                      {mission.estimatedDistance && (
                        <div>
                          <p className="text-xs text-gray-400">Distance estimée</p>
                          <p className="text-sm font-bold text-gray-800">{mission.estimatedDistance} km</p>
                        </div>
                      )}
                      {mission.actualDistance && (
                        <div>
                          <p className="text-xs text-gray-400">Distance réelle</p>
                          <p className="text-sm font-bold text-gray-800">{mission.actualDistance} km</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Cargo + Budgets (colonne gauche, pour réduire la hauteur et aligner visuellement avec Suivi d'exécution) */}
              {(hasCargoCard || showMissionCostCard) && (
                <div className={`grid grid-cols-1 ${hasCargoCard && showMissionCostCard ? "xl:grid-cols-2" : ""} gap-4 items-stretch`}>
                  {hasCargoCard && (
                    <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
                      <div className="h-0.5 bg-gradient-to-r from-success to-success" />
                      <div className="px-5 py-4">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
                            <Package className="h-3.5 w-3.5 text-orange-500" />
                          </div>
                          <span className="text-sm font-semibold text-gray-800">Détails Cargo</span>
                        </div>
                        {mission.cargo?.description && (
                          <div className="mb-3">
                            <p className="text-xs text-gray-400 mb-0.5">Description</p>
                            <p className="text-sm text-gray-700">{mission.cargo.description}</p>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                          {mission.weight && (
                            <div>
                              <p className="text-xs text-gray-400 mb-0.5">Poids</p>
                              <p className="text-sm font-bold text-gray-800">{mission.weight} T</p>
                            </div>
                          )}
                          {mission.volume && (
                            <div>
                              <p className="text-xs text-gray-400 mb-0.5">Volume</p>
                              <p className="text-sm font-bold text-gray-800">{mission.volume} m³</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {showMissionCostCard && (
                    <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
                      <div className="h-0.5 bg-gradient-to-r from-success to-success" />
                      <div className="px-5 py-4">
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-7 h-7 rounded-lg bg-success/10 flex items-center justify-center">
                            <Wallet className="h-3.5 w-3.5 text-success" />
                          </div>
                          <span className="text-sm font-semibold text-gray-800">{financeEnabled ? "Budget planifié (historique)" : "Budgets mission"}</span>
                        </div>
                        <div className="space-y-1.5">
                          {missionBudgetValues.fuelBudget !== null && (
                            <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                              <span className="text-xs text-gray-400">Budget carburant</span>
                              <span className="text-sm font-medium text-gray-700">{formatPrice(missionBudgetValues.fuelBudget)}</span>
                            </div>
                          )}
                          {missionBudgetValues.roadExpensesBudget !== null && (
                            <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                              <span className="text-xs text-gray-400">Budget frais de route (FDR)</span>
                              <span className="text-sm font-medium text-gray-700">{formatPrice(missionBudgetValues.roadExpensesBudget)}</span>
                            </div>
                          )}
                          {missionBudgetValues.contingencyBudget !== null && (
                            <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                              <span className="text-xs text-gray-400">Budget imprévus</span>
                              <span className="text-sm font-medium text-gray-700">{formatPrice(missionBudgetValues.contingencyBudget)}</span>
                            </div>
                          )}
                          {hasAnyMissionBudget && (
                            <div className="flex justify-between items-center py-1.5 border-b border-gray-50">
                              <span className="text-xs font-semibold text-gray-500">Budget total planifié</span>
                              <span className="text-sm font-semibold text-gray-800">{formatPrice(missionBudgetTotal)}</span>
                            </div>
                          )}
                          {mission.actualFuelCost && (
                            <div className="flex justify-between items-center py-1.5">
                              <span className="text-xs text-gray-400">Carburant réel</span>
                              <span className="text-sm font-bold text-success">{formatPrice(mission.actualFuelCost)}</span>
                            </div>
                          )}
                          {missionActualFdrCost !== null && (
                            <div className="flex justify-between items-center py-1.5 border-t border-gray-50">
                              <span className="text-xs text-gray-400">FDR réels (clôture)</span>
                              <span className="text-sm font-bold text-success">{formatPrice(missionActualFdrCost)}</span>
                            </div>
                          )}
                          {mission.actualFuelQuantity && (
                            <div className="flex justify-between items-center text-xs text-gray-400">
                              <span>Quantité consommée</span>
                              <span>{mission.actualFuelQuantity} L</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Suivi d'exécution ── */}
            <div className="flex flex-col">
              {(() => {
                const startedAt = mission.assignment?.startedAt;
                const pickupDate = mission.pickupDate;
                const hasRenewalRequests = Array.isArray(renewalRequests) && renewalRequests.length > 0;
                const readinessChecks = Array.isArray(launchReadiness?.checks) ? launchReadiness.checks : [];
                const hasChecklist = readinessChecks.length > 0;
                const documentChecks = readinessChecks.filter((check: any) => String(check.key || "").startsWith("doc_"));
                const documentsAreAllValid = documentChecks.length > 0 && documentChecks.every((check: any) => !!check.passed);
                const launchReadinessErrorMessage =
                  launchReadinessError instanceof Error
                    ? launchReadinessError.message
                    : "Chargement checklist impossible.";
                const resolveReadinessStatus = (check: any): "passed" | "warning" | "failed" => {
                  if (check?.status === "warning") return "warning";
                  const noFuelBudgetEstimated =
                    ["fuel_budget", "budget_fuel"].includes(String(check?.key || "")) &&
                    /pas de budget carburant estim[eé]/i.test(String(check?.detail || ""));
                  if (noFuelBudgetEstimated) return "warning";
                  return check?.passed ? "passed" : "failed";
                };
                const readinessWarningsCount = readinessChecks.filter(
                  (check: any) => resolveReadinessStatus(check) === "warning",
                ).length;

                // Departure delay
                let departureDelayEl: React.ReactNode = null;

                // Case 1: mission not yet started but pickupDate is in the past → "late to depart"
                if (!startedAt && pickupDate && ["planned", "assigned"].includes(mission.status)) {
                  const delayMin = differenceInMinutes(new Date(), new Date(pickupDate));
                  if (delayMin > 0) {
                    const days = Math.floor(delayMin / 1440);
                    const hours = Math.floor((delayMin % 1440) / 60);
                    const mins = delayMin % 60;
                    const parts = [
                      days > 0 ? `${days} j` : "",
                      hours > 0 ? `${hours} h` : "",
                      mins > 0 ? `${mins} min` : "",
                    ].filter(Boolean).join(" ");
                    departureDelayEl = (
                      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                        <AlertTriangle className="h-4 w-4 text-destructive-text shrink-0 mt-0.5" />
                        <div>
                          <p className="text-[11px] font-bold text-destructive-text uppercase tracking-widest">En retard au départ</p>
                          <p className="text-sm font-semibold text-destructive-text">{parts} de retard</p>
                          <p className="text-[11px] text-destructive-text mt-0.5">
                            Départ prévu le {format(new Date(pickupDate), "dd/MM/yyyy 'à' HH:mm", { locale: fr })} — mission non encore lancée
                          </p>
                        </div>
                      </div>
                    );
                  }
                }

                // Case 2: mission started, compute actual departure delay vs planned
                if (startedAt && pickupDate) {
                  const plannedMs = new Date(pickupDate).getTime();
                  const actualMs = new Date(startedAt).getTime();
                  const delayMin = differenceInMinutes(new Date(startedAt), new Date(pickupDate));
                  if (!isNaN(plannedMs) && !isNaN(actualMs)) {
                    if (delayMin > 0) {
                      const days = Math.floor(delayMin / 1440);
                      const hours = Math.floor((delayMin % 1440) / 60);
                      const mins = delayMin % 60;
                      const parts = [
                        days > 0 ? `${days} j` : "",
                        hours > 0 ? `${hours} h` : "",
                        mins > 0 ? `${mins} min` : "",
                      ].filter(Boolean).join(" ");
                      departureDelayEl = (
                        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
                          <AlertTriangle className="h-4 w-4 text-destructive-text shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[11px] font-bold text-destructive-text uppercase tracking-widest">Départ en retard</p>
                            <p className="text-sm font-semibold text-destructive-text">{parts}</p>
                            <p className="text-[11px] text-destructive-text mt-0.5">
                              Prévu {format(new Date(pickupDate), "dd/MM/yyyy 'à' HH:mm", { locale: fr })} · Parti {format(new Date(startedAt), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
                            </p>
                          </div>
                        </div>
                      );
                    } else {
                      departureDelayEl = (
                        <div className="flex items-center gap-2.5 p-3 rounded-xl bg-success/10 border border-success/20">
                          <Clock className="h-4 w-4 text-success shrink-0" />
                          <div>
                            <p className="text-[11px] font-bold text-success uppercase tracking-widest">Départ à l'heure</p>
                            <p className="text-[11px] text-success mt-0.5">
                              {format(new Date(startedAt), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
                            </p>
                          </div>
                        </div>
                      );
                    }
                  }
                }

                if (!departureDelayEl && !hasRenewalRequests && !hasChecklist) return null;

                return (
                  <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden flex-1">
                    <div className="h-0.5 bg-gradient-to-r from-orange-400 to-warning" />
                    <div className="px-5 py-4">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
                          <Clock className="h-3.5 w-3.5 text-orange-500" />
                        </div>
                        <span className="text-sm font-semibold text-gray-800">Suivi d'exécution</span>
                      </div>
                      <div className="space-y-2.5">
                        {hasChecklist ? (
                          <div className="space-y-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Checklist de lancement</p>
                            <div className="grid grid-cols-3 gap-1.5">
                              {readinessChecks.map((check: any) => {
                                const status = resolveReadinessStatus(check);
                                const passed = status === "passed";
                                const warning = status === "warning";
                                return (
                                  <div
                                    key={check.key}
                                    className={`rounded-xl border px-2.5 py-2 ${
                                      passed
                                        ? "bg-success/10 border-success/20"
                                        : warning
                                          ? "bg-warning/10 border-warning/20"
                                          : "bg-destructive/10 border-destructive/20"
                                    }`}
                                  >
                                    <div className="flex items-start gap-1.5">
                                      {passed ? (
                                        <CheckCircle2 className="h-3.5 w-3.5 text-success mt-0.5 shrink-0" />
                                      ) : warning ? (
                                        <AlertTriangle className="h-3.5 w-3.5 text-warning-text mt-0.5 shrink-0" />
                                      ) : (
                                        <XCircle className="h-3.5 w-3.5 text-destructive-text mt-0.5 shrink-0" />
                                      )}
                                      <div className="min-w-0">
                                        <p
                                          className={`text-[11px] font-semibold leading-tight ${
                                            passed
                                              ? "text-success"
                                              : warning
                                                ? "text-warning-text"
                                                : "text-destructive-text"
                                          }`}
                                        >
                                          {check.label}
                                        </p>
                                        {check.detail && (
                                          <p
                                            className={`text-[10px] mt-0.5 leading-tight ${
                                              passed
                                                ? "text-success"
                                                : warning
                                                  ? "text-warning-text"
                                                  : "text-destructive-text"
                                            }`}
                                          >
                                            {check.detail}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                            <div
                              className={`rounded-xl border px-3 py-2.5 ${
                                launchReadiness?.canLaunch
                                  ? "bg-success/10 border-success/20"
                                  : "bg-destructive/10 border-destructive/20"
                              }`}
                            >
                              <p
                                className={`text-[11px] font-semibold ${
                                  launchReadiness?.canLaunch ? "text-success" : "text-destructive-text"
                                }`}
                              >
                                {launchReadiness?.canLaunch
                                  ? (launchReadiness?.summary?.warnings ?? readinessWarningsCount) > 0
                                    ? "Mission prête au lancement (avec points d'attention)."
                                    : "Mission prête au lancement."
                                  : "Mission non prête: corrigez les points en rouge."}
                              </p>
                            </div>
                          </div>
                        ) : isLaunchReadinessLoading ? (
                          <div className="space-y-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Checklist de lancement</p>
                            <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
                              <p className="text-[11px] text-gray-500">Chargement des contrôles mission...</p>
                            </div>
                          </div>
                        ) : isLaunchReadinessError ? (
                          <div className="space-y-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Checklist de lancement</p>
                            <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2.5">
                              <p className="text-[11px] font-semibold text-destructive-text">Checklist non disponible</p>
                              <p className="text-[11px] text-destructive-text mt-0.5 break-words">{launchReadinessErrorMessage}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Checklist de lancement</p>
                            <div className="rounded-xl border border-warning/20 bg-warning/10 px-3 py-2.5">
                              <p className="text-[11px] text-warning-text">Aucun contrôle de lancement disponible pour cette mission.</p>
                            </div>
                          </div>
                        )}
                        {departureDelayEl}
                        {hasRenewalRequests ? (
                          <div className="space-y-2">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Demandes documents en attente</p>
                            {renewalRequests!.map((req: any) => (
                              <div key={req.id} className="flex items-start gap-2.5 p-3 rounded-xl bg-warning/10 border border-warning/20">
                                <FileText className="h-4 w-4 text-warning-text shrink-0 mt-0.5" />
                                <div className="min-w-0">
                                  <p className="text-[12px] font-semibold text-warning-text leading-tight">{req.title}</p>
                                  {req.createdAt && (
                                    <p className="text-[11px] text-warning-text mt-0.5">
                                      Envoyée le {format(new Date(req.createdAt), "dd/MM/yyyy 'à' HH:mm", { locale: fr })}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : documentsAreAllValid ? (
                          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-success/10 border border-success/20">
                            <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                            <div>
                              <p className="text-[12px] font-semibold text-success">Documents véhicule conformes</p>
                              <p className="text-[11px] text-success mt-0.5">Aucune demande documentaire en attente.</p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })()}

            </div>
          </div>
        </TabsContent>

        <TabsContent value="fuel" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
            <div className="rounded-2xl border border-gray-100 bg-card shadow-sm overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-sky-500 to-cyan-400" />
              <div className="p-4">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-gray-400">Litres réels</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{formatFuelQuantity(missionFuelTotalQuantity)}</p>
                <p className="mt-1 text-xs text-gray-500">{missionFuelRecords.length} plein(s) enregistré(s)</p>
              </div>
            </div>

            {/* Consommation: seule tuile technique parmi des tuiles financières.
                Elle répond à « ce camion consomme-t-il normalement ? », pas à
                « combien ça a coûté ». Voir docs/plans/fuel-consumption-performance.md */}
            <div className="rounded-2xl border border-gray-100 bg-card shadow-sm overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-warning to-orange-400" />
              <div className="p-4">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-gray-400">
                  Consommation
                </p>
                <p className={`mt-2 text-2xl font-bold ${missionConsumption === null ? "text-gray-400" : "text-gray-900"}`}>
                  {missionConsumption === null
                    ? "Non calculable"
                    : `${missionConsumption.toFixed(1).replace(".", ",")} L/100 km`}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {missionConsumption === null
                    ? missionDistanceReelle > 0
                      ? "Aucun plein enregistré"
                      : "Kilométrage réel non renseigné"
                    : `${formatFuelQuantity(missionFuelTotalQuantity)} sur ${missionDistanceReelle.toLocaleString("fr-FR")} km`}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-card shadow-sm overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-success to-success" />
              <div className="p-4">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-gray-400">Coût réel</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{formatPrice(missionFuelTotalCost)}</p>
                <p className="mt-1 text-xs text-gray-500">Débits carte carburant</p>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-card shadow-sm overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-violet-500 to-purple-400" />
              <div className="p-4">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-gray-400">Budget estimé</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">
                  {budgetAmountText(missionBudgetValues.fuelBudget)}
                </p>
                <p className="mt-1 text-xs text-gray-500">Prévision carburant mission</p>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-card shadow-sm overflow-hidden">
              <div className={`h-0.5 ${missionFuelDelta === null ? "bg-gradient-to-r from-gray-300 to-gray-200" : missionFuelDelta >= 0 ? "bg-gradient-to-r from-success to-lime-400" : "bg-gradient-to-r from-destructive to-rose-400"}`} />
              <div className="p-4">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-gray-400">Delta budget</p>
                <p className={`mt-2 text-2xl font-bold ${missionFuelDelta === null ? "text-gray-500" : missionFuelDelta >= 0 ? "text-success" : "text-destructive-text"}`}>
                  {missionFuelDelta === null ? "—" : `${missionFuelDelta >= 0 ? "+" : "-"}${formatPrice(Math.abs(missionFuelDelta))}`}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {missionFuelDelta === null ? "Budget carburant absent" : missionFuelDelta >= 0 ? "Sous le budget" : "Dépassement"}
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-card shadow-sm overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-warning to-orange-400" />
              <div className="p-4">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-gray-400">Prix suggéré</p>
                <p className="mt-2 text-2xl font-bold text-gray-900">{fuelUnitPriceSuggestion}</p>
                <p className="mt-1 text-xs text-gray-500">Référence de saisie</p>
              </div>
            </div>
          </div>

          {isMissionFuelError ? (
            <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3">
              <p className="text-sm font-semibold text-destructive-text">Chargement carburant impossible</p>
              <p className="text-xs text-destructive-text mt-1">
                {missionFuelError instanceof Error ? missionFuelError.message : "Erreur inconnue"}
              </p>
            </div>
          ) : null}

          {!isMissionFuelLoading && missionFuelRecords.length === 0 && !["draft", "cancelled"].includes(String(mission.status || "")) ? (
            missionNoRefuelDeclaration ? (
              <div className="rounded-2xl border border-success/30 bg-success/10 px-4 py-3.5 flex items-start gap-3">
                <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-success">Mission déclarée sans ravitaillement</p>
                  <p className="text-xs text-success mt-1">
                    Motif: {missionNoRefuelDeclaration.reason}
                  </p>
                  <p className="text-xs text-success mt-0.5">
                    Déclarée le {safeFormat(missionNoRefuelDeclaration.declaredAt, "dd/MM/yyyy HH:mm")}
                    {missionNoRefuelDeclaration.declaredRole ? ` · ${missionNoRefuelDeclaration.declaredRole}` : ""}
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3.5 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 text-warning-text mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-warning-text">Aucun plein enregistré pour cette mission</p>
                  <p className="text-xs text-warning-text mt-1">
                    Le budget reste prévisionnel tant qu’aucune transaction carte carburant n’est reliée à la mission.
                  </p>
                </div>
              </div>
            )
          ) : null}

          <PremiumDataTable
            columns={missionFuelTableColumns}
            rows={missionFuelRecords}
            rowKey={(row) => row.id}
            toolbar={(
              <div className="flex items-center justify-between gap-3 w-full">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Pleins mission</h3>
                  <p className="text-sm text-gray-500">Historique réel des débits carburant liés à cette mission.</p>
                </div>
                {canManageMissionFuel ? (
                  <div className="flex items-center gap-2">
                    {canDeclareMissionWithoutFuel ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 px-4 gap-2 border-warning/40 text-warning-text hover:bg-warning/10"
                        onClick={() => setOpenNoFuelConfirm(true)}
                        data-testid="button-declare-no-fuel"
                      >
                        <XCircle className="h-4 w-4" />
                        Déclarer sans plein
                      </Button>
                    ) : null}
                    <Button
                      className="h-10 px-4 gap-2 bg-success hover:brightness-90 text-white"
                      onClick={openMissionFuelDialog}
                      disabled={!mission.assignment?.vehicle?.id}
                      title={!mission.assignment?.vehicle?.id ? "Affectez un véhicule avant d'ajouter un plein." : undefined}
                      data-testid="button-add-mission-fuel"
                    >
                      <Plus className="h-4 w-4" />
                      {canRegularizeMissionFuel ? "Régulariser un plein" : "Ajouter un plein"}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
            emptyState={isMissionFuelLoading ? "Chargement des pleins..." : "Aucun plein enregistré pour cette mission."}
          />
        </TabsContent>

        <TabsContent value="invoices">
          <div className="mb-3 flex items-center justify-end">
            <Button
              size="sm"
              className="h-8 px-3 text-xs gap-1.5 bg-success hover:brightness-90 text-white"
              onClick={() => setOpenInvoiceDialog(true)}
              disabled={!canGenerateClientInvoice}
              title={canGenerateClientInvoice ? "Créer une facture client pour cette mission" : "Disponible une fois la mission livrée"}
              data-testid="button-open-generate-invoice-dialog-tab"
            >
              <FileText className="h-3.5 w-3.5" />
              Générer facture
            </Button>
          </div>
          <MissionInvoicesTab missionId={mission.id} />
        </TabsContent>

        {showBudgetTab && (
          <TabsContent value="budget" className="mt-4">
            <MissionBudgetPanel missionId={mission.id} missionStatus={mission.status} role={user?.role} />
          </TabsContent>
        )}

        <TabsContent value="print">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-card overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-success to-success" />
            <div className="p-5 md:p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-gray-800">Feuille de route</h3>
                  <p className="text-sm text-gray-500">Format opérationnel prêt à imprimer ou exporter en PDF.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => openRoadSheetPrint(false)}
                    data-testid="button-open-road-sheet-preview"
                  >
                    <FileText className="h-4 w-4" />
                    Ouvrir la version imprimable
                  </Button>
                  <Button
                    className="gap-2 bg-success hover:brightness-90 text-white"
                    onClick={() => openRoadSheetPrint(true)}
                    data-testid="button-print-road-sheet"
                  >
                    <Printer className="h-4 w-4" />
                    Imprimer / PDF
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 md:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider font-semibold text-success">Aperçu document</p>
                    <p className="text-base font-bold text-gray-900">{mission.orderNumber}</p>
                    <p className="text-xs text-gray-500">{mission.client?.name || "Client non spécifié"}</p>
                  </div>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[mission.status] || "bg-gray-100 text-gray-700"}`}>
                    {STATUS_LABELS[mission.status] || mission.status}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-lg border border-gray-100 bg-card p-3">
                    <p className="text-[11px] text-gray-500">Départ prévu</p>
                    <p className="text-sm font-semibold text-gray-900">{safeFormat(mission.pickupDate, "dd/MM/yyyy HH:mm")}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-card p-3">
                    <p className="text-[11px] text-gray-500">Livraison prévue</p>
                    <p className="text-sm font-semibold text-gray-900">{safeFormat(mission.deliveryDate, "dd/MM/yyyy HH:mm")}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-card p-3">
                    <p className="text-[11px] text-gray-500">Véhicule</p>
                    <p className="text-sm font-semibold text-gray-900">{missionVehicleLabel}</p>
                  </div>
                  <div className="rounded-lg border border-gray-100 bg-card p-3">
                    <p className="text-[11px] text-gray-500">Chauffeur</p>
                    <p className="text-sm font-semibold text-gray-900">{missionDriverName}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-dashed border-gray-200 bg-card p-3 text-xs text-gray-600">
                  Ce document inclut: itinéraire, ressources, budgets, checklist de lancement et zones de signature.
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={openCloseMissionDialog}
        onOpenChange={(open) => {
          setOpenCloseMissionDialog(open);
          if (!open) {
            setCloseMissionFdrInput("");
          }
        }}
      >
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Clôturer la mission — FDR réels</DialogTitle>
            <DialogDescription>
              Saisissez le montant HT réel des frais de route (péages, rations, escortes…). Indiquez 0
              s&apos;il n&apos;y en a pas eu. Le budget prévisionnel ne remplace pas cette mesure.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {missionBudgetValues.roadExpensesBudget !== null ? (
              <p className="text-xs text-muted-foreground">
                Budget FDR prévisionnel : {formatPrice(missionBudgetValues.roadExpensesBudget)} (référence
                uniquement)
              </p>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="mission-close-fdr">FDR réels HT (FCFA)</Label>
              <Input
                id="mission-close-fdr"
                inputMode="numeric"
                placeholder="0"
                value={closeMissionFdrInput}
                onChange={(e) => setCloseMissionFdrInput(e.target.value)}
                data-testid="input-mission-close-fdr"
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpenCloseMissionDialog(false);
                setCloseMissionFdrInput("");
              }}
              disabled={updateMissionStatusMutation.isPending}
            >
              Annuler
            </Button>
            <Button
              type="button"
              className="bg-success hover:brightness-90 text-white"
              onClick={submitMissionClosure}
              disabled={updateMissionStatusMutation.isPending}
              data-testid="button-confirm-mission-close-fdr"
            >
              {updateMissionStatusMutation.isPending ? "Clôture..." : "Clôturer la mission"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openNoFuelConfirm}
        onOpenChange={(open) => {
          setOpenNoFuelConfirm(open);
          if (!open) {
            setNoFuelDeclarationReason("");
          }
        }}
      >
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Clôture sans plein</DialogTitle>
            <DialogDescription>
              Aucun ravitaillement n'est rattaché à cette mission. Saisissez le motif pour tracer une mission terminée sans plein.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
              <p className="text-xs text-warning-text">
                Option 1: déclarer mission sans plein (motif obligatoire).
              </p>
              <p className="text-xs text-warning-text mt-1">
                Option 2: régulariser immédiatement un plein oublié.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mission-no-fuel-reason">Motif *</Label>
              <Textarea
                id="mission-no-fuel-reason"
                rows={3}
                placeholder="Ex: Mission courte interne, aucun ravitaillement nécessaire."
                value={noFuelDeclarationReason}
                onChange={(e) => setNoFuelDeclarationReason(e.target.value)}
                data-testid="textarea-mission-no-fuel-reason"
              />
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpenNoFuelConfirm(false);
                setNoFuelDeclarationReason("");
              }}
              disabled={declareMissionNoFuelMutation.isPending || updateMissionStatusMutation.isPending}
            >
              Retour
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-blue-200 text-blue-700 hover:bg-blue-50"
              onClick={() => {
                setFuelDialogMode("regularization");
                setOpenNoFuelConfirm(false);
                setNoFuelDeclarationReason("");
                setOpenFuelDialog(true);
              }}
              disabled={declareMissionNoFuelMutation.isPending || updateMissionStatusMutation.isPending}
            >
              Régulariser un plein
            </Button>
            <Button
              type="button"
              className="bg-success hover:brightness-90 text-white"
              onClick={() =>
                declareMissionNoFuelMutation.mutate({
                  closeAfterDeclaration: shouldCloseMissionAfterNoFuelDeclaration,
                })
              }
              disabled={declareMissionNoFuelMutation.isPending || updateMissionStatusMutation.isPending}
              data-testid="button-declare-no-fuel-and-close"
            >
              {declareMissionNoFuelMutation.isPending
                ? "Enregistrement..."
                : shouldCloseMissionAfterNoFuelDeclaration
                  ? "Déclarer sans plein et clôturer"
                  : "Enregistrer la déclaration"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openFuelDialog}
        onOpenChange={(open) => {
          setOpenFuelDialog(open);
          if (!open) {
            fuelSubmissionKeys.discard();
            setFuelDialogMode("standard");
            setFuelRegularizationReason("");
          }
        }}
      >
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{fuelDialogMode === "regularization" ? "Régulariser un plein mission" : "Ajouter un plein mission"}</DialogTitle>
            <DialogDescription>
              {fuelDialogMode === "regularization"
                ? "Renseignez un plein oublié après livraison/clôture. Le motif de régularisation est obligatoire."
                : "Enregistrez un débit carburant réel pour cette mission. Ces données alimentent le coût réel et le contrôle du budget."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-widest font-semibold text-success">Mission ciblée</p>
                  <p className="mt-1 text-base font-bold text-success">{mission.orderNumber}</p>
                  <p className="text-sm text-success">
                    {mission.assignment?.vehicle?.registrationNumber || "Véhicule non affecté"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-widest font-semibold text-success">Budget carburant</p>
                  <p className="mt-1 text-base font-bold text-success">
                    {budgetAmountText(missionBudgetValues.fuelBudget)}
                  </p>
                  <p className="text-xs text-success">{fuelUnitPriceSuggestion}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mission-fuel-quantity">Quantité (L)</Label>
                <Input
                  id="mission-fuel-quantity"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex: 85"
                  value={fuelForm.quantity}
                  onChange={(e) => setFuelForm((prev) => ({ ...prev, quantity: e.target.value }))}
                  data-testid="input-mission-fuel-quantity"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mission-fuel-unit-price">Prix par litre (FCFA)</Label>
                <Input
                  id="mission-fuel-unit-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex: 828"
                  value={fuelFormUnitPrice}
                  readOnly={!canEditFuelPrice}
                  onChange={(e) => canEditFuelPrice && setFuelForm((prev) => ({ ...prev, unitPrice: e.target.value }))}
                  data-testid="input-mission-fuel-unit-price"
                />
                {!canEditFuelPrice && (
                  <p className="text-xs text-muted-foreground">Prix du jour, fixé par la logistique.</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="mission-fuel-datetime">Date et heure du plein</Label>
                <Input
                  id="mission-fuel-datetime"
                  type="datetime-local"
                  value={fuelForm.dateTime}
                  onChange={(e) => setFuelForm((prev) => ({ ...prev, dateTime: e.target.value }))}
                  data-testid="input-mission-fuel-datetime"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mission-fuel-station">Station</Label>
                <Input
                  id="mission-fuel-station"
                  placeholder="Ex: Total Bonabéri"
                  value={fuelForm.stationName}
                  onChange={(e) => setFuelForm((prev) => ({ ...prev, stationName: e.target.value }))}
                  data-testid="input-mission-fuel-station"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mission-fuel-notes">Notes</Label>
              <Textarea
                id="mission-fuel-notes"
                rows={3}
                placeholder="Informations utiles: motif du plein, contexte, ticket, anomalie..."
                value={fuelForm.notes}
                onChange={(e) => setFuelForm((prev) => ({ ...prev, notes: e.target.value }))}
                data-testid="textarea-mission-fuel-notes"
              />
            </div>

            {fuelDialogMode === "regularization" && (
              <div className="space-y-2">
                <Label htmlFor="mission-fuel-regularization-reason">Motif de régularisation *</Label>
                <Textarea
                  id="mission-fuel-regularization-reason"
                  rows={3}
                  placeholder="Ex: Ticket carburant retrouvé après clôture de mission."
                  value={fuelRegularizationReason}
                  onChange={(e) => setFuelRegularizationReason(e.target.value)}
                  data-testid="textarea-mission-fuel-regularization-reason"
                />
              </div>
            )}

            <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="mission-fuel-predeparture"
                  checked={fuelForm.isPreDeparture}
                  onCheckedChange={(checked) =>
                    setFuelForm((prev) => ({ ...prev, isPreDeparture: Boolean(checked) }))
                  }
                  data-testid="checkbox-mission-fuel-predeparture"
                />
                <div>
                  <Label htmlFor="mission-fuel-predeparture" className="text-sm font-semibold text-gray-800 cursor-pointer">
                    Plein pré-départ
                  </Label>
                  <p className="text-xs text-gray-500 mt-1">
                    Cochez si ce plein a été effectué avant le lancement effectif de la mission.
                  </p>
                </div>
              </div>

              <div className="md:text-right">
                <p className="text-[11px] uppercase tracking-widest font-semibold text-gray-400">Coût estimé</p>
                <p className="mt-1 text-lg font-bold text-gray-900">
                  {formatPrice(
                    toNumberOrZero(String(fuelForm.quantity).replace(",", ".")) *
                    toNumberOrZero(String(fuelFormUnitPrice).replace(",", "."))
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                fuelSubmissionKeys.discard();
                setOpenFuelDialog(false);
                setFuelDialogMode("standard");
                setFuelRegularizationReason("");
              }}
              disabled={addMissionFuelMutation.isPending}
            >
              Annuler
            </Button>
            <Button
              onClick={() => submitMissionFuel()}
              disabled={addMissionFuelMutation.isPending || fuelPriceLoading}
              className="bg-success hover:brightness-90 text-white"
              data-testid="button-save-mission-fuel"
            >
              {addMissionFuelMutation.isPending
                ? "Enregistrement..."
                : fuelDialogMode === "regularization"
                  ? "Régulariser le plein"
                  : "Ajouter le plein"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Modifier la mission ── */}
      <Dialog open={openEditDialog} onOpenChange={setOpenEditDialog}>
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Modifier la mission</DialogTitle>
            <DialogDescription>
              Corrigez les informations de mission, d'itinéraire et d'affectation.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-2">
              <Label>N° Commande / BL</Label>
              <Input
                value={editForm.orderNumber}
                onChange={(e) => setEditForm((prev) => ({ ...prev, orderNumber: e.target.value }))}
                data-testid="input-edit-order-number"
              />
            </div>
            <div className="space-y-2">
              <Label>Type mission</Label>
              <select
                value={editForm.missionType}
                onChange={(e) => setEditForm((prev) => ({ ...prev, missionType: e.target.value }))}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-edit-mission-type"
              >
                <option value="delivery">Livraison</option>
                <option value="pickup">Récupération</option>
                <option value="round_trip">Aller-Retour</option>
                <option value="other">Autre</option>
              </select>
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label>Adresse de départ</Label>
              <Input
                value={editForm.pickupAddress}
                onChange={(e) => setEditForm((prev) => ({ ...prev, pickupAddress: e.target.value }))}
                data-testid="input-edit-pickup-address"
              />
            </div>
            <div className="space-y-2">
              <Label>Date départ</Label>
              <Input
                type="date"
                value={editForm.pickupDate}
                onChange={(e) => setEditForm((prev) => ({ ...prev, pickupDate: e.target.value }))}
                data-testid="input-edit-pickup-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Heure départ</Label>
              <Input
                type="time"
                value={editForm.pickupTime}
                onChange={(e) => setEditForm((prev) => ({ ...prev, pickupTime: e.target.value }))}
                data-testid="input-edit-pickup-time"
              />
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label>Adresse livraison</Label>
              <Input
                value={editForm.deliveryAddress}
                onChange={(e) => setEditForm((prev) => ({ ...prev, deliveryAddress: e.target.value }))}
                data-testid="input-edit-delivery-address"
              />
            </div>
            <div className="space-y-2">
              <Label>Date livraison</Label>
              <Input
                type="date"
                value={editForm.deliveryDate}
                onChange={(e) => setEditForm((prev) => ({ ...prev, deliveryDate: e.target.value }))}
                data-testid="input-edit-delivery-date"
              />
            </div>
            <div className="space-y-2">
              <Label>Heure livraison</Label>
              <Input
                type="time"
                value={editForm.deliveryTime}
                onChange={(e) => setEditForm((prev) => ({ ...prev, deliveryTime: e.target.value }))}
                data-testid="input-edit-delivery-time"
              />
            </div>

            <div className="space-y-2">
              <Label>Poids (T)</Label>
              <Input
                type="number"
                step="0.1"
                value={editForm.weight}
                onChange={(e) => setEditForm((prev) => ({ ...prev, weight: e.target.value }))}
                data-testid="input-edit-weight"
              />
            </div>
            <div className="space-y-2">
              <Label>Volume (m³)</Label>
              <Input
                type="number"
                step="0.1"
                value={editForm.volume}
                onChange={(e) => setEditForm((prev) => ({ ...prev, volume: e.target.value }))}
                data-testid="input-edit-volume"
              />
            </div>
            <div className="space-y-2">
              <Label>Distance estimée (km)</Label>
              <Input
                type="number"
                value={editForm.estimatedDistance}
                onChange={(e) => setEditForm((prev) => ({ ...prev, estimatedDistance: e.target.value }))}
                data-testid="input-edit-distance"
              />
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label>Description cargo</Label>
              <Textarea
                value={editForm.cargoDescription}
                onChange={(e) => setEditForm((prev) => ({ ...prev, cargoDescription: e.target.value }))}
                rows={2}
                data-testid="textarea-edit-cargo"
              />
            </div>

            <div className="space-y-2">
              <Label>Véhicule</Label>
              <select
                value={editForm.vehicleId}
                onChange={(e) => setEditForm((prev) => ({ ...prev, vehicleId: e.target.value }))}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-edit-vehicle"
              >
                <option value="">Non assigné</option>
                {(availableVehicles || []).map((vehicle: any) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.registrationNumber} - {vehicle.brand} {vehicle.model}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Chauffeur</Label>
              <select
                value={editForm.driverId}
                onChange={(e) => setEditForm((prev) => ({ ...prev, driverId: e.target.value }))}
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-edit-driver"
              >
                <option value="">Non assigné</option>
                {(activeDrivers || []).map((driver: any) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.firstName} {driver.lastName} ({driver.employeeNumber})
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label>Instructions spéciales</Label>
              <Textarea
                value={editForm.specialInstructions}
                onChange={(e) => setEditForm((prev) => ({ ...prev, specialInstructions: e.target.value }))}
                rows={3}
                data-testid="textarea-edit-special-instructions"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setOpenEditDialog(false)}
              disabled={updateMissionMutation.isPending}
            >
              Annuler
            </Button>
            <Button
              onClick={() => updateMissionMutation.mutate()}
              disabled={updateMissionMutation.isPending}
              data-testid="button-save-mission"
            >
              {updateMissionMutation.isPending ? "Enregistrement..." : "Enregistrer les modifications"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Générer facture client ── */}
      <Dialog open={openInvoiceDialog} onOpenChange={setOpenInvoiceDialog}>
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Générer Facture Client</DialogTitle>
            <DialogDescription>Créer une facture pour la mission {mission.orderNumber}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Montant HT *</Label>
              <Input id="amount" type="number" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="input-amount" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">Date d'échéance *</Label>
              <Input id="dueDate" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required data-testid="input-due-date" />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox id="includeVAT" checked={includeVAT} onCheckedChange={(checked) => setIncludeVAT(checked as boolean)} data-testid="checkbox-include-vat" />
              <Label htmlFor="includeVAT" className="cursor-pointer">Inclure TVA 19.25%</Label>
            </div>
            {amount && parseFloat(amount) > 0 && (
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-gray-500">Montant HT :</span>
                  <span className="font-medium">{formatPrice(parseFloat(amount))}</span>
                </div>
                {includeVAT && (
                  <>
                    <div className="flex justify-between items-center text-sm mt-1.5">
                      <span className="text-gray-500">TVA 19.25% :</span>
                      <span className="font-medium">{formatPrice(parseFloat(amount) * 0.1925)}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm mt-2 pt-2 border-t border-gray-100">
                      <span className="font-bold">Montant TTC :</span>
                      <span className="font-bold text-success" data-testid="preview-ttc">{formatPrice(calculateTTC())}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpenInvoiceDialog(false)} disabled={generateInvoiceMutation.isPending} data-testid="button-cancel-invoice">
              Annuler
            </Button>
            <Button onClick={handleGenerateInvoice} disabled={generateInvoiceMutation.isPending || !amount || parseFloat(amount) <= 0} data-testid="button-submit-invoice">
              {generateInvoiceMutation.isPending ? "Génération..." : "Générer Facture"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Budgets mission ── */}
      <Dialog
        open={openMissionBudgetDialog}
        onOpenChange={(open) => {
          setOpenMissionBudgetDialog(open);
          if (!open) {
            setBudgetDialogMode("manual");
            setMissingBudgetFields([]);
          }
        }}
      >
        <DialogTrigger asChild><span /></DialogTrigger>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {budgetDialogMode === "launch" ? "Budgets requis avant lancement" : "Budgets mission"}
            </DialogTitle>
            <DialogDescription>
              {launchHint}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {hasMissingBudgetWarning && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-3 py-2.5">
                <p className="text-xs font-semibold text-warning-text">
                  Budgets manquants: {launchMissingBudgetLabels.join(", ")}
                </p>
                {!budgetEntryAllowed && (
                  <p className="mt-1 text-xs text-warning-text" data-testid="text-budget-ask-manager">
                    Demandez à un gestionnaire (administrateur, logistique ou secrétariat) de les saisir.
                  </p>
                )}
              </div>
            )}

            {budgetEntryAllowed && hasBudgetSuggestion && (
              <div className="rounded-xl border border-success/30 bg-success/10 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-success">Suggestion système disponible</p>
                    <p className="text-[11px] text-success">
                      Pré-calcul selon distance, type mission, charge, retard et historique carburant.
                      {suggestionConfidenceLabel ? ` ${suggestionConfidenceLabel}.` : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs border-success/40 text-success hover:bg-success/15"
                    onClick={applyBudgetSuggestionToForm}
                    data-testid="button-apply-budget-suggestion"
                  >
                    Appliquer suggestion
                  </Button>
                </div>
              </div>
            )}

            {budgetEntryAllowed && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {missionBudgetFieldsInDialog.map((field) => (
                <div key={field} className="space-y-2">
                  <Label htmlFor={`mission-budget-${field}`}>{MISSION_BUDGET_LABELS[field]} (FCFA)</Label>
                  <Input
                    id={`mission-budget-${field}`}
                    type="number"
                    min={field === "fuelBudget" ? 1 : 0}
                    step="1"
                    placeholder="Ex: 125000"
                    value={missionBudgetForm[field]}
                    onChange={(e) =>
                      setMissionBudgetForm((prev) => ({
                        ...prev,
                        [field]: e.target.value,
                      }))
                    }
                    data-testid={`input-mission-budget-${field}`}
                  />
                  {missionBudgetValues[field] === null &&
                    missionBudgetSuggestionValues[field] !== null &&
                    Number.isFinite(missionBudgetSuggestionValues[field]) && (
                      <p className="text-[11px] text-success">
                        Suggéré: {formatPrice(Number(missionBudgetSuggestionValues[field] || 0))}
                      </p>
                    )}
                </div>
              ))}
            </div>
            )}

            {budgetEntryAllowed && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-warning-text">
                  Solde carte carburant actuel: {launchFuelBalanceRaw === null || launchFuelBalanceRaw === undefined ? "—" : formatPrice(launchFuelBalance)}
                </p>
                <p className="text-xs text-warning-text">
                  Prix utilisé: <span className="font-semibold">{formatPrice(launchFuelUnitPriceUsed).replace(" FCFA", "")} FCFA/L</span>
                  <span className="ml-1 text-[11px] text-warning-text">
                    ({launchFuelUnitPriceSource === "real" ? "réel" : "référence"})
                  </span>
                </p>
                <p className="text-xs text-warning-text">
                  Prix réel actuel:
                  <span className="font-semibold ml-1">
                    {launchFuelUnitPriceReal !== null
                      ? `${formatPrice(launchFuelUnitPriceReal).replace(" FCFA", "")} FCFA/L`
                      : "indisponible"}
                  </span>
                </p>
                <p className="text-xs text-warning-text">
                  Prix de référence: <span className="font-semibold">{formatPrice(launchFuelUnitPriceFallback).replace(" FCFA", "")} FCFA/L</span>
                </p>
              </div>
            </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="outline"
              onClick={() => setOpenMissionBudgetDialog(false)}
              disabled={saveMissionBudgetsMutation.isPending || updateMissionStatusMutation.isPending}
            >
              {budgetEntryAllowed ? "Annuler" : "Fermer"}
            </Button>
            {budgetEntryAllowed && (
            <Button
              onClick={handleSaveMissionBudgets}
              disabled={saveMissionBudgetsMutation.isPending || updateMissionStatusMutation.isPending}
              data-testid="button-save-mission-budgets"
            >
              {saveMissionBudgetsMutation.isPending ? launchActionPendingLabel : launchActionLabel}
            </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal erreur centralisée */}
      <AlertModal
        open={!!errorModal}
        onOpenChange={(open) => {
          if (!open) {
            setErrorModal(null);
            setLaunchBlockedDocumentTypes([]);
          }
        }}
        variant="error"
        title={errorModal?.title ?? ""}
        description={errorModal?.description}
        details={errorModal?.details}
        confirmLabel={
          launchBlockedDocumentTypes.length > 0
            ? (createDocumentRenewalRequestMutation.isPending
                ? "Création..."
                : "Créer demande de renouvellement")
            : undefined
        }
        onConfirm={
          launchBlockedDocumentTypes.length > 0
            ? () => {
                if (createDocumentRenewalRequestMutation.isPending) return;
                createDocumentRenewalRequestMutation.mutate(launchBlockedDocumentTypes);
              }
            : undefined
        }
      />
    </div>
  );
}
