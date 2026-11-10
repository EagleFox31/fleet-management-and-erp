import { userMessageOf } from "@/lib/api-error";
import React, { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAllWorkOrders } from "@/hooks/use-all-work-orders";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Plus,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Fuel,
  Wrench,
  BarChart3,
  TrendingUp,
  HardHat,
  Users,
  Edit,
  Trash2,
  Search,
} from "lucide-react";
import { roleLabelOf } from "@/lib/contextual-help/roles";
import { apiRequest } from "@/lib/queryClient";
import { queryView, readyData } from "@/lib/query-view";
import { UNAVAILABLE } from "@/components/dashboard/kpi-tiles";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import {
  CardShell,
  HeaderCard,
  KpiGrid,
  KpiTile,
  PremiumDataTable,
  PremiumTabsNav,
  type PremiumDataTableColumn,
} from "@/components/design-system";
import { TabIcon } from "@/lib/premium-tab-icons";

// Service pour les opérations utilisateur
const UserService = {
  async addUser(userData) {
    return await apiRequest("POST", "/api/users", userData);
  },
  
  async updateUser(userData) {
    // Préparer les données à envoyer, retirer le mot de passe s'il est vide
    const dataToSend = {...userData};
    if (!dataToSend.password) {
      delete dataToSend.password;
    }
    
    return await apiRequest("PATCH", `/api/users/${userData.id}`, dataToSend);
  },
  
  async deleteUser(userId) {
    return await apiRequest("DELETE", `/api/users/${userId}`);
  }
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-50 text-red-700 border border-red-200",
  workshop_manager: "bg-blue-50 text-blue-700 border border-blue-200",
  technician: "bg-purple-50 text-purple-700 border border-purple-200",
  user: "bg-gray-100 text-gray-500 border border-gray-200",
};

const formatUserDate = (value?: string | null) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return format(date, "dd/MM/yyyy HH:mm", { locale: fr });
};

