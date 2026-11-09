import { useQuery } from "@tanstack/react-query";
import { listQueryView, queryView, readyData } from "@/lib/query-view";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { InlineQueryError } from "@/components/ui/inline-query-error";
import { statField } from "@/lib/stat-number";
import {
  clientTotals,
  countSentence,
  documentRenewals,
  isPositive,
  statDisplay,
  viewData,
} from "@/lib/secretary-dashboard-stats";
import { Link } from "wouter";
import {
  Plus, FileText, Bell, ClipboardList, Car, Fuel,
  BarChart2, Banknote, CreditCard, Users, Route,
  Truck, CheckCircle2, Clock, AlertTriangle, XCircle,
  LayoutDashboard, Briefcase, Receipt, Gauge, GraduationCap,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { DocumentExpiryPanel } from "@/components/vehicles/document-expiry-panel";
import { DocumentExpiryChart } from "@/components/charts/document-expiry-chart";
import { FuelConsumptionChart } from "@/components/charts/fuel-consumption-chart";
import { CPCAlertsPanel } from "@/components/drivers/cpc-alerts-panel";
import { CPCStatusChart } from "@/components/charts/cpc-status-chart";
import { MileageUpdateForm } from "@/components/vehicles/mileage-update-form";
import { CPCUpdateForm } from "@/components/drivers/cpc-update-form";
import { OverdueInvoicesAlert } from "@/components/dashboard/overdue-invoices-alert";
import { HeaderCard, KpiGrid, KpiTile, CardShell, AlertBannerCard, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { formatPrice } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { canManageFleetVehicles } from "@/lib/auth";
import { useLocation } from "wouter";

interface SecretaryVehicle {
  id: number;
  registrationNumber: string;
  mileage: number | null;
  lastMileage: number | null;
  currentKilometers: number | null;
}

/** Ligne de `GET /api/operations/stats/by-client` ; les montants sont lus par `statField`. */
interface ClientStatsRow {
  clientId: number | null;
  clientName: string;
}

/** Ligne de `GET /api/drivers/cpc-status`. */
interface CpcDriver {
  id: number;
  firstName: string;
  lastName: string;
  cpcTrainingDate?: string | null;
  cpcStatus?: string;
}

const getEffectiveMileage = (v: SecretaryVehicle) =>
  Math.max(v.lastMileage ?? 0, v.mileage ?? 0, v.currentKilometers ?? 0);

export default function SecretaryDashboard() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const canAddVehicle = canManageFleetVehicles(user);
  // Requêtes gardées entières : une lecture en échec affiche « Indisponible », jamais 0.
  const vehiclesQuery = useQuery<unknown>({ queryKey: ["/api/vehicles/all"] });
  const alertsQuery = useQuery<unknown>({ queryKey: ["/api/alerts"] });
  const documentStatsQuery = useQuery<unknown>({ queryKey: ["/api/vehicles/document-stats"] });
  const cpcStatsQuery = useQuery<unknown>({ queryKey: ["/api/drivers/cpc-statistics"] });
  const driversStatusQuery = useQuery<unknown>({ queryKey: ["/api/drivers/cpc-status"] });
  const statsByClientQuery = useQuery<unknown>({ queryKey: ["/api/operations/stats/by-client"] });
  const invoicesSummaryQuery = useQuery<unknown>({ queryKey: ["/api/billing/invoices/summary"] });

  const vehiclesView = listQueryView<SecretaryVehicle>(vehiclesQuery);
  const documentStatsView = queryView(documentStatsQuery);
  const cpcStatsView = queryView(cpcStatsQuery);
  const driversView = listQueryView<CpcDriver>(driversStatusQuery);
  const clientsView = listQueryView<ClientStatsRow>(statsByClientQuery);
  const invoicesView = queryView(invoicesSummaryQuery);

  const clients = viewData(clientsView);
  const totals = clientTotals(clients);
  // Alertes illisibles : « Indisponible », jamais 0 alerte.
  const alertsView = listQueryView<unknown>(alertsQuery);
  const alertsFailed = alertsView.kind === "error";
  const alertsCount = readyData(alertsView, []).length;
  const vehicles = viewData(vehiclesView);
  const vehiclesCount = vehicles ? vehicles.length : null;
  const documents = documentRenewals(viewData(documentStatsView));
  const invoices = viewData(invoicesView);
  const totalInvoices = statField(invoices, "total");
  const pendingInvoices = statField(invoices, "pending");
  const paidInvoices = statField(invoices, "paid");
  const cpcStats = viewData(cpcStatsView);
  const cpcFormed = statField(cpcStats, "forme");
  const cpcToTrain = statField(cpcStats, "aFormer");
  const cpcNotFormed = statField(cpcStats, "nonForme");
  const cpcTotal = statField(cpcStats, "total");
  const drivers = viewData(driversView);

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Tableau de bord · Secrétaire"
        title="Gestion Administrative"
        subtitle="Opérations, facturation, documents et formations CPC"
        icon={<ClipboardList className="h-5 w-5" />}
      >
        <KpiGrid columns={4}>
          <KpiTile
            data-testid="secretary-kpi-alerts"
            label="Alertes actives"
            value={alertsFailed ? UNAVAILABLE : alertsCount}
            subValue="À traiter"
            icon={<Bell className="h-4 w-4" />}
            iconWrapperClassName={alertsCount > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
            valueClassName={alertsCount > 0 ? "text-orange-600" : undefined}
            className="cursor-pointer"
            onClick={() => window.location.href = "/alerts"}
          />
          <KpiTile
            data-testid="secretary-kpi-vehicles"
            label="Véhicules enregistrés"
            value={statDisplay(vehiclesView, vehiclesCount)}
            subValue="Dans la flotte"
            icon={<Truck className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            data-testid="secretary-kpi-documents"
            label="Documents à renouveler"
            featured // un document expire immobilise un vehicule
            // Carte grise, assurance, visite technique: la page qui les liste
            // est « Documents & Conformité », déjà dans le menu de la secrétaire.
            onClick={() => setLocation("/vehicles/documents")}
            value={statDisplay(documentStatsView, documents.toRenew)}
            subValue={
              documents.expired !== null && documents.expiringSoon !== null
                ? `${documents.expired} expiré(s) · ${documents.expiringSoon} à venir`
                : undefined
            }
            icon={<FileText className="h-4 w-4" />}
            iconWrapperClassName={isPositive(documents.toRenew) ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
            valueClassName={isPositive(documents.toRenew) ? "text-red-600" : undefined}
          />
          <KpiTile
            data-testid="secretary-kpi-missions"
            label="Missions totales"
            value={statDisplay(clientsView, totals.missions)}
            subValue="Toutes missions"
            icon={<Route className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
          />
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="overview">
        <PremiumTabsNav
          className="flex-wrap"
          tabs={[
            { value: "overview", label: "Vue d'ensemble", icon: <TabIcon icon={LayoutDashboard} /> },
            { value: "operations", label: "Opérations", icon: <TabIcon icon={Briefcase} /> },
            { value: "billing", label: "Facturation clients", icon: <TabIcon icon={Receipt} /> },
            { value: "documents", label: "Documents", icon: <TabIcon icon={FileText} /> },
            { value: "mileage", label: "Kilométrage", icon: <TabIcon icon={Gauge} /> },
            { value: "cpc", label: "CPC", icon: <TabIcon icon={GraduationCap} /> },
          ]}
        />

        {/* ── Vue d'ensemble ── */}
        <TabsContent value="overview" className="space-y-4">
          {alertsCount > 0 && (
            <AlertBannerCard
              variant="warning"
              icon={<Bell className="h-4 w-4" />}
              title={`${alertsCount} alerte(s) active(s) — à traiter`}
              href="/alerts"
              count={alertsCount}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Actions rapides</p>
                <div className="flex flex-col gap-2">
                  {canAddVehicle ? (
                    <Link href="/vehicles/new">
                      <Button size="sm" className="justify-start gap-2 w-full" data-testid="btn-new-vehicle">
                        <Plus className="h-3.5 w-3.5" /> Enregistrer un véhicule
                      </Button>
                    </Link>
                  ) : null}
                  <Link href="/workflows/documents">
                    <Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-manage-documents">
                      <FileText className="h-3.5 w-3.5" /> Gérer les documents
                    </Button>
                  </Link>
                  <Link href="/alerts">
                    <Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-view-alerts">
                      <Bell className="h-3.5 w-3.5" /> Voir les alertes
                    </Button>
                  </Link>
                  <Link href="/operations?tab=clients">
                    <Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-manage-clients">
                      <Users className="h-3.5 w-3.5" /> Gérer les clients
                    </Button>
                  </Link>
                </div>
              </div>
            </CardShell>

            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Rappels importants</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                    <Bell className="h-3.5 w-3.5 text-orange-500" />
                    {alertsFailed ? (
                      <span className="text-sm text-gray-600" data-testid="secretary-alerts-unavailable">Alertes indisponibles</span>
                    ) : (
                      <span className="text-sm text-gray-600">{alertsCount} alerte(s) à traiter</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                    <Car className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-sm text-gray-600">
                      {countSentence(vehiclesView, vehiclesCount, (n) => `${n} véhicule(s) enregistré(s)`, "Véhicules indisponibles")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 py-1.5">
                    <FileText className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-sm text-gray-600">
                      {countSentence(documentStatsView, documents.toRenew, (n) => `${n} document(s) à renouveler`, "Documents indisponibles")}
                    </span>
                  </div>
                </div>
              </div>
            </CardShell>
          </div>

          <CardShell>
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Fuel className="h-4 w-4 text-amber-500" />
                <span className="text-sm font-semibold text-gray-800">Consommation Carburant</span>
              </div>
              <FuelConsumptionChart />
            </div>
          </CardShell>

          <OverdueInvoicesAlert />
        </TabsContent>

        {/* ── Opérations ── */}
        <TabsContent value="operations" className="space-y-4">
          <KpiGrid columns={3}>
            <KpiTile
              data-testid="secretary-kpi-missions"
              label="Missions totales"
              value={statDisplay(clientsView, totals.missions)}
              subValue="Toutes missions"
              icon={<Truck className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
            <KpiTile
              data-testid="secretary-kpi-revenue"
              label="Chiffre d'affaires"
              value={statDisplay(clientsView, totals.revenue, formatPrice)}
              subValue="Facturé clients"
              icon={<Banknote className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
            <KpiTile
              data-testid="secretary-kpi-costs"
              label="Coûts carburant"
              value={statDisplay(clientsView, totals.fuelCost, formatPrice)}
              subValue="Carburant consommé en mission"
              icon={<BarChart2 className="h-4 w-4" />}
              iconWrapperClassName="bg-red-50 text-red-600"
            />
          </KpiGrid>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Statistiques par Client</p>
              {clientsView.kind === "error" ? (
                <InlineQueryError
                  error={clientsView.error}
                  fallback="Les statistiques par client sont momentanément indisponibles."
                  onRetry={() => void statsByClientQuery.refetch()}
                  isRetrying={clientsView.isRetrying}
                  data-testid="secretary-clients-error"
                />
              ) : clients && clients.length === 0 ? (
                <p className="text-sm text-gray-400">Aucune mission rattachée à un client.</p>
              ) : (
              <div className="space-y-2">
                {(clients ?? []).map((client) => (
                  <div key={client.clientId ?? client.clientName} className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-800">{client.clientName}</span>
                      <span className="text-xs text-gray-400">
                        {statDisplay(clientsView, statField(client, "totalMissions"))} missions
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <p className="text-gray-400">CA</p>
                        <p className="font-semibold text-green-600">
                          {statDisplay(clientsView, statField(client, "totalRevenue"), formatPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Carburant</p>
                        <p className="font-semibold text-red-600">
                          {statDisplay(clientsView, statField(client, "totalFuelCost"), formatPrice)}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-400">Marge</p>
                        <p className="font-semibold text-purple-600">
                          {statDisplay(clientsView, statField(client, "marginPercentage"), (n) => `${n.toFixed(1)}%`)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/operations">
                  <Button size="sm" className="gap-2">
                    <ClipboardList className="h-3.5 w-3.5" /> Voir toutes les opérations
                  </Button>
                </Link>
                <Link href="/operations?tab=clients">
                  <Button variant="outline" size="sm" className="gap-2">
                    <Users className="h-3.5 w-3.5" /> Gérer les clients
                  </Button>
                </Link>
                <Link href="/reports">
                  <Button variant="outline" size="sm" className="gap-2">
                    <BarChart2 className="h-3.5 w-3.5" /> Exporter les données
                  </Button>
                </Link>
              </div>
            </div>
          </CardShell>
        </TabsContent>

        {/* ── Facturation ── */}
        <TabsContent value="billing" className="space-y-4">
          <KpiGrid columns={3}>
            <KpiTile
              data-testid="secretary-kpi-invoices"
              label="Factures clients"
              value={statDisplay(invoicesView, totalInvoices)}
              subValue="Total factures"
              icon={<FileText className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
            <KpiTile
              data-testid="secretary-kpi-pending"
              label="En attente"
              value={statDisplay(invoicesView, pendingInvoices)}
              subValue="À encaisser"
              icon={<Clock className="h-4 w-4" />}
              iconWrapperClassName={isPositive(pendingInvoices) ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
              valueClassName={isPositive(pendingInvoices) ? "text-orange-600" : undefined}
            />
            <KpiTile
              data-testid="secretary-kpi-paid"
              label="Payées"
              value={statDisplay(invoicesView, paidInvoices)}
              subValue="Encaissées"
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
          </KpiGrid>

          <CardShell>
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Banknote className="h-4 w-4 text-green-500" />
                <span className="text-sm font-semibold text-gray-800">Résumé Financier</span>
              </div>
              <div className="space-y-1.5">
                {[
                  { label: "Total HT", value: statDisplay(invoicesView, statField(invoices, "totalAmountHT"), formatPrice), bg: "bg-gray-50" },
                  { label: "TVA (19.25%)", value: statDisplay(invoicesView, statField(invoices, "totalVAT"), formatPrice), bg: "bg-gray-50" },
                  { label: "Total TTC", value: statDisplay(invoicesView, statField(invoices, "totalAmountTTC"), formatPrice), bg: "bg-green-50", bold: true },
                  { label: "Solde restant", value: statDisplay(invoicesView, statField(invoices, "totalBalance"), formatPrice), bg: "bg-orange-50", orange: true },
                ].map(({ label, value, bg, bold, orange }) => (
                  <div key={label} className={`flex items-center justify-between px-3 py-2 rounded-lg ${bg}`}>
                    <span className={`text-sm ${bold ? "font-semibold text-gray-800" : "text-gray-500"}`}>{label}</span>
                    <span className={`text-sm font-bold ${orange ? "text-orange-600" : bold ? "text-green-600" : "text-gray-800"}`}>{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex gap-2">
                <Link href="/operations">
                  <Button size="sm" className="gap-2">
                    <CreditCard className="h-3.5 w-3.5" /> Gérer la facturation clients
                  </Button>
                </Link>
                <Link href="/reports">
                  <Button variant="outline" size="sm" className="gap-2">
                    <BarChart2 className="h-3.5 w-3.5" /> Exporter les factures
                  </Button>
                </Link>
              </div>
            </div>
          </CardShell>
        </TabsContent>

        {/* ── Documents ── */}
        <TabsContent value="documents" className="space-y-4">
          <DocumentExpiryPanel />
          <CardShell>
            <div className="px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart2 className="h-4 w-4 text-blue-500" />
                <span className="text-sm font-semibold text-gray-800">État des Documents Véhicules</span>
              </div>
              <DocumentExpiryChart />
            </div>
          </CardShell>
        </TabsContent>

        {/* ── Kilométrage ── */}
        <TabsContent value="mileage" className="space-y-4">
          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Mise à jour du kilométrage</p>
              <p className="text-xs text-gray-400">Sélectionnez un véhicule ci-dessous pour mettre à jour son kilométrage.</p>
            </div>
          </CardShell>
          {vehiclesView.kind === "error" && (
            <InlineQueryError
              error={vehiclesView.error}
              fallback="La liste des véhicules est momentanément indisponible."
              onRetry={() => void vehiclesQuery.refetch()}
              isRetrying={vehiclesView.isRetrying}
              data-testid="secretary-vehicles-error"
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehicles?.slice(0, 9).map((vehicle) => (
              <MileageUpdateForm
                key={vehicle.id}
                vehicleId={vehicle.id}
                currentMileage={getEffectiveMileage(vehicle)}
                registrationNumber={vehicle.registrationNumber}
              />
            ))}
          </div>
          {vehicles && vehicles.length > 9 && (
            <CardShell>
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400">
                  Affichage des 9 premiers véhicules.{" "}
                  <Link href="/vehicles"><span className="text-green-600 hover:underline cursor-pointer">Voir tous les véhicules</span></Link>
                </p>
              </div>
            </CardShell>
          )}
        </TabsContent>

        {/* ── CPC ── */}
        <TabsContent value="cpc" className="space-y-4">
          <KpiGrid columns={3}>
            <KpiTile
              data-testid="secretary-kpi-cpc-formed"
              label="Chauffeurs formés"
              value={statDisplay(cpcStatsView, cpcFormed)}
              subValue={cpcTotal !== null ? `/ ${cpcTotal} total` : undefined}
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
            <KpiTile
              data-testid="secretary-kpi-cpc-to-form"
              label="À former"
              value={statDisplay(cpcStatsView, cpcToTrain)}
              subValue="Alertes actives"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName={isPositive(cpcToTrain) ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
              valueClassName={isPositive(cpcToTrain) ? "text-orange-600" : undefined}
            />
            <KpiTile
              data-testid="secretary-kpi-cpc-not-formed"
              label="Non formés"
              value={statDisplay(cpcStatsView, cpcNotFormed)}
              subValue="Nécessite formation"
              icon={<XCircle className="h-4 w-4" />}
              iconWrapperClassName={isPositive(cpcNotFormed) ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
              valueClassName={isPositive(cpcNotFormed) ? "text-red-600" : undefined}
            />
          </KpiGrid>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardShell>
              <div className="px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart2 className="h-4 w-4 text-purple-500" />
                  <span className="text-sm font-semibold text-gray-800">Répartition des Statuts CPC</span>
                </div>
                <CPCStatusChart />
              </div>
            </CardShell>
            <CardShell>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Actions Formation</p>
                <div className="flex flex-col gap-2">
                  <Link href="/drivers">
                    <Button size="sm" className="justify-start gap-2 w-full" data-testid="btn-view-drivers">
                      <Users className="h-3.5 w-3.5" /> Voir les chauffeurs
                    </Button>
                  </Link>
                  <Link href="/workflows">
                    <Button variant="outline" size="sm" className="justify-start gap-2 w-full" data-testid="btn-manage-cpc">
                      <ClipboardList className="h-3.5 w-3.5" /> Gérer les formations
                    </Button>
                  </Link>
                </div>
              </div>
            </CardShell>
          </div>

          <CPCAlertsPanel />

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">Mise à jour des certifications CPC</p>
              <p className="text-xs text-gray-400 mb-3">Mettez à jour les dates de formation CPC pour les chauffeurs nécessitant une certification.</p>
            </div>
          </CardShell>
          {driversView.kind === "error" && (
            <InlineQueryError
              error={driversView.error}
              fallback="La liste des chauffeurs est momentanément indisponible."
              onRetry={() => void driversStatusQuery.refetch()}
              isRetrying={driversView.isRetrying}
              data-testid="secretary-drivers-error"
            />
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {drivers?.slice(0, 6).map((driver) => (
              <CPCUpdateForm
                key={driver.id}
                driverId={driver.id}
                driverName={`${driver.firstName} ${driver.lastName}`}
                currentCPCDate={driver.cpcTrainingDate}
                currentStatus={driver.cpcStatus}
              />
            ))}
          </div>
          {drivers && drivers.length > 6 && (
            <CardShell>
              <div className="px-5 py-3 text-center">
                <p className="text-xs text-gray-400">
                  Affichage des 6 premiers chauffeurs.{" "}
                  <Link href="/drivers"><span className="text-green-600 hover:underline cursor-pointer">Voir tous les chauffeurs</span></Link>
                </p>
              </div>
            </CardShell>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
