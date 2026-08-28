import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocation } from "wouter";
import { Users, UserPlus, Trash2, ChevronRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  role: string;
  loginCount: number;
  createdAt: string;
  lastLoginAt: string | null;
  isOnline?: boolean;
  deletedAt?: string | null;
}

interface AdminUsersResponse {
  users: User[];
  total: number;
}

const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  admin:            { label: 'Admin',          className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  workshop_manager: { label: 'Chef atelier',   className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  technician:       { label: 'Technicien',     className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  secretary:        { label: 'Secrétaire',     className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
  logistics:        { label: 'Logisticien',    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
  warehouse:        { label: 'Magasinier',     className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  client:           { label: 'Client',         className: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  user:             { label: 'Utilisateur',    className: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400' },
};

function RoleBadge({ role }: { role: string }) {
  const config = ROLE_CONFIG[role] || { label: role, className: 'bg-gray-100 text-gray-700' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

function LoginCountBadge({ count, lastLoginAt }: { count: number; lastLoginAt?: string | null }) {
  const numericCount = Number(count);
  const normalizedCount = Number.isFinite(numericCount) ? Math.max(0, Math.trunc(numericCount)) : 0;
  const safeCount = normalizedCount === 0 && lastLoginAt ? 1 : normalizedCount;
  const className =
    safeCount === 0
      ? "bg-rose-50 text-rose-700 border-rose-200"
      : safeCount < 5
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-emerald-50 text-emerald-700 border-emerald-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {safeCount} connexion{safeCount > 1 ? "s" : ""}
    </span>
  );
}

function PresenceBadge({ isOnline }: { isOnline?: boolean }) {
  const online = Boolean(isOnline);
  const className = online
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : "bg-slate-50 text-slate-600 border-slate-200";

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}>
      <span className={`mr-1.5 h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-slate-400"}`} />
      {online ? "En ligne" : "Hors-ligne"}
    </span>
  );
}

export function UsersTable() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<AdminUsersResponse>({
    queryKey: ["/api/admin/users", { limit: 50, offset: 0 }],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });
  const users = (data?.users || []).filter((user) => !user.deletedAt);

  const deactivateMutation = useMutation({
    mutationFn: (userId: number) => apiRequest("DELETE", `/api/users/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }),
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" /> Utilisateurs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Utilisateurs <span className="text-muted-foreground font-normal text-sm">({users.length})</span>
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setLocation('/admin/users')}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Ajouter
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex items-center justify-between px-6 py-3 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-primary">
                    {user.name?.charAt(0).toUpperCase() || user.username?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user.name}</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
                    <LoginCountBadge count={user.loginCount} lastLoginAt={user.lastLoginAt} />
                    <PresenceBadge isOnline={user.isOnline} />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 ml-3">
                <RoleBadge role={user.role} />
                <span className="text-xs text-muted-foreground hidden md:block">
                  {user.lastLoginAt
                    ? formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true, locale: fr })
                    : 'Jamais connecté'}
                </span>
                {user.role !== 'admin' && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    title="Désactiver l'utilisateur"
                    onClick={() => deactivateMutation.mutate(user.id)}
                    disabled={deactivateMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-3 border-t">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={() => setLocation('/admin/users')}
          >
            Gérer tous les utilisateurs
            <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