export default function TechniciansIndex() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("technicians");
  const [techSearch, setTechSearch] = useState("");
  const [managerSearch, setManagerSearch] = useState("");
  const [isAddUserDialogOpen, setIsAddUserDialogOpen] = useState(false);
  const [isEditUserDialogOpen, setIsEditUserDialogOpen] = useState(false);
  const [isDeleteUserDialogOpen, setIsDeleteUserDialogOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [selectedTechnician, setSelectedTechnician] = useState("all");
  const [selectedPeriod, setSelectedPeriod] = useState("30");
  const [newUser, setNewUser] = useState({
    name: "",
    username: "",
    email: "",
    role: "technician",
    password: ""
  });
  const [editUser, setEditUser] = useState({
    id: 0,
    name: "",
    username: "",
    email: "",
    role: "technician",
    password: ""
  });

  // Fetch technicians
  const { data: technicians = [], isLoading, refetch } = useQuery<any>({
    queryKey: ["/api/users"],
    select: (data) => data.filter((user) => 
      user.role === "technician" || 
      user.role === "workshop_manager" || 
      user.role === "admin"
    ),
  });

  // Fetch work orders for KPI calculations with detailed data
  const { data: workOrders = [] } = useAllWorkOrders();

  // Fetch fuel records for technician performance
  const { data: fuelRecords = [] } = useQuery<any>({
    queryKey: ["/api/fuel-records"],
  });

  // Fetch maintenance schedules for preventive work
  const { data: maintenanceSchedules = [] } = useQuery<any>({
    queryKey: ["/api/maintenance-schedules"],
  });

  // Fetch parts used for cost calculations
  const partsUsedQuery = useQuery<any[]>({
    queryKey: ["/api/parts-used"],
  });
  // Échec sans données : coût pièces « Indisponible », jamais 0 F CFA.
  const partsUsedView = queryView(partsUsedQuery);
  const partsUsed = readyData(partsUsedView, [] as any[]);

  // Calculate KPI metrics based on filters
  const kpiMetrics = useMemo(() => {
    const now = new Date();
    const periodDays = parseInt(selectedPeriod);
    const startDate = new Date(now.getTime() - (periodDays * 24 * 60 * 60 * 1000));

    // Ensure workOrders is an array before filtering
    const workOrdersArray = Array.isArray(workOrders) ? workOrders : [];
    
    // Filter work orders by period
    const filteredWorkOrders = workOrdersArray.filter(wo => {
      const woDate = new Date(wo.createdAt);
      return woDate >= startDate;
    });

    // Filter by technician if selected - use technician_id field
    const techFilteredWO = selectedTechnician === "all" 
      ? filteredWorkOrders 
      : filteredWorkOrders.filter(wo => {
          return wo.technicianId?.toString() === selectedTechnician;
        });

    // Calculate metrics
    const totalTasks = techFilteredWO.length;
    const completedTasks = techFilteredWO.filter(wo => wo.status === 'completed').length;
    const inProgressTasks = techFilteredWO.filter(wo => wo.status === 'in_progress').length;
    const pendingTasks = techFilteredWO.filter(wo => wo.status === 'pending').length;
    const cancelledTasks = techFilteredWO.filter(wo => wo.status === 'cancelled').length;

    // Calculate maintenance types - utiliser isPreventive au lieu de type
    const preventiveTasks = techFilteredWO.filter(wo => wo.isPreventive === true).length;
    const correctiveTasks = techFilteredWO.filter(wo => wo.isPreventive === false).length;
    
    // Calculate real work hours from database
    const totalWorkHours = techFilteredWO.reduce((total, wo) => {
      // Use actual hours from database if available, otherwise estimate based on isPreventive
      const actualHours = wo.actualHours || wo.estimatedHours || 
        (wo.isPreventive ? 2 : wo.priority === 'critical' ? 6 : 4);
      return total + (wo.status === 'completed' ? actualHours : 0);
    }, 0);

    // Calculate real maintenance costs from parts used
    const partsUsedArray = Array.isArray(partsUsed) ? partsUsed : [];

    const techPartsUsed = partsUsedArray.filter(part => {
      const partWO = techFilteredWO.find(wo => wo.id === part.workOrderId);
      return partWO !== undefined;
    });
    
    const totalPartsCost = techPartsUsed.reduce((total, part) => {
      // Use unit_price from database (correct field name)
      const unitPrice = part.unit_price || part.unitPrice || part.price || 0;
      const quantity = part.quantity || 0;
      const partCost = parseFloat(unitPrice.toString()) * quantity;
      return total + partCost;
    }, 0);

    // Calculate fuel records by technician
    const fuelRecordsArray = Array.isArray(fuelRecords) ? fuelRecords : [];
    const filteredFuelRecords = fuelRecordsArray.filter(fr => {
      const frDate = new Date(fr.createdAt);
      return frDate >= startDate;
    });

    const techFuelRecords = selectedTechnician === "all" 
      ? filteredFuelRecords 
      : filteredFuelRecords.filter(fr => fr.createdBy?.toString() === selectedTechnician);

    const totalFuelOperations = techFuelRecords.length;

    // Calculate average resolution time from real data
    const completedTasksWithDuration = techFilteredWO.filter(wo => 
      wo.status === 'completed' && wo.completedAt && wo.createdAt
    );
    
    const avgResolutionHours = completedTasksWithDuration.length > 0 
      ? completedTasksWithDuration.reduce((total, wo) => {
          const created = new Date(wo.createdAt);
          const completed = new Date(wo.completedAt);
          const durationHours = (completed.getTime() - created.getTime()) / (1000 * 60 * 60);
          return total + durationHours;
        }, 0) / completedTasksWithDuration.length
      : 0;

    return {
      totalTasks,
      completedTasks,
      inProgressTasks,
      pendingTasks,
      cancelledTasks,
      correctiveTasks,
      preventiveTasks,
      totalWorkHours: Math.round(totalWorkHours * 10) / 10, // Round to 1 decimal
      totalFuelOperations,
      totalPartsCost: Math.round(totalPartsCost * 100) / 100, // Round to 2 decimals
      avgResolutionHours: Math.round(avgResolutionHours * 10) / 10,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      correctiveRatio: (correctiveTasks + preventiveTasks) > 0 ? Math.round((correctiveTasks / (correctiveTasks + preventiveTasks)) * 100) : 0,
      preventiveRatio: (correctiveTasks + preventiveTasks) > 0 ? Math.round((preventiveTasks / (correctiveTasks + preventiveTasks)) * 100) : 0,
    };
  }, [workOrders, fuelRecords, selectedTechnician, selectedPeriod]);

  // Chart data for maintenance types
  const maintenanceChartData = [
    { name: 'Correctives', value: kpiMetrics.correctiveTasks, color: '#ef4444' },
    { name: 'Préventives', value: kpiMetrics.preventiveTasks, color: '#22c55e' },
  ];

  // Chart data for task status
  const statusChartData = [
    { name: 'Terminées', count: kpiMetrics.completedTasks },
    { name: 'En cours', count: kpiMetrics.inProgressTasks },
    { name: 'En attente', count: kpiMetrics.pendingTasks },
    { name: 'Annulées', count: kpiMetrics.cancelledTasks },
  ];

  const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444'];

  // Add technician
  const handleAddUser = async () => {
    try {
      setIsProcessing(true);
      await UserService.addUser(newUser);
      toast({
        title: "Utilisateur ajouté",
        description: "Le nouvel utilisateur a été ajouté avec succès",
      });
      setIsAddUserDialogOpen(false);
      setNewUser({
        name: "",
        username: "",
        email: "",
        role: "technician",
        password: ""
      });
      refetch();
    } catch (error) {
      console.error("Erreur lors de l'ajout de l'utilisateur:", error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Impossible d'ajouter l'utilisateur."),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Edit user
  const handleEditUser = async () => {
    try {
      setIsProcessing(true);
      await UserService.updateUser(editUser);
      toast({
        title: "Utilisateur mis à jour",
        description: "L'utilisateur a été mis à jour avec succès",
      });
      setIsEditUserDialogOpen(false);
      refetch();
    } catch (error) {
      console.error("Erreur lors de la mise à jour de l'utilisateur:", error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Impossible de mettre à jour l'utilisateur."),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Delete user
  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    
    try {
      setIsProcessing(true);
      await UserService.deleteUser(selectedUser.id);
      toast({
        title: "Utilisateur supprimé",
        description: "L'utilisateur a été supprimé avec succès",
      });
      setIsDeleteUserDialogOpen(false);
      refetch();
    } catch (error) {
      console.error("Erreur lors de la suppression de l'utilisateur:", error);
      toast({
        variant: "destructive",
        title: "Erreur",
        description: userMessageOf(error, "Impossible de supprimer l'utilisateur."),
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Open edit modal
  const openEditModal = (user) => {
    if (!user) {
      console.error("Tentative d'édition d'un utilisateur inexistant");
      toast({
        variant: "destructive",
        title: "Erreur",
        description: "Impossible de modifier cet utilisateur",
      });
      return;
    }
    
    setSelectedUser(user);
    setEditUser({
      id: user.id,
      name: user.name || "",
      username: user.username || "",
      email: user.email || "",
      role: user.role || "technician",
      password: ""
    });
    
    setIsEditUserDialogOpen(true);
  };

  // Open delete modal
  const openDeleteModal = (user) => {
    setSelectedUser(user);
    setIsDeleteUserDialogOpen(true);
  };

  // Handle input change for new user
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setNewUser(prev => ({ ...prev, [name]: value }));
  };

  // Handle input change for edit user
  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditUser(prev => ({ ...prev, [name]: value }));
  };

  // Handle role change for new user
  const handleRoleChange = (value) => {
    setNewUser(prev => ({ ...prev, role: value }));
  };

  // Handle role change for edit user
  const handleEditRoleChange = (value) => {
    setEditUser(prev => ({ ...prev, role: value }));
  };

  // Define table columns
  const columns: PremiumDataTableColumn<any>[] = [
    {
      id: "name",
      header: "Nom",
      cell: (row) => (
        <div>
          <p className="text-sm font-semibold text-gray-800">{row.name}</p>
          <p className="text-xs text-gray-400">{row.username}</p>
        </div>
      ),
    },
    {
      id: "email",
      header: "Email",
      cell: (row) => <span className="text-sm text-gray-600">{row.email || "Non spécifié"}</span>,
    },
    {
      id: "role",
      header: "Rôle",
      cell: (row) => (
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", ROLE_COLORS[row.role] ?? ROLE_COLORS.user)}>
          {roleLabelOf(row.role)}
        </span>
      ),
    },
    {
      id: "createdAt",
      header: "Créé le",
      cell: (row) => <span className="text-sm text-gray-500">{formatUserDate(row.createdAt)}</span>,
    },
    {
      id: "actions",
      header: "",
      align: "right",
      widthClassName: "w-[100px]",
      cell: (row) => {
        if (user?.role !== "admin") {
          return <span className="text-xs text-gray-400">—</span>;
        }

        return (
          <div className="flex justify-end gap-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (row?.id) openEditModal(row);
              }}
              className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors"
              title="Modifier"
            >
              <Edit className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (row?.id) openDeleteModal(row);
              }}
              className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors"
              title="Supprimer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      },
    },
  ];

  const technicianRows = useMemo(() => {
    const rows = Array.isArray(technicians) ? technicians.filter((tech) => tech.role === "technician") : [];
    const query = techSearch.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((tech) =>
      [tech.name, tech.username, tech.email].some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [technicians, techSearch]);

  const managerRows = useMemo(() => {
    const rows = Array.isArray(technicians) ? technicians.filter((tech) => tech.role === "workshop_manager") : [];
    const query = managerSearch.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((tech) =>
      [tech.name, tech.username, tech.email].some((value) => String(value || "").toLowerCase().includes(query)),
    );
  }, [technicians, managerSearch]);

  // Check if user has permission
  if (!(user?.role === "admin" || user?.role === "workshop_manager")) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-gray-100 shadow-sm bg-white p-8 text-center">
          <h2 className="text-lg font-semibold mb-2">Accès refusé</h2>
          <p className="text-sm text-gray-500">
            Vous n'avez pas les permissions nécessaires pour accéder à cette page.
          </p>
        </div>
      </div>
    );
  }

  const addUserDialog = user?.role === "admin" ? (
    <Dialog open={isAddUserDialogOpen} onOpenChange={setIsAddUserDialogOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-8 text-xs gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Ajouter un utilisateur
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter un utilisateur</DialogTitle>
          <DialogDescription>
            Créez un nouvel utilisateur pour accéder au système.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nom complet</Label>
            <Input
              id="name"
              name="name"
              placeholder="Jean Dupont"
              value={newUser.name}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Nom d'utilisateur</Label>
            <Input
              id="username"
              name="username"
              placeholder="jdupont"
              value={newUser.username}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="jean.dupont@example.com"
              value={newUser.email}
              onChange={handleInputChange}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Rôle</Label>
            <Select defaultValue={newUser.role} onValueChange={handleRoleChange}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un rôle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Administrateur</SelectItem>
                <SelectItem value="workshop_manager">Chef d'atelier</SelectItem>
                <SelectItem value="technician">Technicien</SelectItem>
                <SelectItem value="user">Utilisateur standard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={newUser.password}
              onChange={handleInputChange}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsAddUserDialogOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleAddUser} disabled={isProcessing}>
            {isProcessing ? "Traitement..." : "Ajouter"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return (
    <div className="space-y-5">
      <HeaderCard
        moduleLabel="Maintenance · Équipe"
        title="Techniciens"
        subtitle="Gestion des techniciens et du personnel de maintenance"
        icon={<HardHat className="h-5 w-5 text-green-600" />}
        actions={addUserDialog}
      >
        <KpiGrid columns={4} withTopBorder className="pt-5">
          <KpiTile
            label="Heures de travail"
            value={`${kpiMetrics.totalWorkHours}h`}
            subValue={`Période ${selectedPeriod} jours`}
            icon={<Clock className="h-4 w-4" />}
            iconWrapperClassName="bg-blue-50 text-blue-600"
          />
          <KpiTile
            label="Total tâches"
            value={kpiMetrics.totalTasks}
            subValue="Ordres de travail"
            icon={<Wrench className="h-4 w-4" />}
            iconWrapperClassName="bg-green-50 text-green-600"
          />
          <KpiTile
            label="Taux de réussite"
            value={`${kpiMetrics.completionRate}%`}
            subValue={`${kpiMetrics.completedTasks} terminées`}
            icon={<TrendingUp className="h-4 w-4" />}
            iconWrapperClassName="bg-purple-50 text-purple-600"
            valueClassName={kpiMetrics.completionRate >= 80 ? "text-green-700" : undefined}
          />
          <KpiTile
            label="Pleins effectués"
            value={kpiMetrics.totalFuelOperations}
            subValue="Opérations carburant"
            icon={<Fuel className="h-4 w-4" />}
            iconWrapperClassName="bg-orange-50 text-orange-600"
          />
        </KpiGrid>
      </HeaderCard>

      <CardShell>
        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <BarChart3 className="h-5 w-5 text-gray-500" />
              <h2 className="text-lg font-bold text-gray-900 uppercase tracking-wide">Indicateur de performance par technicien</h2>
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">Technicien</Label>
                <Select value={selectedTechnician} onValueChange={setSelectedTechnician}>
                  <SelectTrigger className="w-48 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous les techniciens</SelectItem>
                    {technicians.filter((t) => t.role === "technician").map((tech) => (
                      <SelectItem key={tech.id} value={tech.id.toString()}>
                        {tech.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-gray-500">Période</Label>
                <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                  <SelectTrigger className="w-36 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 jours</SelectItem>
                    <SelectItem value="30">30 jours</SelectItem>
                    <SelectItem value="90">90 jours</SelectItem>
                    <SelectItem value="365">1 année</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <KpiGrid columns={4}>
            <KpiTile
              label="OT terminées"
              value={kpiMetrics.completedTasks}
              icon={<CheckCircle className="h-4 w-4" />}
              iconWrapperClassName="bg-green-50 text-green-600"
              valueClassName="text-green-700"
            />
            <KpiTile
              label="OT en cours"
              value={kpiMetrics.inProgressTasks}
              icon={<Clock className="h-4 w-4" />}
              iconWrapperClassName="bg-blue-50 text-blue-600"
              valueClassName={kpiMetrics.inProgressTasks > 0 ? "text-blue-700" : undefined}
            />
            <KpiTile
              label="OT en attente"
              value={kpiMetrics.pendingTasks}
              icon={<AlertCircle className="h-4 w-4" />}
              iconWrapperClassName="bg-amber-50 text-amber-600"
              valueClassName={kpiMetrics.pendingTasks > 0 ? "text-amber-700" : undefined}
            />
            <KpiTile
              label="OT annulées"
              value={kpiMetrics.cancelledTasks}
              icon={<XCircle className="h-4 w-4" />}
              iconWrapperClassName="bg-red-50 text-red-600"
              valueClassName={kpiMetrics.cancelledTasks > 0 ? "text-red-700" : undefined}
            />
          </KpiGrid>

          <KpiGrid columns={2}>
            <KpiTile
              label="Coût total pièces"
              value={
                partsUsedView.kind === "error"
                  ? UNAVAILABLE
                  : partsUsedView.kind === "loading"
                    ? "…"
                    : `${kpiMetrics.totalPartsCost.toFixed(0)} F CFA`
              }
              subValue={partsUsedView.kind === "error" ? userMessageOf(partsUsedView.error, "Les pièces utilisées sont momentanément indisponibles.") : "Pièces consommées"}
              icon={<Wrench className="h-4 w-4" />}
              iconWrapperClassName="bg-emerald-50 text-emerald-600"
            />
            <KpiTile
              label="Temps résolution moy."
              value={`${kpiMetrics.avgResolutionHours}h`}
              subValue="Sur OT terminées"
              icon={<Clock className="h-4 w-4" />}
              iconWrapperClassName="bg-indigo-50 text-indigo-600"
            />
          </KpiGrid>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-2">
            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Ratio maintenance</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="text-center p-3 bg-red-50 rounded-xl border border-red-100">
                  <p className="text-xs text-red-700">Correctives</p>
                  <p className="text-xl font-bold text-red-900">{kpiMetrics.correctiveRatio}%</p>
                  <p className="text-[11px] text-red-600">{kpiMetrics.correctiveTasks} tâches</p>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-xl border border-green-100">
                  <p className="text-xs text-green-700">Préventives</p>
                  <p className="text-xl font-bold text-green-900">{kpiMetrics.preventiveRatio}%</p>
                  <p className="text-[11px] text-green-600">{kpiMetrics.preventiveTasks} tâches</p>
                </div>
              </div>
              {maintenanceChartData.some((item) => item.value > 0) && (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={maintenanceChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      dataKey="value"
                    >
                      {maintenanceChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Statuts des OT</p>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={statusChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8884d8">
                    {statusChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </CardShell>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <PremiumTabsNav
          tabs={[
            {
              value: "technicians",
              icon: <TabIcon icon={HardHat} />,
              label: (
                <span className="flex items-center gap-2">
                  Techniciens
                  {technicianRows.length > 0 && (
                    <span className="ml-1 text-[10px] font-semibold bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">
                      {technicianRows.length}
                    </span>
                  )}
                </span>
              ),
            },
            {
              value: "managers",
              icon: <TabIcon icon={Users} />,
              label: (
                <span className="flex items-center gap-2">
                  Chefs d'atelier
                  {managerRows.length > 0 && (
                    <span className="ml-1 text-[10px] font-semibold bg-gray-200 text-gray-600 rounded-full px-1.5 py-0.5">
                      {managerRows.length}
                    </span>
                  )}
                </span>
              ),
            },
          ]}
        />

        <TabsContent value="technicians" className="space-y-4">
          <PremiumDataTable
            columns={columns}
            rows={technicianRows}
            rowKey={(row) => row.id}
            rowClassName="group"
            emptyState={isLoading ? "Chargement..." : "Aucun technicien trouvé"}
            toolbar={
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  value={techSearch}
                  onChange={(e) => setTechSearch(e.target.value)}
                  placeholder="Rechercher un technicien..."
                  className="pl-9 h-9 text-sm"
                />
              </div>
            }
          />
        </TabsContent>

        <TabsContent value="managers" className="space-y-4">
          <PremiumDataTable
            columns={columns}
            rows={managerRows}
            rowKey={(row) => row.id}
            rowClassName="group"
            emptyState={isLoading ? "Chargement..." : "Aucun chef d'atelier trouvé"}
            toolbar={
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <Input
                  value={managerSearch}
                  onChange={(e) => setManagerSearch(e.target.value)}
                  placeholder="Rechercher un chef d'atelier..."
                  className="pl-9 h-9 text-sm"
                />
              </div>
            }
          />
        </TabsContent>
      </Tabs>

      {/* Modal d'édition d'utilisateur */}
      <Dialog open={isEditUserDialogOpen} onOpenChange={setIsEditUserDialogOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Modifier l'utilisateur</DialogTitle>
            <DialogDescription>
              Modifiez les informations de l'utilisateur. Laissez le mot de passe vide pour le conserver.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nom complet</Label>
              <Input 
                id="edit-name" 
                name="name" 
                value={editUser.name}
                onChange={handleEditInputChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-username">Nom d'utilisateur</Label>
              <Input 
                id="edit-username" 
                name="username" 
                value={editUser.username}
                onChange={handleEditInputChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input 
                id="edit-email" 
                name="email" 
                type="email" 
                value={editUser.email}
                onChange={handleEditInputChange}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Rôle</Label>
              <Select 
                value={editUser.role} 
                onValueChange={handleEditRoleChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrateur</SelectItem>
                  <SelectItem value="workshop_manager">Chef d'atelier</SelectItem>
                  <SelectItem value="technician">Technicien</SelectItem>
                  <SelectItem value="user">Utilisateur standard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">Nouveau mot de passe (laisser vide pour ne pas changer)</Label>
              <Input 
                id="edit-password" 
                name="password" 
                type="password" 
                value={editUser.password}
                onChange={handleEditInputChange}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditUserDialogOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleEditUser} disabled={isProcessing}>
              {isProcessing ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-background border-t-foreground"></div>
                  Mise à jour...
                </>
              ) : "Enregistrer les modifications"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de confirmation de suppression */}
      <Dialog open={isDeleteUserDialogOpen} onOpenChange={setIsDeleteUserDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <AlertTriangle className="h-5 w-5 text-destructive-text mr-2" />
              Confirmer la suppression
            </DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer l'utilisateur{" "}
              <strong>{selectedUser?.name}</strong> ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex justify-between">
            <Button 
              variant="outline" 
              onClick={() => setIsDeleteUserDialogOpen(false)}
            >
              Annuler
            </Button>
            <Button 
              variant="destructive" 
              onClick={handleDeleteUser}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-background border-t-foreground"></div>
                  Suppression...
                </>
              ) : "Confirmer la suppression"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
