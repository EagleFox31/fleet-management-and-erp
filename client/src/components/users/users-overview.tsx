import { KpiGrid, KpiTile } from "@/components/design-system";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ShieldCheck, UserCheck, UserX, Users } from "lucide-react";

export type UsersOverviewRole =
  | "admin"
  | "management"
  | "workshop_manager"
  | "technician"
  | "secretary"
  | "accountant"
  | "logistics"
  | "warehouse"
  | "client"
  | "user";

export interface UsersOverviewStats {
  totalUsers: number;
  activeUsers: number;
  usersByRole: Record<string, number>;
}

interface UsersOverviewProps {
  stats?: UsersOverviewStats;
  isLoading: boolean;
  roleFilter: string;
  roleOrder: readonly UsersOverviewRole[];
  getRoleLabel: (role: string) => string;
  onRoleChange: (role: string) => void;
}

export function UsersOverview({
  stats,
  isLoading,
  roleFilter,
  roleOrder,
  getRoleLabel,
  onRoleChange,
}: UsersOverviewProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={`kpi-skeleton-${i}`} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={`role-skeleton-${i}`} className="h-7 w-28 rounded-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const inactiveUsersCount = Math.max(stats.totalUsers - stats.activeUsers, 0);
  const roleBreakdown = roleOrder.map((role) => ({
    role,
    count: stats.usersByRole[role] || 0,
  }));

  return (
    <div className="space-y-3">
      <KpiGrid columns={4} withTopBorder={false}>
        <KpiTile
          label="Total utilisateurs"
          value={stats.totalUsers}
          icon={<Users className="h-4 w-4" />}
          iconWrapperClassName="bg-gray-100 text-gray-600"
        />
        <KpiTile
          label="Utilisateurs actifs"
          value={stats.activeUsers}
          icon={<UserCheck className="h-4 w-4" />}
          iconWrapperClassName="bg-green-50 text-green-600"
        />
        <KpiTile
          label="Administrateurs"
          value={stats.usersByRole.admin || 0}
          icon={<ShieldCheck className="h-4 w-4" />}
          iconWrapperClassName="bg-blue-50 text-blue-500"
        />
        <KpiTile
          label="Utilisateurs inactifs"
          value={inactiveUsersCount}
          icon={<UserX className="h-4 w-4" />}
          iconWrapperClassName="bg-red-50 text-red-600"
        />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mr-1">
          Filtre rôle
        </span>
        <button
          onClick={() => onRoleChange("")}
          className={cn(
            "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
            roleFilter === ""
              ? "bg-gray-900 text-white border-gray-900"
              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
          )}
        >
          Tous ({stats.totalUsers})
        </button>
        {roleBreakdown.map(({ role, count }) => (
          <button
            key={role}
            onClick={() => onRoleChange(roleFilter === role ? "" : role)}
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              roleFilter === role
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            )}
          >
            {getRoleLabel(role)} ({count})
          </button>
        ))}
      </div>
    </div>
  );
}
