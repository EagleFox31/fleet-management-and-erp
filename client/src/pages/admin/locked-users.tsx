import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LockOpen, ShieldCheck } from "lucide-react";
import {
  LOCKED_USERS_PATH,
  lockedUsersResponseSchema,
  unlockUserPath,
  unlockUserResponseSchema,
  type LockedUser,
} from "@shared/contracts/auth-lockout";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/layout/page-header";
import { PremiumDataTable, type PremiumDataTableColumn } from "@/components/design-system/premium-data-table";
import { AlertModal } from "@/components/design-system/alert-modal";
import { LoadingError } from "@/components/ui/loading-error";
import { Button } from "@/components/ui/button";
import { appToast } from "@/lib/app-toast";
import { userMessageOf } from "@/lib/api-error";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSingleFlightMutate } from "@/hooks/use-single-flight";
import { formatLockTime } from "@/lib/lockout-message";

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default function LockedUsersPage() {
  const [target, setTarget] = useState<LockedUser | null>(null);

  const query = useQuery({
    queryKey: [LOCKED_USERS_PATH],
    select: (data) => lockedUsersResponseSchema.parse(data),
  });

  const unlock = useMutation({
    mutationFn: async ({ id }: { id: number }) => {
      const res = await apiRequest("POST", unlockUserPath(id));
      return unlockUserResponseSchema.parse(await res.json());
    },
    onSuccess: ({ id }) => {
      // Couche 1 : la ligne disparait tout de suite.
      queryClient.setQueryData<LockedUser[]>([LOCKED_USERS_PATH], (previous) =>
        Array.isArray(previous) ? previous.filter((u) => u.id !== id) : previous,
      );
      // Couche 3 : liste des comptes et journal d'audit (l'action y est tracee).
      queryClient.invalidateQueries({ queryKey: [LOCKED_USERS_PATH] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/audit-logs"] });
      appToast({ title: "Compte déverrouillé", description: "L'utilisateur peut se reconnecter.", variant: "success" });
      setTarget(null);
    },
    onError: (error) => {
      appToast({
        title: "Déverrouillage impossible",
        description: userMessageOf(error, "Le compte n'a pas pu être déverrouillé."),
        variant: "destructive",
      });
    },
  });
  const submitUnlock = useSingleFlightMutate(unlock.mutate);

  const columns: PremiumDataTableColumn<LockedUser>[] = [
    {
      id: "user",
      header: "Utilisateur",
      cell: (u) => (
        <div>
          <p className="font-medium text-foreground">{u.name}</p>
          <p className="text-xs text-muted-foreground">{u.username}</p>
        </div>
      ),
    },
    { id: "role", header: "Rôle", cell: (u) => <span className="text-foreground">{u.role}</span> },
    { id: "failures", header: "Échecs", align: "right", cell: (u) => u.failedLoginCount },
    { id: "last", header: "Dernier échec", cell: (u) => formatDateTime(u.lastFailedLoginAt) },
    { id: "until", header: "Verrouillé jusqu'à", cell: (u) => formatLockTime(u.lockedUntil) ?? "-" },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (u) => (
        <Button size="sm" variant="outline" onClick={() => setTarget(u)}>
          <LockOpen className="mr-2 h-4 w-4" aria-hidden="true" />
          Déverrouiller
        </Button>
      ),
    },
  ];

  return (
    <PageLayout>
      <PageHeader
        title="Comptes verrouillés"
        subtitle="Comptes bloqués après des échecs de connexion successifs."
      />
      {query.isLoading || query.error ? (
        <LoadingError isLoading={query.isLoading} error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PremiumDataTable
          columns={columns}
          rows={query.data ?? []}
          rowKey={(u) => u.id}
          emptyState={
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <ShieldCheck className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Aucun compte verrouillé</p>
              <p className="text-sm text-muted-foreground">Les comptes bloqués apparaîtront ici.</p>
            </div>
          }
        />
      )}
      <AlertModal
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        variant="confirm"
        title="Déverrouiller ce compte ?"
        description={target ? `${target.name} pourra se reconnecter immédiatement.` : undefined}
        confirmLabel="Déverrouiller"
        cancelLabel="Annuler"
        onConfirm={() => target && submitUnlock({ id: target.id })}
      />
    </PageLayout>
  );
}
