import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { cn, formatNumber, formatPrice } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { exportsService } from "@/services/exportsService";
import { operationsService, type ClientSummary } from "@/services/operationsService";
import { useToast } from "@/hooks/use-toast";
import {
  CardShell,
  PremiumDataTable,
  SectionLabel,
  type PremiumDataTableColumn,
} from "@/components/design-system";
import {
  Archive,
  Building2,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Search,
} from "lucide-react";

interface DbClient {
  id: number;
  name: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  billingAddress?: string | null;
  taxId?: string | null;
  paymentTerms?: number | null;
  notes?: string | null;
  isActive?: boolean | null;
  createdByName?: string | null;
}

interface ClientPayload {
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  billingAddress: string | null;
  taxId: string | null;
  paymentTerms: number | null;
  notes: string | null;
}

interface ClientFormValues {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  billingAddress: string;
  taxId: string;
  paymentTerms: string;
  notes: string;
}

const CLIENT_MANAGER_ROLES = new Set(["admin", "secretary", "logistics"]);
const ROLE_ALIASES: Record<string, string> = {
  administrateur: "admin",
  secretaire: "secretary",
  "secrétaire": "secretary",
  logisticien: "logistics",
};

const EMPTY_CLIENT_FORM: ClientFormValues = {
  name: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  billingAddress: "",
  taxId: "",
  paymentTerms: "30",
  notes: "",
};

const EMPTY_CLIENT_STATS: Omit<ClientSummary, "clientName"> = {
  totalMissions: 0,
  totalFuelConsumed: 0,
  totalCost: 0,
  totalRevenue: 0,
  margin: 0,
  marginPercentage: 0,
};

