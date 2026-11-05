import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Search, RefreshCw, AlertTriangle, CheckCircle, XCircle, Users, GraduationCap, Clock, Eye, UserPlus, EyeOff,
} from "lucide-react";
import { CPCStatusChart } from "@/components/charts/cpc-status-chart";
import { HeaderCard, KpiGrid, KpiTile, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import { canManageDrivers } from "@shared/constants/roles";
import { normalizeCpcStatus } from "@shared/constants/driver-cpc-eligibility";
import { driverLicenseDaysLabel, getDriverLicenseStatus } from "@/lib/driver-license-status";
import { DriverForm, type DriverFormData } from "@/components/drivers/driver-form";

interface DriverCPCStatus {
  id: number;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  cpcStatus: 'FORMÉ' | 'À FORMER' | 'NON FORMÉ';
  cpcTrainingDate: string | null;
  expiryDate: string | null;
  daysRemaining: number;
  isActive: boolean;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  birthDate: string | null;
  hireDate: string | null;
}

interface CPCStatistics {
  total: number;
  forme: number;
  aFormer: number;
  nonForme: number;
  inactiveDrivers: number;
}

const getLicenseBadge = (licenseExpiry: string | null) => {
  const { state, days } = getDriverLicenseStatus(licenseExpiry);
  if (state === "none") return <span className="text-[10px] text-gray-400">—</span>;
  if (state === "expired") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 inline-flex items-center gap-1"><XCircle className="w-3 h-3" />Expiré</span>;
  if (state === "soon") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{driverLicenseDaysLabel(days!)}</span>;
  if (state === "warning") return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{driverLicenseDaysLabel(days!)}</span>;
  return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" />Valide</span>;
};

export default function DriversIndex() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createAccountDialog, setCreateAccountDialog] = useState<{ open: boolean; driver: any | null }>({ open: false, driver: null });
  const [createAccountForm, setCreateAccountForm] = useState({ email: "", pin: "", showPin: false });
  const [createAccountLoading, setCreateAccountLoading] = useState(false);
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<DriverFormData | null>(null);

  const { user } = useAuth();
  // Aligné sur `isDriverManager` côté serveur via la constante partagée: pas de
  // bouton qui finirait en 403.
  const peutGererChauffeurs = canManageDrivers(user?.role);

  const { data: drivers, isLoading, refetch } = useQuery<DriverCPCStatus[]>({
    queryKey: ["/api/drivers"],
  });

  const { data: stats } = useQuery<CPCStatistics>({
    queryKey: ["/api/drivers/cpc-statistics"],
  });

  const filteredDrivers = drivers?.filter(driver => {
    const matchesSearch =
      driver.firstName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.lastName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.employeeNumber?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === "all" ||
      normalizeCpcStatus(driver.cpcStatus) === normalizeCpcStatus(statusFilter) ||
      (statusFilter === "active" && driver.isActive) ||
      (statusFilter === "inactive" && !driver.isActive);
    return matchesSearch && matchesStatus;
  }) || [];

  const getStatusBadge = (status: string) => {
    if (normalizeCpcStatus(status) === 'FORME') return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" />FORMÉ</span>;
    if (normalizeCpcStatus(status) === 'A FORMER') return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />À FORMER</span>;
    return <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 inline-flex items-center gap-1"><XCircle className="w-3 h-3" />NON FORMÉ</span>;
  };

  const getUrgencyColor = (days: number) => {
    if (days < 0) return "text-red-600";
    if (days <= 30) return "text-orange-600";
    if (days <= 59) return "text-yellow-600";
    return "text-green-600";
  };

  const getUrgencyDot = (days: number) => {
    if (days < 0) return "bg-red-500";
    if (days <= 30) return "bg-orange-500";
    if (days <= 59) return "bg-yellow-400";
    return "bg-green-500";
  };

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!createAccountDialog.driver) return;
    setCreateAccountLoading(true);
    try {
      const res = await fetch(`/api/drivers/${createAccountDialog.driver.id}/create-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: createAccountForm.email, pin: createAccountForm.pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Erreur", description: data.message || "Erreur serveur", variant: "destructive" });
      } else {
        toast({ title: "Compte créé", description: `Identifiant : ${data.user?.username}` });
        setCreateAccountDialog({ open: false, driver: null });
        setCreateAccountForm({ email: "", pin: "", showPin: false });
        // Resync ciblé (AGENTS §2) : fiche liée et compteurs.
        queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      }
    } catch {
      toast({ title: "Erreur", description: "Erreur réseau", variant: "destructive" });
    } finally {
      setCreateAccountLoading(false);
    }
  }

  const filterButtons = [
    { value: "all", label: "Tous" },
    { value: "FORMÉ", label: "Formés", testId: "filter-formed" },
    { value: "À FORMER", label: "À Former", testId: "filter-toform" },
    { value: "NON FORMÉ", label: "Non Formés", testId: "filter-notformed" },
  ];

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="RH · Chauffeurs"
        title="Gestion des Chauffeurs"
        subtitle="Formation CPC et informations des chauffeurs"
        icon={<Users className="h-5 w-5" />}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 h-8 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Actualiser
            </Button>
            {peutGererChauffeurs && (
              <Button size="sm" onClick={() => setDriverDialogOpen(true)} className="gap-2 h-8 text-xs" data-testid="btn-create-driver">
                <UserPlus className="h-3.5 w-3.5" /> Nouveau chauffeur
              </Button>
            )}
          </div>
        }
      >
        <KpiGrid columns={4}>
          <KpiTile
            label="Total Chauffeurs"
            value={drivers?.length || 0}
            subValue={`${drivers?.filter(d => d.isActive).length || 0} actifs`}
            icon={<Users className="h-4 w-4" />}
            iconWrapperClassName="bg-gray-100 text-gray-500"
          />
          <KpiTile
            label="Formés"
            value={drivers?.filter(d => normalizeCpcStatus(d.cpcStatus) === 'FORME').length || 0}
            subValue="CPC à jour"
            icon={<CheckCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
            valueClassName="text-green-600"
          />
          <KpiTile
            label="À Former"
            value={drivers?.filter(d => normalizeCpcStatus(d.cpcStatus) === 'A FORMER').length || 0}
            subValue="Formation à renouveler"
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-500"
            valueClassName="text-orange-600"
          />
          <KpiTile
            label="Non Formés"
            value={drivers?.filter(d => normalizeCpcStatus(d.cpcStatus) === 'NON FORME').length || 0}
            subValue="Sans formation CPC"
            icon={<XCircle className="h-4 w-4" />}
            iconWrapperClassName="bg-red-50 text-red-500"
            valueClassName="text-red-600"
          />
        </KpiGrid>
      </HeaderCard>

      <Tabs defaultValue="list">
        <PremiumTabsNav tabs={[
          { value: "list", label: "Liste des Chauffeurs", icon: <TabIcon icon={Users} /> },
          { value: "stats", label: "Statistiques CPC", icon: <TabIcon icon={GraduationCap} /> },
        ]} />

        {/* Liste */}
        <TabsContent value="list" className="space-y-4">
          {/* Filtres */}
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="px-5 py-3.5 flex flex-col md:flex-row gap-3 items-start md:items-center">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                <input
                  placeholder="Rechercher par nom, prénom ou matricule..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="input-search-drivers"
                  className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-400 transition-all placeholder:text-gray-400"
                />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {filterButtons.map(({ value, label, testId }) => (
                  <button
                    key={value}
                    onClick={() => setStatusFilter(value)}
                    data-testid={testId || `filter-${value}`}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      statusFilter === value ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-green-50 flex items-center justify-center">
                <Users className="h-3.5 w-3.5 text-green-600" />
              </div>
              <span className="text-sm font-semibold text-gray-800">
                {filteredDrivers.length} chauffeur{filteredDrivers.length > 1 ? "s" : ""}
                {searchQuery && ` · "${searchQuery}"`}
              </span>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-500" />
              </div>
            ) : filteredDrivers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center mb-3">
                  <Users className="h-5 w-5 text-gray-300" />
                </div>
                <p className="text-sm font-medium text-gray-500">Aucun chauffeur trouvé</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="table-drivers">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Urgence</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Chauffeur</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">N° Employé</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Qualification CPC</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Date Formation</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Expiration CPC</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Validité CPC</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Permis</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Âge</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Expérience</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Statut</th>
                      <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDrivers.map((driver) => (
                      <tr
                        key={driver.id}
                        onClick={() => setLocation(`/drivers/${driver.id}`)}
                        className="group border-b border-gray-50 last:border-0 transition-colors hover:bg-gray-50/60 cursor-pointer"
                        data-testid={`row-driver-${driver.id}`}
                      >
                        <td className="px-5 py-3.5">
                          <span className={`w-2.5 h-2.5 rounded-full inline-block ${getUrgencyDot(driver.daysRemaining)}`} />
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-gray-800">
                          {driver.firstName} {driver.lastName}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-xs text-gray-400">
                          {driver.employeeNumber || "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          {getStatusBadge(driver.cpcStatus)}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-500">
                          {driver.cpcTrainingDate ? formatDate(driver.cpcTrainingDate) : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-500">
                          {driver.expiryDate ? formatDate(driver.expiryDate) : "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-sm font-bold ${getUrgencyColor(driver.daysRemaining)}`}>
                            {driver.cpcTrainingDate
                              ? driver.daysRemaining < 0
                                ? `Expiré (${Math.abs(driver.daysRemaining)}j)`
                                : `${driver.daysRemaining}j`
                              : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5">
                          {getLicenseBadge(driver.licenseExpiry)}
                        </td>
                        <td className="px-4 py-3.5 text-xs font-semibold text-gray-600">
                          {driver.birthDate
                            ? `${Math.floor((Date.now() - new Date(driver.birthDate).getTime()) / (365.25 * 24 * 3600 * 1000))} ans`
                            : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-xs font-semibold text-gray-600">
                          {driver.hireDate
                            ? (() => {
                                const yrs = Math.floor((Date.now() - new Date(driver.hireDate).getTime()) / (365.25 * 24 * 3600 * 1000));
                                return yrs < 1 ? "< 1 an" : `${yrs} an${yrs > 1 ? "s" : ""}`;
                              })()
                            : "—"}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${driver.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {driver.isActive ? "Actif" : "Inactif"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50"
                              title="Créer compte utilisateur"
                              onClick={(e) => { e.stopPropagation(); setCreateAccountDialog({ open: true, driver }); setCreateAccountForm({ email: "", pin: "", showPin: false }); }}
                            >
                              <UserPlus className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2.5 text-xs text-gray-500 hover:text-green-700 hover:bg-green-50"
                              onClick={() => setLocation(`/drivers/${driver.id}`)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" /> Voir
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Statistiques */}
        <TabsContent value="stats" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* CPC Status chart */}
            <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
              <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                  <GraduationCap className="h-3.5 w-3.5 text-green-600" />
                </div>
                <span className="text-sm font-semibold text-gray-800">Répartition des Statuts CPC</span>
              </div>
              <div className="p-5">
                <CPCStatusChart />
              </div>
            </div>

            {/* Statistiques détaillées */}
            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
                <div className="h-0.5 bg-gradient-to-r from-blue-500 to-sky-400" />
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Users className="h-3.5 w-3.5 text-blue-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">Statistiques Détaillées</span>
                </div>
                <div className="px-5 py-4 space-y-2">
                  {[
                    { label: "Chauffeurs Formés", value: stats?.forme || 0, color: "text-green-600", bg: "bg-green-50", icon: CheckCircle },
                    { label: "À Former (Urgent)", value: stats?.aFormer || 0, color: "text-orange-600", bg: "bg-orange-50", icon: AlertTriangle },
                    { label: "Non Formés", value: stats?.nonForme || 0, color: "text-red-600", bg: "bg-red-50", icon: XCircle },
                    { label: "Total Chauffeurs", value: stats?.total || 0, color: "text-gray-700", bg: "bg-gray-50", icon: Users },
                  ].map(({ label, value, color, bg, icon: Icon }) => (
                    <div key={label} className={`flex items-center justify-between rounded-xl ${bg} px-4 py-3`}>
                      <div className="flex items-center gap-2">
                        <Icon className={`w-4 h-4 ${color}`} />
                        <span className="text-sm font-medium text-gray-700">{label}</span>
                      </div>
                      <span className={`text-xl font-bold ${color}`}>{value}</span>
                    </div>
                  ))}
                </div>
                <div className="px-5 pb-4 pt-2 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-widest">Légende urgence</p>
                  <ul className="space-y-1 text-xs text-gray-500">
                    <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500" />Formation valide (plus de 59 jours)</li>
                    <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-yellow-400" />Attention : 30 à 59 jours restants</li>
                    <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-orange-500" />Urgent : moins de 30 jours restants</li>
                    <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-red-500" />Critique : Formation expirée</li>
                  </ul>
                </div>
              </div>

              {/* Actions urgentes */}
              <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
                <div className="h-0.5 bg-gradient-to-r from-orange-400 to-red-400" />
                <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-orange-50 flex items-center justify-center">
                    <AlertTriangle className="h-3.5 w-3.5 text-orange-600" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">Actions Urgentes Requises</span>
                </div>
                <div className="px-5 py-4">
                  {drivers?.filter(d => d.daysRemaining < 30 && d.isActive).length === 0 ? (
                    <div className="flex flex-col items-center py-6 text-center">
                      <CheckCircle className="w-10 h-10 text-green-500 mb-2 opacity-60" />
                      <p className="text-sm text-gray-500">Tous les chauffeurs actifs sont à jour !</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {drivers
                        ?.filter(d => d.daysRemaining < 30 && d.isActive)
                        .sort((a, b) => a.daysRemaining - b.daysRemaining)
                        .map((driver) => (
                          <div
                            key={driver.id}
                            className={`rounded-xl border px-4 py-3 ${
                              driver.daysRemaining < 0 ? "bg-red-50 border-red-200" : "bg-orange-50 border-orange-200"
                            }`}
                            data-testid={`urgent-driver-${driver.id}`}
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-semibold text-gray-800">
                                  {driver.firstName} {driver.lastName}
                                </p>
                                {driver.employeeNumber && (
                                  <p className="text-xs text-gray-500 mt-0.5">N° {driver.employeeNumber}</p>
                                )}
                                <div className="flex gap-3 mt-1 text-xs text-gray-500">
                                  {driver.cpcTrainingDate && <span>Formation: {formatDate(driver.cpcTrainingDate)}</span>}
                                  {driver.expiryDate && <span>Expire: {formatDate(driver.expiryDate)}</span>}
                                </div>
                              </div>
                              <Badge
                                variant={driver.daysRemaining < 0 ? "destructive" : "default"}
                                className={driver.daysRemaining < 0 ? "" : "bg-orange-500"}
                              >
                                {driver.daysRemaining < 0
                                  ? `Expiré depuis ${Math.abs(driver.daysRemaining)}j`
                                  : `${driver.daysRemaining}j restants`}
                              </Badge>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Modal Créer compte chauffeur */}
      <Dialog open={createAccountDialog.open} onOpenChange={(open) => { if (!open) setCreateAccountDialog({ open: false, driver: null }); }}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                <UserPlus className="h-4 w-4 text-green-600" />
              </div>
              Créer compte chauffeur
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateAccount} className="space-y-4 pt-1">
            {/* Nom (read-only) */}
            <div className="space-y-1.5">
              <p className="text-[10.5px] font-bold tracking-widest uppercase text-gray-500">Chauffeur</p>
              <div className="h-10 px-3 bg-gray-50 border border-gray-200 rounded-xl flex items-center text-sm text-gray-700 font-medium">
                {createAccountDialog.driver ? `${createAccountDialog.driver.firstName} ${createAccountDialog.driver.lastName}` : ""}
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <p className="text-[10.5px] font-bold tracking-widest uppercase text-gray-500">Email *</p>
              <Input
                type="email"
                required
                placeholder="chauffeur@example.com"
                value={createAccountForm.email}
                onChange={(e) => setCreateAccountForm(f => ({ ...f, email: e.target.value }))}
                className="h-10 rounded-xl bg-gray-50 border-gray-200 text-sm"
              />
            </div>

            {/* PIN */}
            <div className="space-y-1.5">
              <p className="text-[10.5px] font-bold tracking-widest uppercase text-gray-500">PIN (4 chiffres) *</p>
              <div className="relative">
                <Input
                  type={createAccountForm.showPin ? "text" : "password"}
                  required
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  placeholder="••••"
                  value={createAccountForm.pin}
                  onChange={(e) => setCreateAccountForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  className="h-10 rounded-xl bg-gray-50 border-gray-200 text-sm pr-10 tracking-widest"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  onClick={() => setCreateAccountForm(f => ({ ...f, showPin: !f.showPin }))}
                >
                  {createAccountForm.showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-gray-400">Le PIN servira à la connexion mobile du chauffeur.</p>
            </div>

            <DialogFooter className="pt-2 gap-2">
              <Button type="button" variant="outline" size="sm" className="rounded-xl"
                onClick={() => setCreateAccountDialog({ open: false, driver: null })}>
                Annuler
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createAccountLoading || createAccountForm.pin.length !== 4 || !createAccountForm.email}
                className="rounded-xl bg-green-600 hover:bg-green-700 text-white"
              >
                {createAccountLoading ? (
                  <span className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" /> Création…</span>
                ) : (
                  <span className="flex items-center gap-2"><UserPlus className="h-3.5 w-3.5" /> Créer le compte</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Création / modification de chauffeur. La fiche vit ici, sur le module
          métier, et non plus dans Administration > Utilisateurs: c'est un
          dossier de conformité (CNI, permis, CPC), pas un compte de connexion. */}
      <Dialog
        open={driverDialogOpen}
        onOpenChange={(open) => {
          setDriverDialogOpen(open);
          if (!open) setEditingDriver(null);
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingDriver ? "Modifier le chauffeur" : "Nouveau chauffeur"}
            </DialogTitle>
          </DialogHeader>
          <DriverForm
            isEdit={Boolean(editingDriver)}
            initialData={editingDriver ?? undefined}
            onSuccess={() => {
              setDriverDialogOpen(false);
              setEditingDriver(null);
              refetch();
            }}
            onCancel={() => {
              setDriverDialogOpen(false);
              setEditingDriver(null);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
