import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { isApiError, userMessageOf } from "@/lib/api-error";
import { createSubmissionKeyStore, isIndeterminateOutcome, missionFuelKeyScope } from "@/lib/submission-key";
import { driverReportOpensWorkOrder, type DriverReportType } from "@shared/contracts/incidents";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { useAuth } from "@/hooks/useAuth";
import { useFuelPrice } from "@/hooks/use-fuel-price";
import { localDateKey } from "@/lib/fuel-price-policy";
import { useRealTimeSync } from "@/hooks/useRealTimeSync";
import { PodDepositButton } from "@/components/missions/mission-pod-panel";
import { splitDriverMissions } from "@/lib/driver-missions";
import { useMemo, useState } from "react";
import { format, isThisMonth } from "date-fns";
import { fr } from "date-fns/locale";
import {
  Truck,
  MapPin,
  Clock,
  AlertTriangle,
  Navigation,
  CheckCircle2,
  LogOut,
  ChevronRight,
  BarChart2,
  Package,
  Star,
  Calendar,
  Gauge,
  Droplets,
  Fuel,
  X,
  Wrench,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextualHelpButton } from "@/components/help";
import { useToast } from "@/hooks/use-toast";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Driver {
  id: number;
  firstName: string;
  lastName: string;
}

interface Vehicle {
  id: number;
  registrationNumber: string;
  brand: string;
  model: string;
}

interface Assignment {
  id: number;
  driver?: Driver;
  vehicle?: Vehicle;
}

interface Client {
  id: number;
  name: string;
}

interface Mission {
  id: number;
  orderNumber: string;
  status: string;
  pickupAddress: string;
  pickupDate?: string;
  deliveryAddress: string;
  deliveryDate?: string;
  actualDeliveryDate?: string;
  actualDepartureDate?: string;
  estimatedDistance?: number;
  actualDistance?: number;
  specialInstructions?: string;
  // flat fields from /me endpoint
  clientName?: string;
  vehicleRegistration?: string;
  vehicleBrand?: string;
  vehicleModel?: string;
  vehicleId?: number;
  // nested fields (legacy /api/missions shape)
  assignment?: Assignment;
  client?: Client;
}

interface FuelCardBalance {
  balance?: number | string | null;
  averagePricePerLiter?: number | string | null;
  averagePricePerLiterUsed?: number | string | null;
  averagePricePerLiterReal?: number | string | null;
  averagePricePerLiterFallback?: number | string | null;
  priceSource?: string | null;
}

interface DriverMe {
  driver: {
    id: number;
    firstName: string;
    lastName: string;
  };
  missions: Mission[];
}

// ─── Problem types ────────────────────────────────────────────────────────────

const PROBLEM_TYPES: Array<{ id: DriverReportType; label: string; color: string; textColor: string; Icon: typeof Wrench }> = [
  { id: "breakdown", label: "Panne véhicule", color: "bg-destructive", textColor: "text-white", Icon: Wrench },
  { id: "accident", label: "Accident", color: "bg-orange-500", textColor: "text-white", Icon: AlertTriangle },
  { id: "delay", label: "Retard prévu", color: "bg-warning", textColor: "text-gray-900", Icon: Clock },
  { id: "other", label: "Autre", color: "bg-gray-600", textColor: "text-white", Icon: MessageSquare },
];

type BreakdownSeverity = "low" | "medium" | "high";

const SEVERITY_OPTIONS: Array<{ id: BreakdownSeverity; label: string }> = [
  { id: "low", label: "Faible" },
  { id: "medium", label: "Moyenne" },
  { id: "high", label: "Élevée" },
];

const MIN_DESCRIPTION_LENGTH = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(dateStr?: string) {
  if (!dateStr) return "—";
  try { return format(new Date(dateStr), "HH:mm", { locale: fr }); } catch { return "—"; }
}

function formatDateShort(dateStr?: string) {
  if (!dateStr) return "—";
  try { return format(new Date(dateStr), "dd MMM yyyy", { locale: fr }); } catch { return "—"; }
}

function mapsUrl(address: string) {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
}

