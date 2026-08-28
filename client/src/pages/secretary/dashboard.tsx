import { useQuery } from "@tanstack/react-query";
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

interface SecretaryVehicle {
  id: number;
  registrationNumber: string;
  mileage: number | null;
  lastMileage: number | null;
  currentKilometers: number | null;
}

const getEffectiveMileage = (v: SecretaryVehicle) =>
  Math.max(v.lastMileage ?? 0, v.mileage ?? 0, v.currentKilometers ?? 0);

export default function SecretaryDashboard() {
  const { user } = useAuth();
  const canAddVehicle = canManageFleetVehicles(user);
  const { data: vehicles } = useQuery<SecretaryVehicle[]>({ queryKey: ["/api/vehicles/all"] });
  const { data: alerts } = useQuery<any[]>({ queryKey: ["/api/alerts"] });
  const { data: documentStats } = useQuery<any>({ queryKey: ["/api/vehicles/document-stats"] });
  const { data: cpcStats } = useQuery<any>({ queryKey: ["/api/drivers/cpc-statistics"] });
  const { data: driversStatus } = useQuery<any[]>({ queryKey: ["/api/drivers/cpc-status"] });
  const { data: statsByClient } = useQuery<any[]>({ queryKey: ["/api/operations/stats/by-client"] });
  const { data: invoicesSummary } = useQuery<any>({ queryKey: ["/api/billing/invoices/summary"] });

  const clientsData = Array.isArray(statsByClient) ? statsByClient : [];
  const totalRevenue = clientsData.reduce((s: number, c: any) => s + (c.totalRevenue || 0), 0);
  const totalCost = clientsData.reduce((s: number, c: any) => s + (c.totalCost || 0), 0);
  const totalMissions = clientsData.reduce((s: number, c: any) => s + (c.totalMissions || 0), 0);
  const alertsCount = Array.isArray(alerts) ? alerts.length : 0;
  const vehiclesCount = Array.isArray(vehicles) ? vehicles.length : 0;
  const expiringDocumentsSoon =
    Number(documentStats?.expiringCarteGrise || 0) +
    Number(documentStats?.expiringAssurance || 0) +
    Number(documentStats?.expiringVisiteTechnique || 0);
  const expiredDocuments =
    Number(documentStats?.expiredCarteGrise || 0) +
    Number(documentStats?.expiredAssurance || 0) +
    Number(documentStats?.expiredVisiteTechnique || 0);
  const documentsToRenew = expiringDocumentsSoon + expiredDocuments;
  const totalInvoices = Number(invoicesSummary?.total || 0);
  const pendingInvoices = Number(invoicesSummary?.pending || 0);
  const paidInvoices = Number(invoicesSummary?.paid || 0);
  const cpcFormed = Number(cpcStats?.forme || 0);
  const cpcToTrain = Number(cpcStats?.aFormer || 0);
  const cpcNotFormed = Number(cpcStats?.nonForme || 0);
  const cpcTotal = Number(cpcStats?.total || 0);

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
            value={alertsCount}
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
            value={vehiclesCount}
            subValue="Dans la flotte"
            icon={<Truck className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            data-testid="secretary-kpi-documents"
            label="Documents à renouveler"
            value={documentsToRenew}
            subValue={`${expiredDocuments} expiré(s) · ${expiringDocumentsSoon} à venir`}
            icon={<FileText className="h-4 w-4" />}
            iconWrapperClassName={documentsToRenew > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
            valueClassName={documentsToRenew > 0 ? "text-red-600" : undefined}
          />
          <KpiTile
            data-testid="secretary-kpi-missions"
            label="Missions totales"
            value={totalMissions}
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
                    <span className="text-sm text-gray-600">{alertsCount} alerte(s) à traiter</span>
                  </div>
                  <div className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                    <Car className="h-3.5 w-3.5 text-blue-500" />
                    <span className="text-sm text-gray-600">{vehiclesCount} véhicule(s) enregistré(s)</span>
                  </div>
                  <div className="flex items-center gap-2 py-1.5">
                    <FileText className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-sm text-gray-600">{documentsToRenew} document(s) à renouveler</span>
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
              value={totalMissions}
              subValue="Toutes missions"
              icon={<Truck className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
            <KpiTile
              data-testid="secretary-kpi-revenue"
              label="Chiffre d'affaires"
              value={formatPrice(totalRevenue)}
              subValue="Facturé clients"
              icon={<Banknote className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
            <KpiTile
              data-testid="secretary-kpi-costs"
              label="Coûts totaux"
              value={formatPrice(totalCost)}
              subValue="Coûts opérationnels"
              icon={<BarChart2 className="h-4 w-4" />}
              iconWrapperClassName="bg-red-50 text-red-600"
            />
          </KpiGrid>

          <CardShell>
            <div className="px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Statistiques par Client</p>
              <div className="space-y-2">
                {clientsData.map((client: any) => (
                  <div key={client.clientName} className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-800">{client.clientName}</span>
                      <span className="text-xs text-gray-400">{client.totalMissions} missions</span>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-xs">
                      <div>
                        <p className="text-gray-400">CA</p>
                        <p className="font-semibold text-green-600">{formatPrice(client.totalRevenue || 0)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Coûts</p>
                        <p className="font-semibold text-red-600">{formatPrice(client.totalCost || 0)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Marge</p>
                        <p className="font-semibold text-purple-600">{client.marginPercentage?.toFixed(1)}%</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
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
              value={totalInvoices}
              subValue="Total factures"
              icon={<FileText className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
            />
            <KpiTile
              data-testid="secretary-kpi-pending"
              label="En attente"
              value={pendingInvoices}
              subValue="À encaisser"
              icon={<Clock className="h-4 w-4" />}
              iconWrapperClassName={pendingInvoices > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
              valueClassName={pendingInvoices > 0 ? "text-orange-600" : undefined}
            />
            <KpiTile
              data-testid="secretary-kpi-paid"
              label="Payées"
              value={paidInvoices}
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
                  { label: "Total HT", value: formatPrice(invoicesSummary?.totalAmountHT || 0), bg: "bg-gray-50" },
                  { label: "TVA (19.25%)", value: formatPrice(invoicesSummary?.totalVAT || 0), bg: "bg-gray-50" },
                  { label: "Total TTC", value: formatPrice(invoicesSummary?.totalAmountTTC || 0), bg: "bg-green-50", bold: true },
                  { label: "Solde restant", value: formatPrice(invoicesSummary?.totalBalance || 0), bg: "bg-orange-50", orange: true },
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.isArray(vehicles) && vehicles.slice(0, 9).map((vehicle) => (
              <MileageUpdateForm
                key={vehicle.id}
                vehicleId={vehicle.id}
                currentMileage={getEffectiveMileage(vehicle)}
                registrationNumber={vehicle.registrationNumber}
              />
            ))}
          </div>
          {Array.isArray(vehicles) && vehicles.length > 9 && (
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
              value={cpcFormed}
              subValue={`/ ${cpcTotal} total`}
              icon={<CheckCircle2 className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
            />
            <KpiTile
              data-testid="secretary-kpi-cpc-to-form"
              label="À former"
              value={cpcToTrain}
              subValue="Alertes actives"
              icon={<AlertTriangle className="h-4 w-4" />}
              iconWrapperClassName={cpcToTrain > 0 ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-400"}
              valueClassName={cpcToTrain > 0 ? "text-orange-600" : undefined}
            />
            <KpiTile
              data-testid="secretary-kpi-cpc-not-formed"
              label="Non formés"
              value={cpcNotFormed}
              subValue="Nécessite formation"
              icon={<XCircle className="h-4 w-4" />}
              iconWrapperClassName={cpcNotFormed > 0 ? "bg-red-50 text-red-600" : "bg-gray-100 text-gray-400"}
              valueClassName={cpcNotFormed > 0 ? "text-red-600" : undefined}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.isArray(driversStatus) && driversStatus.slice(0, 6).map((driver: any) => (
              <CPCUpdateForm
                key={driver.id}
                driverId={driver.id}
                driverName={`${driver.firstName} ${driver.lastName}`}
                currentCPCDate={driver.cpcTrainingDate}
                currentStatus={driver.cpcStatus}
              />
            ))}
          </div>
          {Array.isArray(driversStatus) && driversStatus.length > 6 && (
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
