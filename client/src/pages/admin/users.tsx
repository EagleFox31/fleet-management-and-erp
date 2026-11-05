import { userMessageOf } from "@/lib/api-error";
import { cpcStatusTone, type CpcStatusTone } from "@shared/constants/driver-cpc-eligibility";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  HeaderCard,
  KpiGrid,
  KpiTile,
  PremiumDataTable,
  PremiumTabsNav,
  type PremiumDataTableColumn,
} from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";
import { useAuth } from "@/hooks/useAuth";
import { roleLabelOf } from "@/lib/contextual-help/roles";
import { cn, formatDate } from "@/lib/utils";
import {
  UserPlus,
  Edit,
  Trash2,
  Shield,
  ShieldOff,
  Users,
  Briefcase,
  AlertTriangle,
  CarTaxiFront,
  CheckCircle2,
  UserCog,
  XCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { UserForm } from "@/components/users/user-form";
import { DriverForm, type DriverFormData } from "@/components/drivers/driver-form";
import { useLocation } from "wouter";
import { UsersOverview, type UsersOverviewStats, type UsersOverviewRole } from "@/components/users/users-overview";

interface User {
  id: number;
  username: string;
  email: string;
  name: string;
  role:
    | "admin"
    | "management"
    | "workshop_manager"
    | "technician"
    | "secretary"
    | "logistics"
    | "warehouse"
    | "client"
    | "user";
  createdAt: string;
  loginCount: number;
  lastLoginAt: string | null;
  isOnline?: boolean;
  deletedAt: string | null;
}

interface Driver {
  id: number;
  userId?: number | null;
  firstName: string;
  lastName: string;
  employeeNumber?: string | null;
  birthDate?: string | null;
  licenseNumber?: string | null;
  licenseExpiry?: string | null;
  cniNumber?: string | null;
  cniExpiry?: string | null;
  geoTrainingDate?: string | null;
  cpcTrainingDate?: string | null;
  cpcStatus?: "FORMÉ" | "À FORMER" | "NON FORMÉ" | null;
  cpcStatusUpdatedAt?: string | null;
  daysRemaining?: number;
  expiryDate?: string | null;
  isActive?: boolean | null;
  createdAt?: string | null;
}

interface DriverCpcStatistics {
  total: number;
  forme: number;
  aFormer: number;
  nonForme: number;
  inactiveDrivers: number;
}

const roleOrder: UsersOverviewRole[] = [
  "admin",
  "management",
  "workshop_manager",
  "technician",
  "secretary",
  "logistics",
  "warehouse",
  "client",
  "user",
];

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-destructive/10 text-destructive-text border border-destructive/30",
  management: "bg-slate-100 text-slate-800 border border-slate-300",
  workshop_manager: "bg-blue-50 text-blue-700 border border-blue-200",
  technician: "bg-purple-50 text-purple-700 border border-purple-200",
  secretary: "bg-orange-50 text-orange-700 border border-orange-200",
  logistics: "bg-success/10 text-success border border-success/30",
  warehouse: "bg-warning/10 text-warning-text border border-warning/30",
  client: "bg-gray-100 text-gray-600 border border-gray-200",
  user: "bg-gray-100 text-gray-500 border border-gray-200",
};

const CPC_TONE_CLASSES: Record<CpcStatusTone, string> = {
  success: "bg-success/10 text-success border border-success/30",
  warning: "bg-warning/10 text-warning-text border border-warning/30",
  danger: "bg-destructive/10 text-destructive-text border border-destructive/30",
  neutral: "bg-gray-100 text-gray-500 border border-gray-200",
};

function PresenceDot({ isOnline }: { isOnline?: boolean }) {
  const online = Boolean(isOnline);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        online
          ? "bg-success/10 text-success border-success/30"
          : "bg-gray-50 text-gray-500 border-gray-200"
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-success" : "bg-gray-400")} />
      {online ? "En ligne" : "Hors-ligne"}
    </span>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1 max-w-xs">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-100 rounded-lg outline-none focus:ring-2 focus:ring-success focus:border-success transition-all placeholder:text-gray-400"
      />
    </div>
  );
}