function formatPrice(value?: number | string | null) {
  const amount = typeof value === "string" ? Number.parseFloat(value) : Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0 FCFA";
  return `${Math.round(amount).toLocaleString("fr-FR")} FCFA`;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toDatetimeLocalValue(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

async function parseJsonIfPresent(response: Response): Promise<any> {
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) return null;
  const body = await response.text();
  if (!body) return null;
  return JSON.parse(body);
}

/** Nom lisible : "Mission BOLLORE · 11 mars 2026" */
function missionLabel(mission: Mission): string {
  const client = mission.clientName ?? mission.client?.name;
  const date = mission.pickupDate ? format(new Date(mission.pickupDate), "d MMM yyyy", { locale: fr }) : null;
  if (client && date) return `Mission ${client} · ${date}`;
  if (client) return `Mission ${client}`;
  return `Mission ${mission.orderNumber}`;
}

/**
 * Retard départ : départ réel > départ prévu
 * Retard arrivée : on recalcule l'heure d'arrivée attendue depuis le départ réel
 *   → arrivée_attendue = actualDeparture + (deliveryDate - pickupDate)
 */
function getDelayInfo(mission: Mission): { departLate: boolean; arrivalLate: boolean; recalcArrival: Date | null } {
  const pickupPlanned = mission.pickupDate ? new Date(mission.pickupDate) : null;
  const deliveryPlanned = mission.deliveryDate ? new Date(mission.deliveryDate) : null;
  const actualDep = mission.actualDepartureDate ? new Date(mission.actualDepartureDate) : null;
  const actualArr = mission.actualDeliveryDate ? new Date(mission.actualDeliveryDate) : null;

  const departLate = !!(pickupPlanned && actualDep && actualDep > pickupPlanned);

  let recalcArrival: Date | null = null;
  if (actualDep && pickupPlanned && deliveryPlanned) {
    const plannedDuration = deliveryPlanned.getTime() - pickupPlanned.getTime();
    recalcArrival = new Date(actualDep.getTime() + plannedDuration);
  }

  const arrivalLate = !!(actualArr && recalcArrival && actualArr > recalcArrival);

  return { departLate, arrivalLate, recalcArrival };
}

function isOnTime(mission: Mission): boolean {
  const { departLate, arrivalLate } = getDelayInfo(mission);
  return !departLate && !arrivalLate;
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    assigned:   "bg-purple-100 text-purple-800 border border-purple-200",
    in_progress:"bg-yellow-100 text-yellow-800 border border-yellow-200",
    delivered:  "bg-success/15  text-success  border border-success/30",
    completed:  "bg-success/15  text-success  border border-success/30",
    closed:     "bg-gray-100   text-gray-600   border border-gray-200",
    cancelled:  "bg-destructive/10     text-destructive-text    border border-destructive/30",
    draft:      "bg-gray-100   text-gray-500   border border-gray-200",
    planned:    "bg-blue-50    text-blue-600   border border-blue-200",
  };
  const labels: Record<string, string> = {
    assigned:   "ASSIGNÉE",
    in_progress:"EN COURS",
    delivered:  "LIVRÉE",
    completed:  "TERMINÉE",
    closed:     "CLÔTURÉE",
    cancelled:  "ANNULÉE",
    draft:      "BROUILLON",
    planned:    "PLANIFIÉE",
  };
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide ${styles[status] ?? "bg-gray-100 text-gray-700"}`}>
      {labels[status] ?? status.toUpperCase()}
    </span>
  );
}

// ─── Problem bottom sheet ─────────────────────────────────────────────────────

function ProblemSheet({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState<DriverReportType | null>(null);
  const [otherText, setOtherText] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [severity, setSeverity] = useState<BreakdownSeverity>("medium");
  const vehicleId = mission.vehicleId ?? mission.assignment?.vehicle?.id;

  const reportMutation = useMutation({
    mutationFn: (payload: { type: DriverReportType; vehicleId: number; description: string; severity: BreakdownSeverity }) =>
      apiRequest("POST", "/api/driver/breakdowns", payload),
    onSuccess: (_data, payload) => {
      toast({
        title: "Problème signalé",
        description: driverReportOpensWorkOrder(payload.type)
          ? "Votre signalement a été transmis à l'atelier."
          : "Votre signalement a été transmis au chef d'atelier et à l'administration.",
      });
      // Resync ciblé : OT de l'atelier, incidents, alertes. L'événement temps réel part du serveur.
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      onClose();
    },
    onError: (error: unknown) => {
      toast({
        variant: "destructive",
        title: "Signalement non envoyé",
        description: userMessageOf(error, "Impossible d'envoyer le signalement. Réessayez."),
      });
    },
  });
  const submitReport = useSingleFlightMutate(reportMutation.mutate);

  const handleSubmit = () => {
    if (!selectedId || !vehicleId) return;
    const problem = PROBLEM_TYPES.find((p) => p.id === selectedId);
    const description = selectedId === "other" && otherText.trim() ? otherText.trim() : problem?.label ?? selectedId;
    submitReport({
      type: selectedId,
      vehicleId,
      severity,
      description: `[Mission ${mission.orderNumber}] ${description}`.slice(0, 2000),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-t-3xl shadow-xl p-6 z-10 space-y-4">
        <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-2" />
        <h2 className="text-lg font-bold text-gray-900 text-center">Signaler un problème</h2>
        <p className="text-sm text-gray-500 text-center">Mission {mission.orderNumber}</p>
        <div className="grid grid-cols-2 gap-3 pt-2">
          {PROBLEM_TYPES.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={`flex flex-col items-center justify-center gap-2 rounded-2xl p-4 border-2 transition-all font-semibold text-sm
                ${selectedId === p.id ? `${p.color} ${p.textColor} border-transparent scale-95` : "bg-gray-50 text-gray-700 border-gray-200"}`}
            >
              <p.Icon className="h-6 w-6" aria-hidden="true" />
              {p.label}
            </button>
          ))}
        </div>
        <div className="space-y-2" role="group" aria-label="Gravité">
          <p className="text-sm font-semibold text-gray-700">Gravité</p>
          <div className="grid grid-cols-3 gap-2">
            {SEVERITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={severity === option.id}
                onClick={() => setSeverity(option.id)}
                className={`rounded-xl border-2 py-2 text-sm font-semibold transition-all ${
                  severity === option.id ? "bg-gray-900 text-white border-transparent" : "bg-gray-50 text-gray-700 border-gray-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {selectedId === "other" && (
          <textarea
            className="w-full rounded-xl border border-gray-200 p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-success"
            rows={3}
            placeholder="Décrivez le problème..."
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
          />
        )}
        {!vehicleId && (
          <p className="text-sm text-gray-600" role="note">
            Aucun véhicule n'est affecté à cette mission. Contactez la logistique pour signaler le problème.
          </p>
        )}
        <Button
          onClick={handleSubmit}
          disabled={!selectedId || !vehicleId || reportMutation.isPending || (selectedId === "other" && otherText.trim().length < MIN_DESCRIPTION_LENGTH)}
          className="w-full h-14 rounded-2xl bg-destructive hover:brightness-90 text-white font-bold text-base"
        >
          {reportMutation.isPending ? "Envoi..." : "Envoyer le signalement"}
        </Button>
        <Button variant="ghost" onClick={onClose} className="w-full text-gray-500">Annuler</Button>
      </div>
    </div>
  );
}