function normalizeNullable(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRole(role: string | null | undefined): string {
  const normalized = (role ?? "").trim().toLowerCase();
  return ROLE_ALIASES[normalized] ?? normalized;
}

function normalizeClientKey(clientName: string | null | undefined): string {
  return (clientName ?? "").trim().toLowerCase();
}

function toClientPayload(values: ClientFormValues): ClientPayload {
  return {
    name: values.name.trim(),
    contactPerson: normalizeNullable(values.contactPerson),
    email: normalizeNullable(values.email),
    phone: normalizeNullable(values.phone),
    address: normalizeNullable(values.address),
    billingAddress: normalizeNullable(values.billingAddress),
    taxId: normalizeNullable(values.taxId),
    paymentTerms:
      values.paymentTerms.trim().length > 0
        ? Number.parseInt(values.paymentTerms, 10)
        : null,
    notes: normalizeNullable(values.notes),
  };
}

function toFormValues(client: DbClient): ClientFormValues {
  return {
    name: client.name ?? "",
    contactPerson: client.contactPerson ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    address: client.address ?? "",
    billingAddress: client.billingAddress ?? "",
    taxId: client.taxId ?? "",
    paymentTerms:
      typeof client.paymentTerms === "number" ? String(client.paymentTerms) : "30",
    notes: client.notes ?? "",
  };
}

export function ClientsPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManageClients = CLIENT_MANAGER_ROLES.has(normalizeRole(user?.role));

  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">(
    "active",
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<DbClient | null>(null);
  const [formValues, setFormValues] = useState<ClientFormValues>(EMPTY_CLIENT_FORM);

  const liveQueryConfig = {
    staleTime: 30_000,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  } as const;

  const clientsQueryKey = canManageClients ? "/api/clients/all" : "/api/clients";
  const { data: clients = [], isLoading: isClientsLoading } = useQuery<DbClient[]>({
    queryKey: [clientsQueryKey],
    ...liveQueryConfig,
  });

  const { data: statsByClient = [], isFetching: isStatsFetching } = useQuery<ClientSummary[]>({
    queryKey: ["/api/operations/stats/by-client"],
    queryFn: () => operationsService.getStatsByClient(),
    ...liveQueryConfig,
  });

  const statsByClientName = useMemo(() => {
    const statsMap = new Map<string, ClientSummary>();
    for (const item of statsByClient) {
      statsMap.set(normalizeClientKey(item.clientName), item);
    }
    return statsMap;
  }, [statsByClient]);

  const getStatsForClient = (client: DbClient) => {
    return statsByClientName.get(normalizeClientKey(client.name));
  };

  const invalidateClientQueries = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/clients/all"] });
    queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/by-client"] });
    queryClient.invalidateQueries({ queryKey: ["/api/operations/stats/summary"] });
    queryClient.invalidateQueries({ queryKey: ["/api/operations/missions"] });
  };

  const createClientMutation = useMutation({
    mutationFn: async (payload: ClientPayload) => {
      const response = await apiRequest("POST", "/api/clients", payload);
      return response.json();
    },
    onSuccess: () => {
      invalidateClientQueries();
      toast({
        title: "Client créé",
        description: "Le client a été ajouté avec succès.",
      });
      setIsDialogOpen(false);
      setEditingClient(null);
      setFormValues(EMPTY_CLIENT_FORM);
    },
    onError: (error: unknown) => {
      toast({
        title: "Erreur création client",
        description: error instanceof Error ? error.message : "Erreur inconnue",
        variant: "destructive",
      });
    },
  });

  const updateClientMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number;
      payload: ClientPayload;
    }) => {
      const response = await apiRequest("PATCH", `/api/clients/${id}`, payload);
      return response.json();
    },
    onSuccess: () => {
      invalidateClientQueries();
      toast({
        title: "Client mis à jour",
        description: "Les informations client ont été enregistrées.",
      });
      setIsDialogOpen(false);
      setEditingClient(null);
      setFormValues(EMPTY_CLIENT_FORM);
    },
    onError: (error: unknown) => {
      toast({
        title: "Erreur mise à jour client",
        description: error instanceof Error ? error.message : "Erreur inconnue",
        variant: "destructive",
      });
    },
  });

  const archiveClientMutation = useMutation({
    mutationFn: async (clientId: number) => {
      const response = await apiRequest("DELETE", `/api/clients/${clientId}`);
      return response.json();
    },
    onSuccess: () => {
      invalidateClientQueries();
      toast({
        title: "Client archivé",
        description: "Le client a été retiré de la liste active.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Erreur archivage client",
        description: error instanceof Error ? error.message : "Erreur inconnue",
        variant: "destructive",
      });
    },
  });

  const restoreClientMutation = useMutation({
    mutationFn: async (clientId: number) => {
      const response = await apiRequest("PATCH", `/api/clients/${clientId}/restore`);
      return response.json();
    },
    onSuccess: () => {
      invalidateClientQueries();
      toast({
        title: "Client restauré",
        description: "Le client est de nouveau actif.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Erreur restauration client",
        description: error instanceof Error ? error.message : "Erreur inconnue",
        variant: "destructive",
      });
    },
  });

  const filteredClients = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const scopedClients = !canManageClients
      ? clients.filter((client) => client.isActive !== false)
      : statusFilter === "all"
        ? clients
        : statusFilter === "archived"
          ? clients.filter((client) => client.isActive === false)
          : clients.filter((client) => client.isActive !== false);

    if (!normalizedSearch) {
      return scopedClients;
    }

    return scopedClients.filter((client) => {
      const searchableValues = [
        client.name,
        client.contactPerson,
        client.email,
        client.phone,
        client.createdByName,
      ];

      return searchableValues.some((value) =>
        value?.toLowerCase().includes(normalizedSearch),
      );
    });
  }, [canManageClients, clients, searchTerm, statusFilter]);

  const activeClientsCount = clients.filter((client) => client.isActive !== false).length;
  const archivedClientsCount = clients.filter((client) => client.isActive === false).length;
  const totalClientsCount = clients.length;

  const openCreateDialog = () => {
    setEditingClient(null);
    setFormValues(EMPTY_CLIENT_FORM);
    setIsDialogOpen(true);
  };

  const openEditDialog = (client: DbClient) => {
    setEditingClient(client);
    setFormValues(toFormValues(client));
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingClient(null);
    setFormValues(EMPTY_CLIENT_FORM);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) {
      closeDialog();
      return;
    }
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = toClientPayload(formValues);

    if (!payload.name) {
      toast({
        title: "Validation",
        description: "Le nom du client est obligatoire.",
        variant: "destructive",
      });
      return;
    }

    if (
      payload.paymentTerms !== null &&
      (!Number.isInteger(payload.paymentTerms) || payload.paymentTerms < 0)
    ) {
      toast({
        title: "Validation",
        description: "Le délai de paiement doit être un nombre positif.",
        variant: "destructive",
      });
      return;
    }

    if (editingClient) {
      updateClientMutation.mutate({ id: editingClient.id, payload });
      return;
    }

    createClientMutation.mutate(payload);
  };

  const handleArchiveClient = (client: DbClient) => {
    if (!window.confirm(`Archiver le client "${client.name}" ?`)) {
      return;
    }
    archiveClientMutation.mutate(client.id);
  };

  const handleRestoreClient = (client: DbClient) => {
    restoreClientMutation.mutate(client.id);
  };

  const handleExportClient = async (clientName: string) => {
    try {
      await exportsService.downloadClientMissions({ client: clientName });
      toast({
        title: "Export réussi",
        description: `Les données de ${clientName} ont été exportées.`,
      });
    } catch {
      toast({
        title: "Erreur",
        description: "Impossible d'exporter les données.",
        variant: "destructive",
      });
    }
  };

  const columns: PremiumDataTableColumn<DbClient>[] = [
    {
      id: "client",
      header: "Client",
      widthClassName: "w-[280px]",
      cell: (row) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg border border-blue-100 bg-blue-50 text-blue-600 inline-flex items-center justify-center">
              <Building2 className="h-4 w-4" />
            </div>
            <span className="font-semibold text-gray-900">{row.name}</span>
          </div>
          <p className="text-xs text-gray-500">
            {row.createdByName ? `Créé par ${row.createdByName}` : "Création système"}
          </p>
        </div>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      widthClassName: "w-[240px]",
      cell: (row) => (
        <div className="space-y-1">
          <p className="font-medium text-gray-800">{row.contactPerson || "-"}</p>
          <p className="text-xs text-gray-500 truncate">{row.email || "Aucun email"}</p>
          <p className="text-xs text-gray-500">{row.phone || "-"}</p>
        </div>
      ),
    },
    {
      id: "conditions",
      header: "Conditions",
      widthClassName: "w-[180px]",
      cell: (row) => (
        <div className="space-y-1 text-xs">
          <p className="text-gray-500">
            Paiement: <span className="font-semibold text-gray-700">{typeof row.paymentTerms === "number" ? `${row.paymentTerms} jours` : "-"}</span>
          </p>
          <p className="text-gray-500 truncate">
            NIU: <span className="font-medium text-gray-700">{row.taxId || "-"}</span>
          </p>
        </div>
      ),
    },
    {
      id: "performance",
      header: "Performance",
      widthClassName: "w-[170px]",
      cell: (row) => {
        const stats = getStatsForClient(row);
        const data = stats ?? EMPTY_CLIENT_STATS;

        if (!stats && isStatsFetching) {
          return <Skeleton className="h-4 w-28" />;
        }

        return (
          <div className="space-y-1 text-xs">
            <p className="text-gray-500">
              Missions: <span className="font-semibold text-gray-800">{formatNumber(data.totalMissions)}</span>
            </p>
            <p className="text-gray-500">
              Carburant: <span className="font-semibold text-gray-800">{formatNumber(data.totalFuelConsumed)} L</span>
            </p>
          </div>
        );
      },
    },
    {
      id: "finance",
      header: "Finance",
      widthClassName: "w-[220px]",
      cell: (row) => {
        const stats = getStatsForClient(row);
        const data = stats ?? EMPTY_CLIENT_STATS;

        if (!stats && isStatsFetching) {
          return <Skeleton className="h-4 w-32" />;
        }

        return (
          <div className="space-y-1 text-xs">
            <p className="text-gray-500">
              CA: <span className="font-semibold text-green-600">{formatPrice(data.totalRevenue)}</span>
            </p>
            <p className="text-gray-500">
              Marge: <span className="font-semibold text-violet-600">{data.marginPercentage.toFixed(1)}%</span>
            </p>
            <p className="text-gray-500">
              Bénéfice: <span className="font-semibold text-gray-900">{formatPrice(data.margin)}</span>
            </p>
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Statut",
      align: "center",
      widthClassName: "w-[120px]",
      cell: (row) => {
        const isArchived = row.isActive === false;
        return (
          <Badge
            variant="secondary"
            className={cn(
              "border text-xs font-semibold",
              isArchived
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            {isArchived ? "Archivé" : "Actif"}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      widthClassName: "w-[210px]",
      cell: (row) => {
        const isArchived = row.isActive === false;
        const isArchiving = archiveClientMutation.isPending && archiveClientMutation.variables === row.id;
        const isRestoring = restoreClientMutation.isPending && restoreClientMutation.variables === row.id;

        return (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={(event) => {
                event.stopPropagation();
                handleExportClient(row.name);
              }}
              data-testid={`export-${row.name}`}
              title="Exporter missions client"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Export
            </Button>

            {canManageClients && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={(event) => {
                    event.stopPropagation();
                    openEditDialog(row);
                  }}
                  data-testid={`edit-client-${row.id}`}
                  title="Modifier client"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>

                {isArchived ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRestoreClient(row);
                    }}
                    disabled={isRestoring}
                    data-testid={`restore-client-${row.id}`}
                    title="Restaurer client"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleArchiveClient(row);
                    }}
                    disabled={isArchiving}
                    data-testid={`archive-client-${row.id}`}
                    title="Archiver client"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </Button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];

  if (isClientsLoading) {
    return (
      <div className="space-y-5">
        <CardShell topBar>
          <div className="px-5 py-4 border-b border-gray-100">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="mt-2 h-4 w-80" />
          </div>
          <div className="px-5 py-4 flex flex-wrap gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-72 ml-auto" />
          </div>
        </CardShell>

        <CardShell>
          <div className="px-5 py-4 border-b border-gray-100">
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="px-5 py-4 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardShell>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <CardShell topBar>
        <div className="px-5 py-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3">
          <div>
            <SectionLabel className="text-emerald-600">Portefeuille clients</SectionLabel>
            <p className="text-sm text-gray-500 mt-1">
              Pilotage des comptes clients, performances missions et facturation.
            </p>
          </div>
          {canManageClients && (
            <Button onClick={openCreateDialog} data-testid="btn-create-client" className="shadow-sm">
              <Plus className="mr-2 h-4 w-4" />
              Nouveau client
            </Button>
          )}
        </div>

        <div className="px-5 py-3.5 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={statusFilter === "active" ? "default" : "outline"}
              size="sm"
              className={statusFilter === "active" ? "bg-green-600 hover:bg-green-700" : "bg-white"}
              onClick={() => setStatusFilter("active")}
            >
              Actifs ({activeClientsCount})
            </Button>

            {canManageClients && (
              <>
                <Button
                  variant={statusFilter === "archived" ? "default" : "outline"}
                  size="sm"
                  className={statusFilter === "archived" ? "bg-amber-600 hover:bg-amber-700" : "bg-white"}
                  onClick={() => setStatusFilter("archived")}
                >
                  Archivés ({archivedClientsCount})
                </Button>
                <Button
                  variant={statusFilter === "all" ? "default" : "outline"}
                  size="sm"
                  className={statusFilter === "all" ? "bg-slate-700 hover:bg-slate-800" : "bg-white"}
                  onClick={() => setStatusFilter("all")}
                >
                  Tous ({totalClientsCount})
                </Button>
              </>
            )}
          </div>

          <div className="relative lg:ml-auto w-full lg:w-[340px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Rechercher un client, contact ou email..."
              className="pl-9 h-9 border-gray-200 bg-gray-50"
            />
          </div>
        </div>
      </CardShell>

      <PremiumDataTable
        data-help-target="clients-list"
        columns={columns}
        rows={filteredClients}
        rowKey={(row) => row.id}
        tableClassName="min-w-[1260px]"
        rowClassName={(row, rowIndex) =>
          cn(
            rowIndex % 2 === 1 ? "bg-slate-50/65" : "bg-white",
            row.isActive === false ? "bg-amber-50/60" : undefined,
          )
        }
        emptyState={
          <div className="space-y-1">
            <p className="text-sm text-gray-500">Aucun client pour ce filtre.</p>
            <p className="text-xs text-gray-400">Essayez un autre statut ou une autre recherche.</p>
          </div>
        }
        footer={
          <div className="w-full flex items-center justify-between gap-3 text-xs text-gray-500">
            <span>{filteredClients.length} client(s) affiché(s)</span>
            <span>{activeClientsCount} actif(s) - {archivedClientsCount} archivé(s)</span>
          </div>
        }
      />

      <Dialog open={isDialogOpen} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-[980px] p-0 overflow-hidden rounded-2xl border border-emerald-100/70 shadow-2xl">
          <div className="bg-gradient-to-r from-emerald-700 via-green-600 to-emerald-500 px-6 py-5">
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white">
                  <Building2 className="h-5 w-5" />
                </div>
                <DialogTitle className="text-white text-xl font-semibold">
                  {editingClient ? "Modifier le client" : "Créer un client"}
                </DialogTitle>
              </div>
              <DialogDescription className="text-emerald-50/95 text-sm">
                Renseignez les informations administratives et de facturation.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="max-h-[72vh] overflow-y-auto bg-slate-50/75 px-6 py-5 space-y-4">
            <div className="rounded-2xl border border-gray-100 bg-white p-4">
              <SectionLabel className="text-emerald-600">Informations de base</SectionLabel>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="client-name">Nom du client *</Label>
                  <Input
                    id="client-name"
                    value={formValues.name}
                    onChange={(event) =>
                      setFormValues((previous) => ({ ...previous, name: event.target.value }))
                    }
                    placeholder="Ex: CAMRAIL"
                    className="h-11 border-gray-200 bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client-contact">Personne de contact</Label>
                  <Input
                    id="client-contact"
                    value={formValues.contactPerson}
                    onChange={(event) =>
                      setFormValues((previous) => ({
                        ...previous,
                        contactPerson: event.target.value,
                      }))
                    }
                    placeholder="Ex: Jean Ndom"
                    className="h-11 border-gray-200 bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client-email">Email</Label>
                  <Input
                    id="client-email"
                    type="email"
                    value={formValues.email}
                    onChange={(event) =>
                      setFormValues((previous) => ({ ...previous, email: event.target.value }))
                    }
                    placeholder="contact@client.cm"
                    className="h-11 border-gray-200 bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client-phone">Téléphone</Label>
                  <Input
                    id="client-phone"
                    value={formValues.phone}
                    onChange={(event) =>
                      setFormValues((previous) => ({ ...previous, phone: event.target.value }))
                    }
                    placeholder="+237 6XX XX XX XX"
                    className="h-11 border-gray-200 bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-4">
              <SectionLabel className="text-emerald-600">Facturation</SectionLabel>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="client-tax-id">Numéro fiscal</Label>
                  <Input
                    id="client-tax-id"
                    value={formValues.taxId}
                    onChange={(event) =>
                      setFormValues((previous) => ({ ...previous, taxId: event.target.value }))
                    }
                    placeholder="NIU..."
                    className="h-11 border-gray-200 bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client-payment-terms">Délai de paiement (jours)</Label>
                  <Input
                    id="client-payment-terms"
                    type="number"
                    min={0}
                    value={formValues.paymentTerms}
                    onChange={(event) =>
                      setFormValues((previous) => ({
                        ...previous,
                        paymentTerms: event.target.value,
                      }))
                    }
                    placeholder="30"
                    className="h-11 border-gray-200 bg-white"
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="client-billing-address">Adresse de facturation</Label>
                  <Textarea
                    id="client-billing-address"
                    value={formValues.billingAddress}
                    onChange={(event) =>
                      setFormValues((previous) => ({
                        ...previous,
                        billingAddress: event.target.value,
                      }))
                    }
                    rows={2}
                    placeholder="Adresse de facturation"
                    className="border-gray-200 bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-4">
              <SectionLabel className="text-emerald-600">Adresse et notes</SectionLabel>
              <div className="mt-3 grid grid-cols-1 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="client-address">Adresse opérationnelle</Label>
                  <Textarea
                    id="client-address"
                    value={formValues.address}
                    onChange={(event) =>
                      setFormValues((previous) => ({ ...previous, address: event.target.value }))
                    }
                    rows={2}
                    placeholder="Adresse de livraison / exploitation"
                    className="border-gray-200 bg-white"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="client-notes">Notes</Label>
                  <Textarea
                    id="client-notes"
                    value={formValues.notes}
                    onChange={(event) =>
                      setFormValues((previous) => ({ ...previous, notes: event.target.value }))
                    }
                    rows={3}
                    placeholder="Informations complémentaires"
                    className="border-gray-200 bg-white"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4 bg-white">
            <Button variant="outline" onClick={closeDialog} disabled={createClientMutation.isPending || updateClientMutation.isPending}>
              Annuler
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createClientMutation.isPending || updateClientMutation.isPending}
              data-testid={editingClient ? "btn-update-client" : "btn-submit-client"}
              className="min-w-[140px]"
            >
              {createClientMutation.isPending || updateClientMutation.isPending
                ? "Enregistrement..."
                : editingClient
                  ? "Mettre à jour"
                  : "Créer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
