import { useQuery } from "@tanstack/react-query";
import { isCpcStatusValid } from "@shared/constants/driver-cpc-eligibility";
import { useState } from "react";
import { Link } from "wouter";
import {
  Fuel,
  Truck,
  FileText,
  Users,
  Package,
  BarChart3,
  CheckCircle2,
  Car,
  Droplets,
  TrendingDown,
  TrendingUp,
  XCircle,
  Wrench,
  AlertTriangle,
  Clock,
  ArrowRight,
  MapPin,
  Navigation,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DocumentExpiryPanel } from "@/components/vehicles/document-expiry-panel";
import { DocumentExpiryChart } from "@/components/charts/document-expiry-chart";
import { OverdueInvoicesAlert } from "@/components/dashboard/overdue-invoices-alert";
import {
  HeaderCard,
  KpiGrid,
  KpiTile,
  CardShell,
  AlertBannerCard,
  PremiumTabsNav,
  AlertModal,
  StatusMetricStrip,
} from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { cn, formatPrice } from "@/lib/utils";
import { useFuelCard } from "@/hooks/useFuelCard";
import { differenceInCalendarDays, startOfDay, format } from "date-fns";
import { fr } from "date-fns/locale";

// ── Mission blockers ───────────────────────────────────────────────────────

function getMissionBlockers(mission: any): string[] {
  const blockers: string[] = [];
  const { status, assignment, deliveryDate, pickupDate } = mission;

  if (!deliveryDate && !pickupDate) blockers.push("Date de départ manquante");

  if (status === "draft" || status === "planned") {
    if (!assignment?.vehicleId || !assignment?.driverId) {
      blockers.push("Affectation manquante (véhicule + chauffeur)");
    }
  }

  if (status === "assigned" || status === "in_progress") {
    if (assignment?.driver) {
      // Verdict calculé par le serveur (statut et expiration) ; absent = non communiqué à ce lecteur.
      if (assignment.driver.cpcEligible === false) {
        const detail = isCpcStatusValid(assignment.driver.cpcStatus)
          ? (assignment.driver.cpcIneligibleReason ?? "non valide")
          : assignment.driver.cpcStatus || "non défini";
        blockers.push(`CPC chauffeur invalide (${detail})`);
      }
    } else {
      blockers.push("Aucun chauffeur affecté");
    }
    if (!assignment?.vehicleId) {
      blockers.push("Aucun véhicule affecté");
    }
  }

  return blockers;
}

// ── Urgency helper ─────────────────────────────────────────────────────────

type MissionUrgency = "overdue" | "today" | "tomorrow" | "soon" | "normal";

function getMissionUrgency(mission: any): MissionUrgency {
  // Use pickupDate (departure) as the urgency reference
  const dateStr = mission.pickupDate ?? mission.deliveryDate;
  if (!dateStr) return "normal";
  try {
    const d = startOfDay(new Date(dateStr));
    const today = startOfDay(new Date());
    const diff = differenceInCalendarDays(d, today);
    if (diff < 0) return "overdue";
    if (diff === 0) return "today";
    if (diff === 1) return "tomorrow";
    if (diff <= 3) return "soon";
    return "normal";
  } catch {
    return "normal";
  }
}

const URGENCY_STYLES: Record<
  MissionUrgency,
  { border: string; badge: string; badgeText: string; dateColor: string }
> = {
  overdue:  { border: "border-l-red-400",   badge: "bg-red-100 text-red-700",     badgeText: "En retard",    dateColor: "text-red-600" },
  today:    { border: "border-l-amber-400",  badge: "bg-amber-100 text-amber-700", badgeText: "Aujourd'hui", dateColor: "text-amber-600" },
  tomorrow: { border: "border-l-blue-400",   badge: "bg-blue-100 text-blue-700",   badgeText: "Demain",       dateColor: "text-blue-600" },
  soon:     { border: "border-l-blue-300",   badge: "bg-blue-50 text-blue-600",    badgeText: "Bientôt",      dateColor: "text-blue-500" },
  normal:   { border: "border-l-gray-200",   badge: "bg-gray-100 text-gray-600",   badgeText: "",             dateColor: "text-gray-500" },
};

