import { useParams, useLocation } from "wouter";
import { invalidateDriverCpcDependents } from "@/lib/driver-cpc-invalidation";
import { buildDriverPatchPayload } from "@/lib/driver-patch-payload";
import { userMessageOf } from "@/lib/api-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { canManageDrivers } from "@shared/constants/roles";
import { CPCUpdateForm } from "@/components/drivers/cpc-update-form";
import { normalizeCpcStatus } from "@shared/constants/driver-cpc-eligibility";
import { driverLicenseDaysLabel, getDriverLicenseStatus } from "@/lib/driver-license-status";
import {
  ArrowLeft, Users, CheckCircle, AlertTriangle, XCircle, CreditCard,
  GraduationCap, Calendar, IdCard, Truck, MapPin, Clock, Pencil,
} from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { DeadlineTile, PremiumTabsNav } from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

interface DriverDetail {
  id: number;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  birthDate: string | null;
  cniNumber: string | null;
  cniExpiry: string | null;
  licenseNumber: string | null;
  licenseExpiry: string | null;
  hireDate: string | null;
  geoTrainingDate: string | null;
  cpcTrainingDate: string | null;
  cpcStatus: "FORMÉ" | "À FORMER" | "NON FORMÉ";
  expiryDate: string | null;
  daysRemaining: number;
  isActive: boolean;
}

interface DriverMission {
  id: number;
  orderNumber: string;
  status: string;
  pickupAddress: string | null;
  deliveryAddress: string | null;
  pickupDate: string | null;
  deliveryDate: string | null;
  clientName: string | null;
  vehicleRegistration: string | null;
  vehicleModel: string | null;
}

const cpcBadge = (status: string) => {
  if (normalizeCpcStatus(status) === "FORME")
    return <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" />FORMÉ</span>;
  if (normalizeCpcStatus(status) === "A FORMER")
    return <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />À FORMER</span>;
  return <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700 inline-flex items-center gap-1"><XCircle className="w-3 h-3" />NON FORMÉ</span>;
};

const licenseBadge = (expiry: string | null) => {
  const { state, days } = getDriverLicenseStatus(expiry);
  if (state === "none") return <span className="text-[10px] text-gray-400 font-medium">Non renseigné</span>;
  if (state === "expired") return <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700 inline-flex items-center gap-1"><XCircle className="w-3 h-3" />Expiré</span>;
  if (state === "soon") return <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-orange-100 text-orange-700 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{driverLicenseDaysLabel(days!, " restants")}</span>;
  if (state === "warning") return <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-700 inline-flex items-center gap-1"><Clock className="w-3 h-3" />{driverLicenseDaysLabel(days!, " restants")}</span>;
  return <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1"><CheckCircle className="w-3 h-3" />Valide</span>;
};

const missionStatusBadge = (status: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    planned:     { label: "Planifiée",   cls: "bg-blue-100 text-blue-700" },
    assigned:    { label: "Assignée",    cls: "bg-purple-100 text-purple-700" },
    in_progress: { label: "En cours",   cls: "bg-orange-100 text-orange-700" },
    completed:   { label: "Terminée",   cls: "bg-green-100 text-green-700" },
    cancelled:   { label: "Annulée",    cls: "bg-gray-100 text-gray-500" },
  };
  const s = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-500" };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
};