function FuelSheet({ mission, onClose }: { mission: Mission; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState("0");
  const [unitPrice, setUnitPrice] = useState("");
  const [stationName, setStationName] = useState("");
  const [dateTime, setDateTime] = useState(toDatetimeLocalValue());
  const [notes, setNotes] = useState("");

  const { data: fuelBalance } = useQuery<FuelCardBalance>({
    queryKey: ["/api/fuel-card/balance"],
    staleTime: 60_000,
  });

  const suggestedPrice =
    toNumber(fuelBalance?.averagePricePerLiterUsed) ??
    toNumber(fuelBalance?.averagePricePerLiterReal) ??
    toNumber(fuelBalance?.averagePricePerLiter) ??
    toNumber(fuelBalance?.averagePricePerLiterFallback) ??
    828;

  const priceSourceLabel =
    fuelBalance?.priceSource === "real" ? "Prix réel récent" : "Prix de référence";

  // Prix du litre : imposé (prix du jour) hors FUEL_PRICE_WRITE_ROLES, donc au chauffeur.
  const { user } = useAuth();
  const { canEdit: canEditFuelPrice, priceAt, isLoading: fuelPriceLoading } = useFuelPrice(user?.role);
  const effectiveUnitPrice = canEditFuelPrice ? unitPrice : String(priceAt(dateTime || localDateKey()));
  const displayedPrice = canEditFuelPrice ? suggestedPrice : Number(effectiveUnitPrice);

  const quantityValue = Number.parseFloat(quantity || "0");
  const unitPriceValue = Number.parseFloat(effectiveUnitPrice || "0");
  const totalCost =
    Number.isFinite(quantityValue) && Number.isFinite(unitPriceValue)
      ? quantityValue * unitPriceValue
      : 0;

  // Clé de ce plein, par mission, en sessionStorage : libérée au succès, sur un 4xx et à
  // l'annulation ; CONSERVÉE sur une issue inconnue (réseau, 5xx), même si la fiche est fermée
  // puis rouverte, pour que le serveur rejoue sans second débit. Deux onglets : deux saisies.
  const fuelSubmissionKeys = useMemo(() => createSubmissionKeyStore(missionFuelKeyScope(mission.id)), [mission.id]);
  const cancel = () => {
    fuelSubmissionKeys.discard();
    onClose();
  };

  const createFuelMutation = useMutation({
    mutationFn: async () => {
      const vehicleId = mission.vehicleId ?? mission.assignment?.vehicle?.id;
      if (!vehicleId) {
        throw new Error("Aucun véhicule n'est rattaché à cette mission.");
      }

      const payload = {
        vehicleId,
        quantity: Number.parseFloat(quantity),
        unitPrice: Number.parseFloat(effectiveUnitPrice),
        stationName: stationName.trim() || undefined,
        date: new Date(dateTime).toISOString(),
        notes: notes.trim() || undefined,
        // Empreinte de la saisie : le jour du plein (le serveur le compare), pas l'heure par défaut,
        // recalculée à chaque ouverture de la fiche.
        requestKey: fuelSubmissionKeys.take({
          day: new Date(dateTime).toISOString().slice(0, 10),
          quantity: Number.parseFloat(quantity),
          unitPrice: Number.parseFloat(effectiveUnitPrice),
          stationName: stationName.trim() || null,
          notes: notes.trim() || null,
        }),
      };

      const response = await apiRequest("POST", `/api/missions/${mission.id}/fuel-records`, payload);
      return parseJsonIfPresent(response);
    },
    onSuccess: () => {
      fuelSubmissionKeys.settle();
      toast({
        title: "Plein enregistré",
        description: "Le carburant de la mission a été ajouté immédiatement.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/me"] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}/fuel-records`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}/launch-readiness`] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/history"] });
      onClose();
    },
    onError: (error: unknown) => {
      // 4xx : clé libérée. Réseau ou 5xx : clé conservée, le prochain envoi sera rejoué.
      fuelSubmissionKeys.settle(error);
      if (isApiError(error, 409) || isIndeterminateOutcome(error)) {
        // Plein peut-être déjà enregistré : relire les pleins et le solde pour le montrer.
        queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}/fuel-records`] });
        queryClient.invalidateQueries({ queryKey: [`/api/missions/${mission.id}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/drivers/me"] });
        queryClient.invalidateQueries({ queryKey: ["/api/fuel-card/balance"] });
      }
      toast({
        variant: "destructive",
        title: "Erreur carburant",
        description: userMessageOf(error, "Impossible d'enregistrer ce plein."),
      });
    },
  });

  // Débit de la carte carburant : un double clic ne doit envoyer qu'une requête.
  const submitFuel = useSingleFlightMutate(createFuelMutation.mutate);

  const isFormInvalid =
    !Number.isFinite(quantityValue) ||
    quantityValue <= 0 ||
    !Number.isFinite(unitPriceValue) ||
    unitPriceValue <= 0 ||
    fuelPriceLoading ||
    !dateTime;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]" onClick={cancel} />
      <div className="relative z-10 rounded-t-[28px] border border-white/70 bg-card px-5 pb-6 pt-4 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-slate-200" />
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-success">Mission active</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">Enregistrer un plein</h2>
            <p className="text-sm text-slate-500">Mission {mission.orderNumber}</p>
          </div>
          <button
            type="button"
            onClick={cancel}
            className="rounded-full border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-success/30 bg-gradient-to-br from-success/10 via-card to-cyan-50 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-success/15 text-success">
              <Fuel className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                {canEditFuelPrice ? priceSourceLabel : "Prix du jour"}
              </p>
              <p className="truncate text-base font-bold text-slate-950">{Math.round(displayedPrice)} FCFA/L</p>
            </div>
            {canEditFuelPrice && (
              <button
                type="button"
                onClick={() => setUnitPrice(String(Math.round(suggestedPrice)))}
                className="ml-auto rounded-xl bg-success px-3 py-2 text-xs font-semibold text-white transition hover:bg-success"
              >
                Utiliser
              </button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Litres</span>
              <input
                type="number"
                min="0.1"
                step="0.01"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-card px-4 text-base font-semibold text-slate-950 outline-none transition focus:border-success focus:ring-2 focus:ring-success/20"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Prix / L</span>
              <input
                type="number"
                min="1"
                step="0.01"
                inputMode="decimal"
                value={effectiveUnitPrice}
                readOnly={!canEditFuelPrice}
                onChange={(e) => canEditFuelPrice && setUnitPrice(e.target.value)}
                className="h-12 w-full rounded-2xl border border-slate-200 bg-card px-4 text-base font-semibold text-slate-950 outline-none transition focus:border-success focus:ring-2 focus:ring-success/20"
              />
            </label>
          </div>

          <div className="rounded-2xl border border-sky-100 bg-sky-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Coût calculé</p>
            <p className="mt-1 text-2xl font-bold text-slate-950">{formatPrice(totalCost)}</p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Station</span>
            <input
              type="text"
              value={stationName}
              onChange={(e) => setStationName(e.target.value)}
              placeholder="Ex: Total Bonabéri"
              className="h-12 w-full rounded-2xl border border-slate-200 bg-card px-4 text-sm text-slate-950 outline-none transition focus:border-success focus:ring-2 focus:ring-success/20"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Date et heure</span>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="h-12 w-full rounded-2xl border border-slate-200 bg-card px-4 text-sm text-slate-950 outline-none transition focus:border-success focus:ring-2 focus:ring-success/20"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">Notes</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Commentaire libre si besoin"
              className="w-full rounded-2xl border border-slate-200 bg-card px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-success focus:ring-2 focus:ring-success/20"
            />
          </label>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={cancel}
            className="h-12 rounded-2xl border-slate-200 text-slate-700"
          >
            Annuler
          </Button>
          <Button
            type="button"
            disabled={isFormInvalid || createFuelMutation.isPending}
            onClick={() => submitFuel()}
            className="h-12 rounded-2xl bg-success text-white hover:bg-success"
          >
            {createFuelMutation.isPending ? "Enregistrement..." : "Valider le plein"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Performance tab ──────────────────────────────────────────────────────────

function PerformanceTab({ missions }: { missions: Mission[] }) {
  const completed = missions.filter((m) => ["delivered", "completed", "closed"].includes(m.status));
  const thisMonth = completed.filter((m) => m.actualDeliveryDate && isThisMonth(new Date(m.actualDeliveryDate)));
  const onTimeCount = completed.filter((m) => isOnTime(m)).length;
  const onTimePct = completed.length > 0 ? Math.round((onTimeCount / completed.length) * 100) : 100;
  const totalKm = completed.reduce((acc, m) => acc + (m.actualDistance ?? m.estimatedDistance ?? 0), 0);

  const kpis = [
    { label: "Missions totales", value: completed.length, icon: <Package className="h-4 w-4" />, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Ce mois-ci", value: thisMonth.length, icon: <Calendar className="h-4 w-4" />, color: "text-success", bg: "bg-success/10" },
    { label: "À l'heure", value: `${onTimePct}%`, icon: <Star className="h-4 w-4" />, color: "text-warning-text", bg: "bg-warning/10" },
    { label: "Km parcourus", value: totalKm > 0 ? `${totalKm.toLocaleString()} km` : "—", icon: <Gauge className="h-4 w-4" />, color: "text-purple-600", bg: "bg-purple-50" },
  ];

  return (
    <div className="space-y-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-2xl bg-card border border-gray-100 shadow-sm p-4 flex flex-col gap-2">
            <div className={`w-8 h-8 rounded-xl ${k.bg} flex items-center justify-center ${k.color}`}>
              {k.icon}
            </div>
            <p className="text-[11px] font-medium text-gray-400 uppercase tracking-widest">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* History list */}
      <div className="rounded-2xl bg-card border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-success/10 flex items-center justify-center">
            <BarChart2 className="h-3.5 w-3.5 text-success" />
          </div>
          <span className="text-sm font-semibold text-gray-800">Historique des missions</span>
        </div>

        {completed.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center px-4">
            <Package className="h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm text-gray-400">Aucune mission terminée pour le moment.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {[...completed].reverse().map((m) => {
              const { departLate, arrivalLate, recalcArrival } = getDelayInfo(m);
              const ontime = !departLate && !arrivalLate;
              return (
                <div key={m.id} className="px-4 py-3.5 flex items-start gap-3">
                  <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${ontime ? "bg-success" : "bg-destructive"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-xs font-semibold text-gray-800">{missionLabel(m)}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {m.actualDeliveryDate ? formatDateShort(m.actualDeliveryDate) : formatDateShort(m.deliveryDate)}
                      {(m.actualDistance ?? m.estimatedDistance) ? ` · ${m.actualDistance ?? m.estimatedDistance} km` : ""}
                      {recalcArrival ? ` · Arrivée estimée ${format(recalcArrival, "HH:mm", { locale: fr })}` : ""}
                    </p>
                    {(departLate || arrivalLate) && (
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {departLate && <span className="text-[10px] font-bold text-orange-500">Départ en retard</span>}
                        {arrivalLate && <span className="text-[10px] font-bold text-destructive-text">Livraison en retard</span>}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DriverDashboard() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  useRealTimeSync(user?.id);
  const [showProblemSheet, setShowProblemSheet] = useState(false);
  const [showFuelSheet, setShowFuelSheet] = useState(false);
  const [activeTab, setActiveTab] = useState<"mission" | "perf">("mission");

  const { data: driverData, isLoading } = useQuery<DriverMe>({
    queryKey: ["/api/drivers/me"],
    staleTime: 30_000,
  });

  const allMissions = driverData?.missions ?? [];
  const { active: activeMission, upcoming: upcomingMissions } = splitDriverMissions<Mission>(allMissions);

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/missions/${id}/status`, { status }),
    onSuccess: async (_, variables) => {
      toast({
        title: variables.status === "in_progress" ? "Départ confirmé !" : "Livraison confirmée !",
        description: "Le statut de la mission a été mis à jour.",
      });
      queryClient.setQueryData(["/api/drivers/me"], (current: DriverMe | undefined) => {
        if (!current) return current;
        return {
          ...current,
          missions: current.missions.map((mission) =>
            mission.id === variables.id
              ? {
                  ...mission,
                  status: variables.status,
                  actualDepartureDate:
                    variables.status === "in_progress"
                      ? mission.actualDepartureDate ?? new Date().toISOString()
                      : mission.actualDepartureDate,
                  actualDeliveryDate:
                    variables.status === "delivered"
                      ? mission.actualDeliveryDate ?? new Date().toISOString()
                      : mission.actualDeliveryDate,
                }
              : mission,
          ),
        };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/me"] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${variables.id}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/missions/${variables.id}/launch-readiness`] });
    },
    onError: (error: unknown) => {
      toast({ variant: "destructive", title: "Erreur", description: userMessageOf(error, "Impossible de mettre à jour le statut.") });
    },
  });

  const handleStatusAction = () => {
    if (!activeMission) return;
    statusMutation.mutate({
      id: activeMission.id,
      status: activeMission.status === "assigned" ? "in_progress" : "delivered",
    });
  };

  const driverName = user?.name ?? "Chauffeur";
  const initials = getInitials(driverName);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f4f6f8" }}>
      {/* ── Sticky header ───────────────────────────────────────── */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 shadow-md" style={{ background: "#0b2116" }}>
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-green-400" />
          <div>
            <p className="text-white font-bold text-sm leading-tight">Yaro FleetOS</p>
            <p className="text-green-400 text-[10px] uppercase tracking-widest font-semibold">Chauffeur</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ContextualHelpButton />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-success flex items-center justify-center text-white text-xs font-bold">
              {initials}
            </div>
            <p className="text-white text-sm font-medium hidden sm:block">{driverName}</p>
          </div>
          <button onClick={() => logout()} className="text-green-300 hover:text-white transition-colors p-1" aria-label="Se déconnecter">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* ── Tab bar ─────────────────────────────────────────────── */}
      <div className="sticky top-[56px] z-30 bg-card border-b border-gray-100 flex" style={{ boxShadow: "0 1px 0 #f0f0f0" }}>
        <button
          onClick={() => setActiveTab("mission")}
          data-help-target="driver-mission-tab"
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
            activeTab === "mission" ? "border-success text-success" : "border-transparent text-gray-400"
          }`}
        >
          <Truck className="h-4 w-4" />
          Ma mission
          {activeMission && (
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          )}
        </button>
        <button
          onClick={() => setActiveTab("perf")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
            activeTab === "perf" ? "border-success text-success" : "border-transparent text-gray-400"
          }`}
        >
          <BarChart2 className="h-4 w-4" />
          Mes performances
        </button>
      </div>

      {/* ── Page body ────────────────────────────────────────────── */}
      <main className="flex-1 px-4 py-5 space-y-4 max-w-lg mx-auto w-full">
        <p className="text-xs text-gray-400 font-medium uppercase tracking-widest text-center">
          {format(new Date(), "EEEE d MMMM yyyy", { locale: fr })}
        </p>

        {/* ── ONGLET MISSION ──────────────────────────────────────── */}
        {activeTab === "mission" && (
          <>
            {isLoading && (
              <div className="rounded-2xl bg-card border border-gray-100 shadow-sm p-8 flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-4 border-success/30 border-t-green-600 animate-spin" />
                <p className="text-sm text-gray-500">Chargement de votre mission…</p>
              </div>
            )}

            {!isLoading && !activeMission && (
              <div className="rounded-2xl bg-card border border-gray-100 shadow-sm p-8 flex flex-col items-center gap-4 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                  <Truck className="h-8 w-8 text-gray-400" />
                </div>
                <div>
                  <p className="text-base font-semibold text-gray-700">Aucune mission assignée</p>
                  <p className="text-sm text-gray-400 mt-1">Vous n'avez pas de mission active pour le moment.</p>
                </div>
                <button
                  onClick={() => setActiveTab("perf")}
                  className="text-xs text-success font-semibold underline underline-offset-2"
                >
                  Voir mes performances →
                </button>
              </div>
            )}

            {!isLoading && activeMission && (
              <>
                <div className="rounded-2xl bg-card border border-gray-100 shadow-sm overflow-hidden">
                  <div className="h-1 bg-gradient-to-r from-success to-success" />
                  <div className="p-5 space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <StatusBadge status={activeMission.status} />
                      <span className="text-xs text-gray-400 font-mono mt-1">#{activeMission.orderNumber}</span>
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-0.5">Client</p>
                      <p className="text-xl font-bold text-gray-900">{activeMission.clientName ?? activeMission.client?.name ?? "—"}</p>
                    </div>

                    <hr className="border-gray-100" />

                    {/* Pickup */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-success flex-shrink-0" />
                        <p className="text-[11px] font-bold uppercase tracking-widest text-success">Départ</p>
                      </div>
                      <div className="pl-5 space-y-1">
                        <p className="text-base font-medium text-gray-800 leading-snug">{activeMission.pickupAddress}</p>
                        {activeMission.pickupDate && (
                          <div className="flex items-center gap-1.5 text-sm text-gray-500">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{formatDateShort(activeMission.pickupDate)} — {formatTime(activeMission.pickupDate)}</span>
                          </div>
                        )}
                        <a href={mapsUrl(activeMission.pickupAddress)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-blue-600 font-medium mt-1">
                          <Navigation className="h-3.5 w-3.5" />
                          Ouvrir dans Maps
                          <ChevronRight className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>

                    <hr className="border-gray-100" />

                    {/* Delivery */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-4 w-4 text-blue-500 flex-shrink-0" />
                        <p className="text-[11px] font-bold uppercase tracking-widest text-blue-700">Livraison</p>
                      </div>
                      <div className="pl-5 space-y-1">
                        <p className="text-base font-medium text-gray-800 leading-snug">{activeMission.deliveryAddress}</p>
                        {activeMission.deliveryDate && (
                          <div className="flex items-center gap-1.5 text-sm text-gray-500">
                            <Clock className="h-3.5 w-3.5" />
                            <span>{formatDateShort(activeMission.deliveryDate)} — {formatTime(activeMission.deliveryDate)}</span>
                          </div>
                        )}
                        <a href={mapsUrl(activeMission.deliveryAddress)} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm text-blue-600 font-medium mt-1">
                          <Navigation className="h-3.5 w-3.5" />
                          Ouvrir dans Maps
                          <ChevronRight className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>

                    {(activeMission.vehicleRegistration ?? activeMission.assignment?.vehicle) && (
                      <>
                        <hr className="border-gray-100" />
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                            <Truck className="h-4 w-4 text-gray-500" />
                          </div>
                          <div>
                            <p className="text-[11px] text-gray-400 font-medium uppercase tracking-widest">Véhicule</p>
                            <p className="text-sm font-bold text-gray-800">
                              {activeMission.vehicleRegistration ?? activeMission.assignment?.vehicle?.registrationNumber}{" "}
                              <span className="font-normal text-gray-500">
                                {activeMission.vehicleBrand ?? activeMission.assignment?.vehicle?.brand}{" "}
                                {activeMission.vehicleModel ?? activeMission.assignment?.vehicle?.model}
                              </span>
                            </p>
                          </div>
                        </div>
                      </>
                    )}

                    {activeMission.specialInstructions && (
                      <>
                        <hr className="border-gray-100" />
                        <div className="rounded-xl bg-warning/10 border border-warning/20 p-3">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-warning-text mb-1">Instructions</p>
                          <p className="text-sm text-warning-text leading-relaxed">{activeMission.specialInstructions}</p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* CTA */}
                <Button
                  onClick={handleStatusAction}
                  data-help-target="driver-status-action"
                  disabled={statusMutation.isPending}
                  className="w-full h-16 text-lg font-bold bg-success hover:brightness-90 rounded-2xl text-white shadow-md active:scale-95 transition-transform"
                >
                  {statusMutation.isPending ? (
                    <span className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Mise à jour…
                    </span>
                  ) : activeMission.status === "assigned" ? (
                    <span className="flex items-center gap-2"><CheckCircle2 className="h-6 w-6" />CONFIRMER LE DÉPART</span>
                  ) : (
                    <span className="flex items-center gap-2"><CheckCircle2 className="h-6 w-6" />CONFIRMER LA LIVRAISON</span>
                  )}
                </Button>

                {/* Secondary actions */}
                <div className="grid grid-cols-2 gap-3">
                  <a
                    href={mapsUrl(`${activeMission.pickupAddress} to ${activeMission.deliveryAddress}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-card border border-gray-100 shadow-sm p-4 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
                  >
                    <Navigation className="h-5 w-5 text-blue-500" />
                    Feuille de route
                  </a>
                  <button
                    onClick={() => setShowFuelSheet(true)}
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-card border border-gray-100 shadow-sm p-4 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
                  >
                    <Droplets className="h-5 w-5 text-success" />
                    Enregistrer un plein
                  </button>
                  <PodDepositButton
                    missionId={activeMission.id}
                    status={activeMission.status}
                    role={user?.role}
                    tile
                    capture
                    testId="driver-button-pod-deposit"
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-card border border-gray-100 shadow-sm p-4 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform disabled:opacity-60"
                  />
                  <button
                    onClick={() => setShowProblemSheet(true)}
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-card border border-gray-100 shadow-sm p-4 text-center text-sm font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-transform"
                  >
                    <AlertTriangle className="h-5 w-5 text-destructive-text" />
                    Signaler un problème
                  </button>
                </div>

                {upcomingMissions.length > 0 && (
                  <div className="rounded-2xl bg-card border border-gray-100 shadow-sm p-4 space-y-3" data-testid="driver-upcoming-missions">
                    <p className="text-sm font-semibold text-gray-700">
                      Ensuite ({upcomingMissions.length} mission{upcomingMissions.length > 1 ? "s" : ""})
                    </p>
                    <ul className="divide-y divide-gray-100">
                      {upcomingMissions.map((mission) => (
                        <li key={mission.id} className="py-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{mission.clientName ?? mission.client?.name ?? "—"}</p>
                            <p className="text-xs text-gray-500 truncate">{mission.pickupAddress} → {mission.deliveryAddress}</p>
                            {mission.pickupDate && (
                              <p className="text-xs text-gray-400">{formatDateShort(mission.pickupDate)} — {formatTime(mission.pickupDate)}</p>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <StatusBadge status={mission.status} />
                            <span className="text-xs text-gray-400 font-mono">#{mission.orderNumber}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ── ONGLET PERFORMANCES ──────────────────────────────────── */}
        {activeTab === "perf" && (
          isLoading ? (
            <div className="rounded-2xl bg-card border border-gray-100 shadow-sm p-8 flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full border-4 border-success/30 border-t-green-600 animate-spin" />
              <p className="text-sm text-gray-500">Chargement…</p>
            </div>
          ) : (
            <PerformanceTab missions={allMissions} />
          )
        )}
      </main>

      {showProblemSheet && activeMission && (
        <ProblemSheet mission={activeMission} onClose={() => setShowProblemSheet(false)} />
      )}
      {showFuelSheet && activeMission && (
        <FuelSheet mission={activeMission} onClose={() => setShowFuelSheet(false)} />
      )}
    </div>
  );
}