function PaginationFooter({
  totalItems,
  itemsPerPage,
  currentPage,
  onPageChange,
}: {
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const from = totalItems === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const to = Math.min(currentPage * itemsPerPage, totalItems);
  return (
    <>
      <span className="text-xs text-gray-400">{from}–{to} sur {totalItems}</span>
      <div className="flex items-center gap-1">
        <button
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="p-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5 text-gray-500" />
        </button>
        <span className="px-3 py-1 text-xs text-gray-500 font-medium">{currentPage} / {totalPages}</span>
        <button
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="p-1.5 rounded-lg border border-gray-100 hover:bg-gray-50 disabled:opacity-30 transition-colors"
        >
          <ChevronRight className="h-3.5 w-3.5 text-gray-500" />
        </button>
      </div>
    </>
  );
}

export default function UsersAdminPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [activeTab, setActiveTab] = useState("users");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [, setLocation] = useLocation();
  const [isDriverDialogOpen, setIsDriverDialogOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<Driver | null>(null);
  const [createAccountDialog, setCreateAccountDialog] = useState<{ open: boolean; driver: Driver | null }>({ open: false, driver: null });
  const [createAccountForm, setCreateAccountForm] = useState({ email: "", pin: "", showPin: false });
  const [createAccountLoading, setCreateAccountLoading] = useState(false);
  const [employeePage, setEmployeePage] = useState(1);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const itemsPerPage = 10;

  if (user?.role !== "admin") {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-card p-8 text-center">
          <h2 className="text-lg font-semibold mb-2">Accès refusé</h2>
          <p className="text-sm text-gray-500">
            Vous n'avez pas les permissions nécessaires pour accéder à cette page.
          </p>
        </div>
      </div>
    );
  }

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: User[]; total: number }>({
    queryKey: [
      "/api/admin/users",
      { search: searchTerm, role: roleFilter, limit: itemsPerPage, offset: (currentPage - 1) * itemsPerPage },
    ],
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<UsersOverviewStats>({
    queryKey: ["/api/admin/users/statistics"],
  });

  const { data: driversData, isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ["/api/drivers"],
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const { data: driverCpcStats, isLoading: driverCpcStatsLoading } = useQuery<DriverCpcStatistics>({
    queryKey: ["/api/drivers/cpc-statistics"],
  });

  const users = usersData?.users || [];
  const totalUsers = usersData?.total || 0;

  const allDrivers = useMemo(() => {
    const source = driversData || [];
    return [...source].sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tA !== tB ? tB - tA : b.id - a.id;
    });
  }, [driversData]);

  const filteredDrivers = allDrivers.filter((d) => {
    if (!employeeSearch.trim()) return true;
    const q = employeeSearch.toLowerCase().trim();
    const name = `${d.firstName || ""} ${d.lastName || ""}`.toLowerCase();
    return name.includes(q) || (d.employeeNumber || "").toLowerCase().includes(q) || (d.licenseNumber || "").toLowerCase().includes(q);
  });
  const totalDrivers = filteredDrivers.length;
  const drivers = filteredDrivers.slice((employeePage - 1) * itemsPerPage, employeePage * itemsPerPage);

  const toggleUserMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      apiRequest(`/api/admin/users/${userId}/toggle`, "PATCH", { isActive }),
    onSuccess: () => {
      toast({ title: "Succès", description: "Statut de l'utilisateur modifié avec succès" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/statistics"] });
    },
    onError: (error: any) =>
      toast({ variant: "destructive", title: "Erreur", description: userMessageOf(error, "Erreur lors de la modification du statut") }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: number) => apiRequest(`/api/admin/users/${userId}`, "DELETE"),
    onSuccess: () => {
      toast({ title: "Succès", description: "Utilisateur supprimé avec succès" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users/statistics"] });
    },
    onError: (error: any) =>
      toast({ variant: "destructive", title: "Erreur", description: userMessageOf(error, "Erreur lors de la suppression") }),
  });

  const toggleDriverMutation = useMutation({
    mutationFn: ({ driverId, isActive }: { driverId: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/drivers/${driverId}/toggle`, { isActive }),
    onSuccess: () => {
      toast({ title: "Succès", description: "Statut du chauffeur mis à jour." });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-statistics"] });
      queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/missions"] });
    },
    onError: (error: any) =>
      toast({ variant: "destructive", title: "Erreur", description: userMessageOf(error, "Impossible de modifier le statut du chauffeur.") }),
  });

  const handleEditUser = (u: User) => setEditingUser(u);

  const handleToggleUser = (u: User) =>
    toggleUserMutation.mutate({ userId: u.id, isActive: !!u.deletedAt });

  const handleDeleteUser = (u: User) => {
    if (window.confirm(`Êtes-vous sûr de vouloir supprimer l'utilisateur "${u.name}" ?`))
      deleteUserMutation.mutate(u.id);
  };

  const openCreateDriverDialog = () => { setEditingDriver(null); setEmployeePage(1); setIsDriverDialogOpen(true); };
  const openEditDriverDialog = (d: Driver) => { setEditingDriver(d); setIsDriverDialogOpen(true); };
  const handleToggleDriver = (d: Driver) =>
    toggleDriverMutation.mutate({ driverId: d.id, isActive: !(d.isActive ?? true) });

  const openCreateAccountDialog = (d: Driver) => {
    setCreateAccountDialog({ open: true, driver: d });
    setCreateAccountForm({ email: "", pin: "", showPin: false });
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
        // Resync ciblé (AGENTS §2) : fiche liée, nouveau compte, compteurs.
        queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users/statistics"] });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setCreateAccountLoading(false);
    }
  }

  // ── Column definitions ────────────────────────────────────────────────────

  const userColumns: PremiumDataTableColumn<User>[] = [
    {
      id: "name",
      header: "Nom",
      cell: (u) => (
        <div>
          <div className="font-medium text-gray-900">{u.name}</div>
          <div className="text-xs text-gray-400">{u.username}</div>
        </div>
      ),
    },
    {
      id: "email",
      header: "Email",
      cell: (u) => <span className="text-xs text-gray-600">{u.email}</span>,
    },
    {
      id: "role",
      header: "Rôle",
      cell: (u) => (
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", ROLE_COLORS[u.role] ?? "bg-gray-100 text-gray-500 border border-gray-200")}>
          {roleLabelOf(u.role)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Statut",
      cell: (u) => (
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", u.deletedAt ? "bg-gray-100 text-gray-500 border-gray-200" : "bg-success/10 text-success border-success/30")}>
          {u.deletedAt ? "Désactivé" : "Actif"}
        </span>
      ),
    },
    {
      id: "presence",
      header: "Présence",
      cell: (u) => <PresenceDot isOnline={u.isOnline} />,
    },
    {
      id: "loginCount",
      header: "Connexions",
      cell: (u) => {
        const n = (() => { const p = Math.trunc(Number(u.loginCount)); return (Number.isFinite(p) ? Math.max(0, p) : 0) || (u.lastLoginAt ? 1 : 0); })();
        const cls = n === 0 ? "bg-destructive/10 text-destructive-text border border-destructive/30" : n < 5 ? "bg-warning/10 text-warning-text border border-warning/30" : "bg-success/10 text-success border border-success/30";
        return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", cls)}>{n} connexion{n > 1 ? "s" : ""}</span>;
      },
    },
    {
      id: "lastLogin",
      header: "Dernière connexion",
      cell: (u) => <span className="text-xs text-gray-500">{u.lastLoginAt ? formatDate(u.lastLoginAt) : "Jamais connecté"}</span>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (u) => (
        <div className="flex justify-end gap-0.5">
          <button onClick={() => handleEditUser(u)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors" title="Modifier">
            <Edit className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => handleToggleUser(u)} className="p-1.5 rounded-lg hover:bg-warning/10 text-warning-text transition-colors" title={u.deletedAt ? "Activer" : "Désactiver"}>
            {u.deletedAt ? <Shield className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => handleDeleteUser(u)} className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive-text transition-colors" title="Supprimer">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  const driverColumns: PremiumDataTableColumn<Driver>[] = [
    {
      id: "name",
      header: "Nom complet",
      cell: (d) => (
        <div>
          <div className="font-medium text-gray-900">{d.firstName} {d.lastName}</div>
          <div className="text-xs text-gray-400">N° {d.employeeNumber || "N/A"}</div>
        </div>
      ),
    },
    {
      id: "license",
      header: "Permis",
      cell: (d) => (
        <div>
          <div className="text-gray-700">{d.licenseNumber || "N/A"}</div>
          {d.licenseExpiry && <div className="text-xs text-gray-400">Expire : {formatDate(d.licenseExpiry)}</div>}
        </div>
      ),
    },
    {
      id: "cni",
      header: "CNI",
      cell: (d) => (
        <div>
          <div className="text-gray-700">{d.cniNumber || "N/A"}</div>
          {d.cniExpiry && <div className="text-xs text-gray-400">Expire : {formatDate(d.cniExpiry)}</div>}
        </div>
      ),
    },
    {
      id: "cpcStatus",
      header: "Statut CPC",
      cell: (d) => {
        const s = d.cpcStatus ?? "NON FORMÉ";
        return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", CPC_TONE_CLASSES[cpcStatusTone(s)])}>{s}</span>;
      },
    },
    {
      id: "status",
      header: "Statut",
      cell: (d) => (
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", d.isActive ? "bg-success/10 text-success border-success/30" : "bg-gray-100 text-gray-500 border-gray-200")}>
          {d.isActive ? "Actif" : "Inactif"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (d) => (
        <div className="flex justify-end gap-0.5">
          <button onClick={() => openCreateAccountDialog(d)} className="p-1.5 rounded-lg hover:bg-success/10 text-success transition-colors" title="Créer compte utilisateur">
            <UserPlus className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => openEditDriverDialog(d)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors" title="Modifier">
            <Edit className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => handleToggleDriver(d)} className="p-1.5 rounded-lg hover:bg-warning/10 text-warning-text transition-colors" title={d.isActive ? "Désactiver" : "Activer"}>
            {d.isActive ? <ShieldOff className="h-3.5 w-3.5" /> : <Shield className="h-3.5 w-3.5" />}
          </button>
        </div>
      ),
    },
  ];

  // ── Initial skeleton ──────────────────────────────────────────────────────

  const showInitialSkeleton =
    (activeTab === "users" && usersLoading && !usersData && statsLoading && !stats) ||
    (activeTab === "employees" && driversLoading && !driversData && driverCpcStatsLoading && !driverCpcStats);

  if (showInitialSkeleton) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Administration"
        title="Utilisateurs & Chauffeurs"
        subtitle="Gérer les comptes utilisateurs et les équipes"
        icon={<Users className="h-5 w-5 text-success" />}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {/* Tabs nav + bouton action */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PremiumTabsNav
            className="mb-0"
            tabs={[
              { value: "users", label: "Utilisateurs", icon: <TabIcon icon={Users} /> },
              { value: "employees", label: "Chauffeurs", icon: <TabIcon icon={Briefcase} /> },
            ]}
          />
          {activeTab === "users" && (
            <Button size="sm" onClick={() => setIsAddDialogOpen(true)}>
              <UserPlus className="h-4 w-4 mr-2" />Créer un utilisateur
            </Button>
          )}
          {activeTab === "employees" && (
            // La fiche chauffeur est un dossier de conformité (CNI, permis,
            // CPC), pas un compte de connexion: sa création vit sur le module
            // métier, ouvert au logisticien et à la secrétaire. Cet écran garde
            // la vue consolidée et le rattachement d'un compte.
            <Button size="sm" variant="outline" onClick={() => setLocation("/drivers")}>
              <UserPlus className="h-4 w-4 mr-2" />Gérer les chauffeurs
            </Button>
          )}
        </div>

        {/* ── Tab Utilisateurs ── */}
        <TabsContent value="users" className="mt-5 space-y-4">
          <UsersOverview
            stats={stats}
            isLoading={statsLoading}
            roleFilter={roleFilter}
            roleOrder={roleOrder}
            getRoleLabel={roleLabelOf}
            onRoleChange={(role) => { setRoleFilter(role); setCurrentPage(1); }}
          />

          <PremiumDataTable<User>
            columns={userColumns}
            rows={users}
            rowKey={(u) => u.id}
            rowClassName="group"
            emptyState={usersLoading ? "Chargement…" : "Aucun utilisateur trouvé"}
            toolbar={
              <SearchInput
                value={searchTerm}
                onChange={(v) => { setSearchTerm(v); setCurrentPage(1); }}
                placeholder="Rechercher un utilisateur…"
              />
            }
            footer={
              <PaginationFooter
                totalItems={totalUsers}
                itemsPerPage={itemsPerPage}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
              />
            }
          />
        </TabsContent>

        {/* ── Tab Chauffeurs ── */}
        <TabsContent value="employees" className="mt-5 space-y-4">
          {driverCpcStatsLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
            </div>
          ) : driverCpcStats ? (
            <KpiGrid columns={4} withTopBorder={false} className="md:grid-cols-3 xl:grid-cols-5">
              <KpiTile label="Chauffeurs actifs" value={driverCpcStats.total} icon={<CarTaxiFront className="h-4 w-4" />} iconWrapperClassName="bg-blue-50 text-blue-500" />
              <KpiTile label="CPC formés" value={driverCpcStats.forme} icon={<CheckCircle2 className="h-4 w-4" />} iconWrapperClassName="bg-success/10 text-success" />
              <KpiTile label="CPC à former" value={driverCpcStats.aFormer} icon={<AlertTriangle className="h-4 w-4" />} iconWrapperClassName="bg-warning/10 text-warning-text" />
              <KpiTile label="CPC non formés" value={driverCpcStats.nonForme} icon={<XCircle className="h-4 w-4" />} iconWrapperClassName="bg-destructive/10 text-destructive-text" />
              <KpiTile label="Inactifs" value={driverCpcStats.inactiveDrivers} icon={<UserCog className="h-4 w-4" />} iconWrapperClassName="bg-gray-100 text-gray-500" />
            </KpiGrid>
          ) : null}

          <PremiumDataTable<Driver>
            columns={driverColumns}
            rows={drivers}
            rowKey={(d) => d.id}
            rowClassName="group"
            emptyState={driversLoading ? "Chargement…" : "Aucun chauffeur trouvé"}
            toolbar={
              <SearchInput
                value={employeeSearch}
                onChange={(v) => { setEmployeeSearch(v); setEmployeePage(1); }}
                placeholder="Rechercher un chauffeur…"
              />
            }
            footer={
              <PaginationFooter
                totalItems={totalDrivers}
                itemsPerPage={itemsPerPage}
                currentPage={employeePage}
                onPageChange={setEmployeePage}
              />
            }
          />
        </TabsContent>
      </Tabs>

      {/* Dialog créer utilisateur */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Créer un utilisateur</DialogTitle>
            <DialogDescription>Ajoutez un nouveau compte utilisateur avec son rôle d'accès.</DialogDescription>
          </DialogHeader>
          <UserForm
            onSuccess={() => {
              setIsAddDialogOpen(false);
              queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
              queryClient.invalidateQueries({ queryKey: ["/api/admin/users/statistics"] });
            }}
            onCancel={() => setIsAddDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Dialog modifier utilisateur : même formulaire que /users */}
      <Dialog open={editingUser !== null} onOpenChange={(open) => { if (!open) setEditingUser(null); }}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
            <DialogDescription>Modifiez les informations et le rôle d'accès. Laissez le mot de passe vide pour le conserver.</DialogDescription>
          </DialogHeader>
          {editingUser && (
            <UserForm
              isEdit
              userId={editingUser.id}
              initialData={{
                username: editingUser.username,
                name: editingUser.name,
                email: editingUser.email,
                role: editingUser.role,
                password: "",
              }}
              onSuccess={() => {
                setEditingUser(null);
                queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
                queryClient.invalidateQueries({ queryKey: ["/api/admin/users/statistics"] });
              }}
              onCancel={() => setEditingUser(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog créer compte chauffeur */}
      <Dialog open={createAccountDialog.open} onOpenChange={(open) => { if (!open) setCreateAccountDialog({ open: false, driver: null }); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                <UserPlus className="h-4 w-4 text-success" />
              </div>
              Créer un compte chauffeur
            </DialogTitle>
            <DialogDescription>
              Créez un accès PIN pour <strong>{createAccountDialog.driver?.firstName} {createAccountDialog.driver?.lastName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateAccount} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="ca-name">Chauffeur</Label>
              <Input id="ca-name" value={`${createAccountDialog.driver?.firstName ?? ""} ${createAccountDialog.driver?.lastName ?? ""}`} disabled className="bg-gray-50" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-email">Email</Label>
              <Input
                id="ca-email"
                type="email"
                placeholder="chauffeur@exemple.com"
                value={createAccountForm.email}
                onChange={(e) => setCreateAccountForm(f => ({ ...f, email: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ca-pin">Code PIN (4 chiffres)</Label>
              <div className="relative">
                <Input
                  id="ca-pin"
                  type={createAccountForm.showPin ? "text" : "password"}
                  inputMode="numeric"
                  maxLength={4}
                  pattern="\d{4}"
                  placeholder="••••"
                  value={createAccountForm.pin}
                  onChange={(e) => setCreateAccountForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  required
                  className="pr-10 tracking-[0.5em] text-center font-bold text-lg"
                />
                <button
                  type="button"
                  onClick={() => setCreateAccountForm(f => ({ ...f, showPin: !f.showPin }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {createAccountForm.showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateAccountDialog({ open: false, driver: null })}>
                Annuler
              </Button>
              <Button type="submit" disabled={createAccountLoading || createAccountForm.pin.length !== 4} className="bg-success hover:brightness-90">
                {createAccountLoading ? "Création…" : "Créer le compte"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog chauffeur */}
      <Dialog open={isDriverDialogOpen} onOpenChange={(open) => { setIsDriverDialogOpen(open); if (!open) setEditingDriver(null); }}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{editingDriver ? "Modifier le chauffeur" : "Ajouter un chauffeur"}</DialogTitle>
            <DialogDescription>Renseignez les informations administratives du chauffeur (identité, permis, CNI, CPC).</DialogDescription>
          </DialogHeader>
          <DriverForm
            isEdit={Boolean(editingDriver)}
            initialData={editingDriver as DriverFormData | undefined}
            onSuccess={() => {
              setIsDriverDialogOpen(false);
              setEditingDriver(null);
              setEmployeePage(1);
              queryClient.invalidateQueries({ queryKey: ["/api/drivers"] });
              queryClient.invalidateQueries({ queryKey: ["/api/drivers/cpc-statistics"] });
            }}
            onCancel={() => { setIsDriverDialogOpen(false); setEditingDriver(null); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