export default function DriverDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { user } = useAuth();
  // Même source que le middleware `isDriverManager`: aucun rôle ne doit voir
  // une action qui finira en 403.
  const peutGererChauffeurs = canManageDrivers(user?.role);
  const [form, setForm] = useState<Partial<DriverDetail>>({});

  const { data: driver, isLoading } = useQuery<DriverDetail>({
    queryKey: [`/api/drivers/${id}`],
  });

  const { data: driverMissions } = useQuery<DriverMission[]>({
    queryKey: [`/api/drivers/${id}/missions`],
    enabled: !!id,
  });

  const editMutation = useMutation({
    mutationFn: (data: Partial<DriverDetail>) =>
      apiRequest("PATCH", `/api/drivers/${id}`, buildDriverPatchPayload(data, driver?.cpcTrainingDate)),
    onSuccess: () => {
      invalidateDriverCpcDependents(queryClient, id);
      setEditOpen(false);
      toast({ title: "Chauffeur mis à jour" });
    },
    onError: (error) =>
      toast({ title: userMessageOf(error, "Erreur lors de la mise à jour"), variant: "destructive" }),
  });

  const openEdit = () => {
    if (!driver) return;
    setForm({
      firstName: driver.firstName,
      lastName: driver.lastName,
      employeeNumber: driver.employeeNumber ?? "",
      birthDate: driver.birthDate ?? "",
      licenseNumber: driver.licenseNumber ?? "",
      licenseExpiry: driver.licenseExpiry ?? "",
      hireDate: driver.hireDate ?? "",
      cniNumber: driver.cniNumber ?? "",
      cniExpiry: driver.cniExpiry ?? "",
      cpcTrainingDate: driver.cpcTrainingDate ?? "",
      geoTrainingDate: driver.geoTrainingDate ?? "",
    });
    setEditOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500" />
      </div>
    );
  }

  if (!driver) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Users className="h-10 w-10 text-gray-300 mb-3" />
        <p className="text-sm font-medium text-gray-500">Chauffeur introuvable</p>
        <Button variant="ghost" size="sm" className="mt-3" onClick={() => setLocation("/drivers")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Retour
        </Button>
      </div>
    );
  }

  const cpcDays = driver.daysRemaining;
  const cpcDaysLabel = driver.cpcTrainingDate
    ? cpcDays < 0 ? `Expiré (${Math.abs(cpcDays)}j)` : `${cpcDays}j restants`
    : "—";
  const cpcDaysColor = cpcDays < 0 ? "text-red-600" : cpcDays <= 30 ? "text-orange-600" : cpcDays <= 90 ? "text-yellow-600" : "text-green-600";

  const kpis = [
    {
      label: "Qualification CPC",
      value: cpcBadge(driver.cpcStatus),
      icon: <GraduationCap className="h-4 w-4 text-green-600" />,
      iconBg: "bg-green-50",
    },
    {
      label: "Validité CPC",
      value: <span className={`text-[15px] font-bold ${cpcDaysColor}`}>{cpcDaysLabel}</span>,
      icon: <Calendar className="h-4 w-4 text-blue-500" />,
      iconBg: "bg-blue-50",
    },
    {
      label: "Permis de conduire",
      value: licenseBadge(driver.licenseExpiry),
      icon: <CreditCard className="h-4 w-4 text-purple-500" />,
      iconBg: "bg-purple-50",
    },
    {
      label: "Missions effectuées",
      value: <span className="text-[15px] font-bold text-gray-800">{driverMissions?.length ?? "—"}</span>,
      icon: <Truck className="h-4 w-4 text-orange-500" />,
      iconBg: "bg-orange-50",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header card */}
      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm bg-white">
        <div className="h-0.5 bg-gradient-to-r from-green-500 to-emerald-400" />
        <div className="px-5 py-5 md:px-7 md:py-6">
          {/* Back + statut */}
          <div className="flex items-start justify-between mb-5">
            <Button variant="ghost" size="sm" className="-ml-1 text-muted-foreground" onClick={() => setLocation("/drivers")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Chauffeurs
            </Button>
            <div className="flex gap-2 items-center">
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${driver.isActive ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {driver.isActive ? "Actif" : "Inactif"}
              </span>
              {cpcBadge(driver.cpcStatus)}
              {peutGererChauffeurs && (
                <Button size="sm" variant="outline" className="h-7 px-3 text-xs gap-1.5" onClick={openEdit}>
                  <Pencil className="h-3.5 w-3.5" /> Modifier
                </Button>
              )}
            </div>
          </div>

          {/* Titre */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-green-50 border border-green-100 flex items-center justify-center">
              <Users className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-widest text-green-600">RH · Chauffeur</span>
              <h1 className="text-xl font-bold text-gray-900">{driver.firstName} {driver.lastName}</h1>
              <p className="text-[11px] text-gray-400 mt-0.5">
                {driver.employeeNumber ? `N° ${driver.employeeNumber}` : "Sans matricule"}
                {driver.birthDate ? ` · Né le ${formatDate(driver.birthDate)}` : ""}
              </p>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-gray-100">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3.5 flex flex-col gap-1">
                <div className={`w-8 h-8 rounded-lg ${kpi.iconBg} flex items-center justify-center`}>{kpi.icon}</div>
                <p className="text-[11px] font-medium text-gray-500 mt-1">{kpi.label}</p>
                <div className="text-[15px] font-bold text-gray-800">{kpi.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="info">
        <PremiumTabsNav tabs={[
          { value: "info", label: "Informations", icon: <TabIcon icon={IdCard} /> },
          { value: "missions", label: `Missions (${driverMissions?.length ?? 0})`, icon: <TabIcon icon={Truck} /> },
        ]} />

        {/* Informations */}
        <TabsContent value="info" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Permis & identité */}
            <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-purple-50 flex items-center justify-center">
                  <CreditCard className="h-3.5 w-3.5 text-purple-600" />
                </div>
                <span className="text-sm font-semibold text-gray-800">Permis & Identité</span>
              </div>
              <div className="px-5 py-4 space-y-3">
                {[
                  { label: "N° Permis", value: driver.licenseNumber || "—" },
                  { label: "Expiration permis", value: driver.licenseExpiry ? formatDate(driver.licenseExpiry) : "—", extra: licenseBadge(driver.licenseExpiry) },
                  { label: "N° CNI", value: driver.cniNumber || "—" },
                  { label: "Expiration CNI", value: driver.cniExpiry ? formatDate(driver.cniExpiry) : "—" },
                  { label: "Date de naissance", value: driver.birthDate ? formatDate(driver.birthDate) : "—" },
                  { label: "Date d'embauche", value: driver.hireDate ? formatDate(driver.hireDate) : "—" },
                ].map(({ label, value, extra }) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-xs text-gray-500">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-800">{value}</span>
                      {extra}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Formation CPC */}
            <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                  <GraduationCap className="h-3.5 w-3.5 text-green-600" />
                </div>
                <span className="text-sm font-semibold text-gray-800">Formation CPC</span>
              </div>
              <div className="px-5 py-4 space-y-3">
                {/* L'échéance CPC passe par la tuile partagée: date, jours restants
                    et couleur y sont calculés une seule fois, avec le même seuil
                    et le même vocabulaire que les échéances véhicule. */}
                <DeadlineTile
                  label="Expiration CPC"
                  date={driver.expiryDate}
                  icon={<GraduationCap className="h-4 w-4" />}
                  emptyLabel="Aucune formation enregistrée"
                  data-testid="driver-deadline-cpc"
                />

                {[
                  { label: "Statut CPC", value: cpcBadge(driver.cpcStatus) },
                  { label: "Date formation", value: driver.cpcTrainingDate ? formatDate(driver.cpcTrainingDate) : "—" },
                  { label: "Formation GEO", value: driver.geoTrainingDate ? formatDate(driver.geoTrainingDate) : "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-xs text-gray-500">{label}</span>
                    <div className="text-xs font-semibold text-gray-800">{value}</div>
                  </div>
                ))}

                {/* Même garde que POST /api/drivers/:id/update-cpc (isDriverManager) :
                    le formulaire n'est pas affiché aux rôles qui recevraient un 403. */}
                {peutGererChauffeurs && (
                  <CPCUpdateForm
                    driverId={driver.id}
                    driverName={`${driver.firstName} ${driver.lastName}`}
                    currentCPCDate={driver.cpcTrainingDate}
                    currentStatus={driver.cpcStatus}
                    embedded
                  />
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Missions */}
        <TabsContent value="missions">
          <div className="rounded-2xl border border-gray-100 shadow-sm bg-white overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-orange-50 flex items-center justify-center">
                <Truck className="h-3.5 w-3.5 text-orange-600" />
              </div>
              <span className="text-sm font-semibold text-gray-800">
                {driverMissions?.length ?? 0} mission{(driverMissions?.length ?? 0) > 1 ? "s" : ""}
              </span>
            </div>
            {!driverMissions || driverMissions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Truck className="h-8 w-8 text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-400">Aucune mission enregistrée</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-5 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">N° Ordre</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Client</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Trajet</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Départ</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Véhicule</th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-gray-400">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {driverMissions.map((m) => (
                      <tr
                        key={m.id}
                        onClick={() => setLocation(`/missions/${m.id}`)}
                        className="group border-b border-gray-50 last:border-0 hover:bg-gray-50/60 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5 font-mono text-xs text-gray-500">{m.orderNumber}</td>
                        <td className="px-4 py-3.5 text-xs font-semibold text-gray-700">{m.clientName || "—"}</td>
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-1.5 text-xs text-gray-500 max-w-[200px]">
                            <MapPin className="h-3 w-3 text-gray-300 shrink-0" />
                            <span className="truncate">{m.pickupAddress || "—"} → {m.deliveryAddress || "—"}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-gray-500">{m.pickupDate ? formatDate(m.pickupDate) : "—"}</td>
                        <td className="px-4 py-3.5 text-xs font-mono text-gray-400">{m.vehicleRegistration || "—"}</td>
                        <td className="px-4 py-3.5">{missionStatusBadge(m.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Modale édition */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-green-50 flex items-center justify-center">
                <Pencil className="h-3.5 w-3.5 text-green-600" />
              </div>
              Modifier le chauffeur
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            {[
              { key: "firstName", label: "Prénom", type: "text" },
              { key: "lastName", label: "Nom", type: "text" },
              { key: "employeeNumber", label: "N° Employé", type: "text" },
              { key: "birthDate", label: "Date de naissance", type: "date" },
              { key: "licenseNumber", label: "N° Permis", type: "text" },
              { key: "licenseExpiry", label: "Expiration permis", type: "date" },
              { key: "hireDate", label: "Date d'embauche", type: "date" },
              { key: "cniNumber", label: "N° CNI", type: "text" },
              { key: "cniExpiry", label: "Expiration CNI", type: "date" },
              { key: "cpcTrainingDate", label: "Date formation CPC", type: "date" },
              { key: "geoTrainingDate", label: "Date formation GEO", type: "date" },
            ].map(({ key, label, type }) => (
              <div key={key} className="space-y-1">
                <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</Label>
                <Input
                  type={type}
                  value={(form as any)[key] ?? ""}
                  onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.value || null }))}
                  className="h-8 text-sm rounded-lg border-gray-200"
                />
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>Annuler</Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              disabled={editMutation.isPending}
              onClick={() => editMutation.mutate(form)}
            >
              {editMutation.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}