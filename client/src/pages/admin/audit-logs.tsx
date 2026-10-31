import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import {
  AUDIT_LOGS_PATH,
  auditLogsResponseSchema,
  type AuditAction,
  type AuditLogRow,
} from "@shared/contracts/audit-logs";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/layout/page-header";
import { PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system/premium-data-table";
import { LoadingError } from "@/components/ui/loading-error";
import { Pagination } from "@/components/ui/pagination";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Création",
  update: "Modification",
  delete: "Suppression",
  lock: "Verrouillage",
  unlock: "Déverrouillage",
  login: "Connexion",
};

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" });
}

type Filters = { userId: string; entityType: string; from: string; to: string };
const NO_FILTERS: Filters = { userId: "", entityType: "", from: "", to: "" };

export default function AuditLogsPage() {
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);

  const update = (patch: Partial<Filters>) => {
    setFilters((previous) => ({ ...previous, ...patch }));
    setPage(1);
  };

  // Les paramètres vides sont omis : le contrat refuse `userId` non entier et `from` mal formé.
  const params: Record<string, string | number | undefined> = {
    userId: /^\d+$/.test(filters.userId) && Number(filters.userId) > 0 ? Number(filters.userId) : undefined,
    entityType: filters.entityType.trim() || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    page,
    pageSize: PAGE_SIZE,
  };
  const rangeInvalid = Boolean(filters.from && filters.to && filters.from > filters.to);

  const query = useQuery({
    queryKey: [AUDIT_LOGS_PATH, params],
    enabled: !rangeInvalid,
    select: (data) => auditLogsResponseSchema.parse(data),
  });

  const columns: PremiumDataTableColumn<AuditLogRow>[] = [
    { id: "at", header: "Date", cell: (r) => formatDateTime(r.at) },
    { id: "user", header: "Utilisateur", cell: (r) => r.userName ?? "-" },
    { id: "action", header: "Action", cell: (r) => ACTION_LABELS[r.action] },
    {
      id: "entity",
      header: "Objet",
      cell: (r) => (
        <span className="text-foreground">
          {r.entityType}
          {r.entityId ? <span className="text-muted-foreground"> #{r.entityId}</span> : null}
        </span>
      ),
    },
    {
      id: "path",
      header: "Requête",
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{[r.method, r.path].filter(Boolean).join(" ") || "-"}</span>
      ),
    },
  ];

  const data = query.data;

  return (
    <PageLayout>
      <PageHeader title="Journal d'audit" subtitle="Qui a modifié quoi, et quand." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="audit-user">Utilisateur (numéro)</Label>
          <Input
            id="audit-user"
            inputMode="numeric"
            value={filters.userId}
            onChange={(e) => update({ userId: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-entity">Objet</Label>
          <Input id="audit-entity" value={filters.entityType} onChange={(e) => update({ entityType: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-from">Du</Label>
          <Input id="audit-from" type="date" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to">Au</Label>
          <Input id="audit-to" type="date" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
        </div>
      </div>
      {rangeInvalid ? (
        <p className="text-sm text-destructive">La date de début doit précéder la date de fin.</p>
      ) : query.isLoading || query.error ? (
        <LoadingError isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PremiumDataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          emptyState={
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <ScrollText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Aucune entrée</p>
              <p className="text-sm text-muted-foreground">Modifiez les filtres pour élargir la recherche.</p>
            </div>
          }
          footer={
            data && data.total > PAGE_SIZE ? (
              <Pagination totalItems={data.total} itemsPerPage={PAGE_SIZE} currentPage={page} onPageChange={setPage} />
            ) : undefined
          }
        />
      )}
    </PageLayout>
  );
}