const URGENCY_ORDER: Record<MissionUrgency, number> = {
  overdue: 0, today: 1, tomorrow: 2, soon: 3, normal: 4,
};

// ── Tab badge ──────────────────────────────────────────────────────────────

function TabBadge({ count, variant = "red" }: { count: number; variant?: "red" | "amber" }) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        "ml-1.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold leading-none px-1.5 min-w-[18px] h-[18px]",
        variant === "red" ? "bg-red-500 text-white" : "bg-amber-400 text-white"
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export default function LogisticsDashboard() {
  const fuelCard = useFuelCard();
  const [blockerModal, setBlockerModal] = useState<{ mission: any } | null>(null);

  // Missions — direct query to /api/missions (the /upcoming and /active operations endpoints don't exist)
  const { data: missionsData, isLoading: missionsLoading } = useQuery<any[]>({
    queryKey: ["/api/missions"],
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });

  const { data: fleetStats } = useQuery<any>({
    queryKey: ["/api/statistics/fleet"],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: fuelStats } = useQuery<any>({
    queryKey: ["/api/fuel-records/statistics", { period: "month" }],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: drivers } = useQuery<any>({
    queryKey: ["/api/drivers"],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  const { data: documentStats } = useQuery<any>({
    queryKey: ["/api/vehicles/document-stats"],
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
  });

  // ── Derived: documents ──
  const expiringDocumentsCount =
    Number(documentStats?.expiringCarteGrise || 0) +
    Number(documentStats?.expiringAssurance || 0) +
    Number(documentStats?.expiringVisiteTechnique || 0);
  const expiredDocumentsCount =
    Number(documentStats?.expiredCarteGrise || 0) +
    Number(documentStats?.expiredAssurance || 0) +
    Number(documentStats?.expiredVisiteTechnique || 0);
  const documentsToHandleCount = expiringDocumentsCount + expiredDocumentsCount;

  // ── Derived: fuel ──
  const fuelBalanceAmount = Number(fuelCard.balance.data?.balance || 0);
  const totalFuelConsumed = Number(fuelCard.balance.data?.totalDebits || 0);
  const totalFuelRecharged = Number(fuelCard.balance.data?.totalCredits || 0);
  const totalFuelLiters = Number(fuelStats?.totalFuel || 0);

  // ── Derived: fleet ──
  const fleetOperational = Number.parseInt(fleetStats?.operational || "0", 10) || 0;
  const fleetMaintenance = Number.parseInt(fleetStats?.maintenance || "0", 10) || 0;
  const fleetOutOfService = Number.parseInt(fleetStats?.outOfService || "0", 10) || 0;

  // ── Derived: drivers ──
  const driversCount = Array.isArray(drivers) ? drivers.length : 0;
  const activeDriversCount = Array.isArray(drivers)
    ? drivers.filter((d: any) => d.isActive).length
    : 0;

  // ── Derived: missions ──
  const allMissions: any[] = Array.isArray(missionsData) ? missionsData : [];

  // Upcoming = not yet in transit or done
  const upcomingList = allMissions.filter((m) =>
    ["draft", "planned", "assigned"].includes(m.status)
  );
  // Active = currently in transit
  const activeList = allMissions.filter((m) => m.status === "in_progress");

  const upcomingWithUrgency = upcomingList.map((m) => ({
    ...m,
    urgency: getMissionUrgency(m),
    blockers: getMissionBlockers(m),
  }));

  const overdueMissions = upcomingWithUrgency.filter((m) => m.urgency === "overdue");
  const todayMissions = upcomingWithUrgency.filter((m) => m.urgency === "today");
  const blockedMissions = upcomingWithUrgency.filter((m) => m.blockers.length > 0);
  const missionAlertCount = overdueMissions.length + todayMissions.length + blockedMissions.length;

  const sortedUpcoming = [...upcomingWithUrgency].sort((a, b) => {
    // Blocked missions rise to top (after overdue/today)
    const urgencyDiff =
      URGENCY_ORDER[a.urgency as MissionUrgency] -
      URGENCY_ORDER[b.urgency as MissionUrgency];
    if (urgencyDiff !== 0) return urgencyDiff;
    // Then blocked before clean
    return (b.blockers.length > 0 ? 1 : 0) - (a.blockers.length > 0 ? 1 : 0);
  });

  // ── Tab labels with badges ──
  const missionsTabLabel = (
    <span className="flex items-center">
      Missions <TabBadge count={missionAlertCount} variant="red" />
    </span>
  );
  const documentsTabLabel = (
    <span className="flex items-center">
      Documents &amp; Chauffeurs
      <TabBadge count={expiredDocumentsCount} variant="red" />
      {expiredDocumentsCount === 0 && (
        <TabBadge count={expiringDocumentsCount} variant="amber" />
      )}
    </span>
  );

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Tableau de bord · Logistique"
        title="Gestion Logistique"
        subtitle="Missions, flotte, documents et carburant"
        icon={<Truck className="h-5 w-5" />}
      >
        <KpiGrid columns={4}>
          {fuelCard.balance.isLoading ? (
            <>
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-2"
                >
                  <Skeleton className="h-8 w-8 rounded-lg" />
                  <Skeleton className="h-3 w-20 mt-1" />
                  <Skeleton className="h-5 w-16" />
                </div>
              ))}
            </>
          ) : (
            <>
              <KpiTile
                data-testid="logistics-kpi-balance"
                label="Solde carte carburant"
                featured // a zero, les camions s'arretent
                value={formatPrice(fuelBalanceAmount)}
                subValue={`${Math.round(fuelCard.balance.data?.fuelBalance || 0)} L disponibles`}
                icon={<Fuel className="h-4 w-4" />}
                iconWrapperClassName="bg-blue-50 text-blue-600"
              />
              <KpiTile
                data-testid="logistics-kpi-consumption"
                label="Total consommé"
                value={formatPrice(totalFuelConsumed)}
                subValue="Ce mois"
                icon={<TrendingDown className="h-4 w-4" />}
                iconWrapperClassName="bg-red-50 text-red-600"
              />
              <KpiTile
                data-testid="logistics-kpi-recharge"
                label="Total rechargé"
                value={formatPrice(totalFuelRecharged)}
                subValue="Total des recharges"
                icon={<TrendingUp className="h-4 w-4" />}
                iconWrapperClassName="bg-green-50 text-green-600"
              />
              <KpiTile
                data-testid="logistics-kpi-liters"
                label="Volume consommé"
                value={`${totalFuelLiters.toFixed(0)} L`}
                subValue="Ce mois"
                icon={<Droplets className="h-4 w-4" />}
                iconWrapperClassName="bg-orange-50 text-orange-600"
              />
            </>
          )}
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="missions">
        <PremiumTabsNav
          tabs={[
            { value: "missions", label: missionsTabLabel, icon: <TabIcon icon={MapPin} /> },
            { value: "documents", label: documentsTabLabel, icon: <TabIcon icon={FileText} /> },
            { value: "fleet", label: "Flotte", icon: <TabIcon icon={Truck} /> },
            { value: "fuel", label: "Carburant", icon: <TabIcon icon={Fuel} /> },
          ]}
        />

        {/* ── Missions ── */}
        <TabsContent value="missions" className="space-y-4">
          <StatusMetricStrip
            title="Vue opérationnelle"
            subtitle="Suivi des départs et missions en cours"
            columns={4}
            items={[
              {
                id: "upcoming",
                label: "Missions à venir",
                value: upcomingList.length,
                tone: overdueMissions.length > 0 ? "danger" : "info",
                icon: <Package className="h-4 w-4" />,
                detail:
                  overdueMissions.length > 0 ? (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span>
                        {upcomingList.length - overdueMissions.length} planifiée
                        {upcomingList.length - overdueMissions.length !== 1 ? "s" : ""}
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-red-600">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        {overdueMissions.length} en retard
                      </span>
                    </span>
                  ) : (
                    "Planifiées"
                  ),
              },
              {
                id: "active",
                label: "En cours",
                value: activeList.length,
                tone: activeList.length > 0 ? "success" : "neutral",
                icon: <Navigation className="h-4 w-4" />,
                detail: "En transit",
              },
              {
                id: "today",
                label: "Départ aujourd'hui",
                value: todayMissions.length,
                tone: todayMissions.length > 0 ? "warning" : "neutral",
                icon: <Clock className="h-4 w-4" />,
                detail: todayMissions.length > 0 ? "Départ imminent" : "Aucun départ",
              },
              {
                id: "overdue",
                label: "En retard",
                value: overdueMissions.length,
                tone: overdueMissions.length > 0 ? "danger" : "neutral",
                icon: <AlertTriangle className="h-4 w-4" />,
                detail: overdueMissions.length > 0 ? "Action requise" : "Aucun retard",
              },
            ]}
          />

          {/* Alertes */}
          {overdueMissions.length > 0 && (
            <AlertBannerCard
              variant="danger"
              icon={<AlertTriangle className="h-4 w-4" />}
              title={`${overdueMissions.length} mission(s) en retard — action immédiate requise`}
              description="Ces missions ont dépassé leur date de départ prévue"
              count={overdueMissions.length}
              href="/missions"
            />
          )}
          {overdueMissions.length === 0 && todayMissions.length > 0 && (
            <AlertBannerCard
              variant="warning"
              icon={<Clock className="h-4 w-4" />}
              title={`${todayMissions.length} mission(s) prévue(s) aujourd'hui`}
              description="Vérifiez que les véhicules et chauffeurs sont prêts au départ"
              count={todayMissions.length}
              href="/missions"
            />
          )}
          {blockedMissions.length > 0 && (
            <AlertBannerCard
              variant="warning"
              icon={<AlertTriangle className="h-4 w-4" />}
              title={`${blockedMissions.length} mission(s) bloquée(s) — action requise avant lancement`}
              description="Des prérequis manquent (affectation, CPC, date…)"
              count={blockedMissions.length}
              href="/missions"
            />
          )}

          {/* Liste missions à venir */}
          <CardShell topBar>
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                  Missions à venir
                </p>
                <Link href="/missions">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-500 gap-1">
                    Voir tout <ArrowRight className="h-3 w-3" />
                  </Button>
                </Link>
              </div>

              {missionsLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-14 rounded-xl" />
                  ))}
                </div>
              ) : sortedUpcoming.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">
                  Aucune mission planifiée
                </p>
              ) : (
                <div className="space-y-2">
                  {sortedUpcoming.slice(0, 8).map((m) => {
                    const styles = URGENCY_STYLES[m.urgency as MissionUrgency];
                    const dateStr = m.pickupDate ?? m.deliveryDate;
                    const hasBlockers = m.blockers.length > 0;
                    return (
                      <Link key={m.id} href={`/missions/${m.id}`}>
                        <div
                          className={cn(
                            "rounded-xl border-l-[3px] border border-gray-100 bg-gray-50/60 px-4 py-2.5",
                            "cursor-pointer hover:bg-gray-100/80 transition-colors group",
                            hasBlockers && m.urgency === "normal"
                              ? "border-l-orange-300"
                              : styles.border
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                              {/* Row 1: client → destination */}
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="text-[12px] font-semibold text-gray-800 truncate">
                                  {m.client?.name ?? "Client inconnu"}
                                </span>
                                <span className="text-gray-300 shrink-0">→</span>
                                <span className="text-[12px] text-gray-600 truncate flex items-center gap-1">
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  {m.deliveryAddress ?? "—"}
                                </span>
                              </div>
                              {/* Row 2: urgency badge + date + status */}
                              <div className="flex items-center gap-2 flex-wrap">
                                {styles.badgeText && (
                                  <span className={cn("rounded-full text-[10px] font-semibold px-2 py-0.5", styles.badge)}>
                                    {styles.badgeText}
                                  </span>
                                )}
                                {dateStr && (
                                  <span className={cn("text-[11px] font-medium", styles.dateColor)}>
                                    {(() => {
                                      try { return format(new Date(dateStr), "dd MMM yyyy", { locale: fr }); }
                                      catch { return String(dateStr); }
                                    })()}
                                  </span>
                                )}
                                {m.status === "assigned" && m.assignment ? (
                                  <span className="rounded-full bg-purple-50 border border-purple-100 text-purple-700 text-[10px] font-semibold px-2 py-0.5">
                                    {"Assigné à "}
                                    {m.assignment.driver
                                      ? `${m.assignment.driver.firstName} ${m.assignment.driver.lastName}`
                                      : "chauffeur inconnu"}
                                    {m.assignment.vehicle
                                      ? ` · ${[m.assignment.vehicle.brand, m.assignment.vehicle.model].filter(Boolean).join(" ") || m.assignment.vehicle.registrationNumber}`
                                      : ""}
                                  </span>
                                ) : m.status === "draft" ? (
                                  <span className="rounded-full bg-gray-100 text-gray-400 text-[10px] font-medium px-2 py-0.5">
                                    Brouillon
                                  </span>
                                ) : m.status === "planned" ? (
                                  <span className="rounded-full bg-blue-50 text-blue-500 text-[10px] font-medium px-2 py-0.5">
                                    Planifiée
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            {hasBlockers && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setBlockerModal({ mission: m });
                                }}
                                className="shrink-0 w-7 h-7 rounded-lg bg-orange-50 border border-orange-200 flex items-center justify-center hover:bg-orange-100 transition-colors"
                                title={`${m.blockers.length} prérequis manquant(s)`}
                              >
                                <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                              </button>
                            )}
                            <ArrowRight className="h-4 w-4 text-gray-300 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </CardShell>

          {/* Missions actives */}
          {(activeList.length > 0 || (missionsLoading && allMissions.length === 0)) && (
            <CardShell topBar topBarClassName="bg-gradient-to-r from-green-400 to-emerald-500">
              <div className="px-5 py-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                    En cours de route
                  </p>
                  <span className="rounded-full bg-green-50 border border-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-600">
                    {activeList.length} actif{activeList.length > 1 ? "s" : ""}
                  </span>
                </div>
                {missionsLoading ? (
                  <div className="space-y-2">
                    {[0, 1].map((i) => (
                      <Skeleton key={i} className="h-14 rounded-xl" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {activeList.slice(0, 5).map((m: any) => (
                      <Link key={m.id} href={`/missions/${m.id}`}>
                        <div className="flex items-center gap-3 rounded-xl border-l-[3px] border-l-green-400 border border-gray-100 bg-green-50/40 px-4 py-2.5 cursor-pointer hover:bg-green-50/70 transition-colors group">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <span className="text-[12px] font-semibold text-gray-800 truncate">
                                {m.client?.name ?? "Client inconnu"}
                              </span>
                              <span className="text-gray-300 shrink-0">→</span>
                              <span className="text-[12px] text-gray-600 truncate flex items-center gap-1">
                                <MapPin className="h-3 w-3 shrink-0" />
                                {m.deliveryAddress ?? "—"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-green-100 text-green-700 text-[10px] font-semibold px-2 py-0.5">
                                En transit
                              </span>
                              {m.assignment?.driver && (
                                <span className="text-[11px] text-gray-500">
                                  {m.assignment.driver.firstName} {m.assignment.driver.lastName}
                                </span>
                              )}
                              {m.assignment?.vehicle && (
                                <span className="text-[11px] text-gray-400">
                                  · {[m.assignment.vehicle.brand, m.assignment.vehicle.model].filter(Boolean).join(" ") || m.assignment.vehicle.registrationNumber}
                                </span>
                              )}
                            </div>
                          </div>
                          <ArrowRight className="h-4 w-4 text-gray-300 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </CardShell>
          )}

          {/* Actions rapides */}
          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                Actions rapides
              </p>
              <div className="flex flex-wrap gap-2">
                <Link href="/missions/new">
                  <Button size="sm" className="gap-2" data-testid="btn-new-mission">
                    <Package className="h-3.5 w-3.5" /> Planifier une mission
                  </Button>
                </Link>
                <Link href="/missions">
                  <Button variant="outline" size="sm" className="gap-2" data-testid="btn-view-missions">
                    <Truck className="h-3.5 w-3.5" /> Toutes les missions
                  </Button>
                </Link>
                <Link href="/operations?tab=clients">
                  <Button variant="outline" size="sm" className="gap-2" data-testid="btn-manage-clients">
                    <Users className="h-3.5 w-3.5" /> Clients
                  </Button>
                </Link>
              </div>
            </div>
          </CardShell>
        </TabsContent>

        {/* ── Documents & Chauffeurs ── */}
        <TabsContent value="documents" className="space-y-4">
          <StatusMetricStrip
            title="Conformité & équipage"
            subtitle="Documents véhicules et chauffeurs disponibles"
            columns={3}
            items={[
              {
                id: "documents",
                testId: "logistics-kpi-documents",
                label: expiredDocumentsCount > 0 ? "Documents en alerte" : "Documents à renouveler",
                value: documentsToHandleCount,
                tone: expiredDocumentsCount > 0 ? "danger" : expiringDocumentsCount > 0 ? "warning" : "success",
                icon: <FileText className="h-4 w-4" />,
                detail:
                  expiredDocumentsCount > 0
                    // « à renouveler » était faux: un document expiré est le
                    // plus à renouveler de tous. Ce compteur mesure ce qui
                    // approche de l'échéance, pas ce qui doit être traité.
                    ? `${expiredDocumentsCount} expiré(s) · ${expiringDocumentsCount} expire(nt) bientôt`
                    : `${expiringDocumentsCount} expiration(s) proche(s)`,
              },
              {
                id: "drivers",
                testId: "logistics-kpi-drivers",
                label: "Chauffeurs enregistrés",
                value: driversCount,
                tone: "info",
                icon: <Users className="h-4 w-4" />,
                detail: "Dans la flotte",
              },
              {
                id: "active-drivers",
                testId: "logistics-kpi-active-drivers",
                label: "Chauffeurs actifs",
                value: activeDriversCount,
                tone: activeDriversCount > 0 ? "success" : "neutral",
                icon: <CheckCircle2 className="h-4 w-4" />,
                detail: "En service",
              },
            ]}
          />

          {expiredDocumentsCount > 0 && (
            <AlertBannerCard
              variant="danger"
              icon={<FileText className="h-4 w-4" />}
              title={`${expiredDocumentsCount} document(s) expiré(s) — action requise`}
              description="Des véhicules circulent avec des documents hors validité"
              count={expiredDocumentsCount}
              href="/workflows/documents"
            />
          )}

          <DocumentExpiryPanel />

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                État des Documents Véhicules
              </p>
              <DocumentExpiryChart />
            </div>
          </CardShell>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Documents</p>
                <div className="flex flex-col gap-2">
                  <Link href="/workflows/documents">
                    <Button
                      size="sm"
                      className="justify-start gap-2 w-full"
                      data-testid="btn-manage-documents"
                    >
                      <FileText className="h-3.5 w-3.5" /> Gérer les documents
                    </Button>
                  </Link>
                  <Link href="/vehicles">
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start gap-2 w-full"
                      data-testid="btn-view-all-vehicles"
                    >
                      <Car className="h-3.5 w-3.5" /> Voir tous les véhicules
                    </Button>
                  </Link>
                </div>
              </div>
            </CardShell>
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Chauffeurs</p>
                <div className="flex flex-col gap-2">
                  <Link href="/drivers">
                    <Button
                      size="sm"
                      className="justify-start gap-2 w-full"
                      data-testid="btn-view-all-drivers"
                    >
                      <Users className="h-3.5 w-3.5" /> Voir tous les chauffeurs
                    </Button>
                  </Link>
                  <p className="text-xs text-gray-400 mt-1">
                    {driversCount} enregistré(s) · {activeDriversCount} actif(s)
                  </p>
                </div>
              </div>
            </CardShell>
          </div>
        </TabsContent>

        {/* ── Flotte ── */}
        <TabsContent value="fleet" className="space-y-4">
          <StatusMetricStrip
            title="Disponibilité flotte"
            subtitle="Répartition des véhicules par statut opérationnel"
            columns={3}
            items={[
              {
                id: "operational",
                testId: "logistics-kpi-operational",
                label: "Véhicules opérationnels",
                value: fleetOperational,
                tone: fleetOperational > 0 ? "success" : "neutral",
                icon: <Truck className="h-4 w-4" />,
                detail: "Disponibles pour missions",
              },
              {
                id: "maintenance",
                testId: "logistics-kpi-maintenance",
                label: "En maintenance",
                value: fleetMaintenance,
                tone: fleetMaintenance > 0 ? "warning" : "neutral",
                icon: <Wrench className="h-4 w-4" />,
                detail: "Temporairement indisponibles",
              },
              {
                id: "out-of-service",
                testId: "logistics-kpi-outofservice",
                label: "Hors service",
                value: fleetOutOfService,
                tone: fleetOutOfService > 0 ? "danger" : "neutral",
                icon: <XCircle className="h-4 w-4" />,
                detail: "Non disponibles",
              },
            ]}
          />
          <CardShell>
            <div className="px-5 py-4">
              <Link href="/vehicles">
                <Button size="sm" className="gap-2" data-testid="btn-view-vehicles">
                  <Car className="h-3.5 w-3.5" /> Voir tous les véhicules
                </Button>
              </Link>
            </div>
          </CardShell>
        </TabsContent>

        {/* ── Carburant ── */}
        <TabsContent value="fuel" className="space-y-4">
          {fuelCard.balance.isLoading ? (
            <CardShell topBar>
              <div className="grid grid-cols-2 gap-px bg-gray-100/90 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="bg-slate-50/80 px-5 py-4">
                    <Skeleton className="mb-2 h-3 w-24" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                ))}
              </div>
            </CardShell>
          ) : (
            <StatusMetricStrip
              title="Carte carburant"
              subtitle="Solde et consommation du mois en cours"
              columns={4}
              items={[
                {
                  id: "balance",
                  testId: "logistics-kpi-balance",
                  label: "Solde carte",
                  value: formatPrice(fuelBalanceAmount),
                  tone: fuelBalanceAmount > 0 ? "info" : "warning",
                  icon: <Fuel className="h-4 w-4" />,
                  detail: `${Math.round(fuelCard.balance.data?.fuelBalance || 0)} L disponibles`,
                },
                {
                  id: "consumed",
                  testId: "logistics-kpi-consumption",
                  label: "Total consommé",
                  value: formatPrice(totalFuelConsumed),
                  tone: "neutral",
                  icon: <TrendingDown className="h-4 w-4" />,
                  detail: "Ce mois",
                },
                {
                  id: "recharged",
                  testId: "logistics-kpi-recharge",
                  label: "Total rechargé",
                  value: formatPrice(totalFuelRecharged),
                  tone: "success",
                  icon: <TrendingUp className="h-4 w-4" />,
                  detail: "Total des recharges",
                },
                {
                  id: "liters",
                  testId: "logistics-kpi-liters",
                  label: "Volume consommé",
                  value: `${totalFuelLiters.toFixed(0)} L`,
                  tone: "warning",
                  icon: <Droplets className="h-4 w-4" />,
                  detail: "Ce mois",
                },
              ]}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                  Gestion Carburant
                </p>
                <div className="flex flex-col gap-2">
                  <Link href="/fuel/new">
                    <Button
                      size="sm"
                      className="justify-start gap-2 w-full"
                      data-testid="btn-add-fuel"
                    >
                      <Fuel className="h-3.5 w-3.5" /> Enregistrer une consommation
                    </Button>
                  </Link>
                  <Link href="/fuel">
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start gap-2 w-full"
                      data-testid="btn-view-fuel"
                    >
                      <BarChart3 className="h-3.5 w-3.5" /> Voir l'historique carburant
                    </Button>
                  </Link>
                </div>
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                  Statistiques
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <span className="text-sm text-gray-500">Prix moyen / litre</span>
                    <span className="text-sm font-semibold text-gray-800">
                      {fuelCard.balance.data?.averagePricePerLiter
                        ? `${formatPrice(fuelCard.balance.data.averagePricePerLiter)}/L`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-gray-500">Solde en litres</span>
                    <span className="text-sm font-semibold text-gray-800">
                      {fuelCard.balance.data?.fuelBalance
                        ? `${Math.round(fuelCard.balance.data.fuelBalance)} L`
                        : "0 L"}
                    </span>
                  </div>
                </div>
              </div>
            </CardShell>
          </div>
          <OverdueInvoicesAlert />
        </TabsContent>
      </Tabs>

      {/* Blocker modal */}
      <AlertModal
        open={!!blockerModal}
        onOpenChange={() => setBlockerModal(null)}
        variant="warning"
        title={`Mission bloquée — prérequis manquants`}
        description={
          blockerModal
            ? `${blockerModal.mission.client?.name ?? "Mission"} → ${blockerModal.mission.deliveryAddress ?? "destination inconnue"}`
            : undefined
        }
        details={blockerModal?.mission.blockers}
      />
    </div>
  );
}
