import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Car,
  FileText,
  Gauge,
  GraduationCap,
  Handshake,
  HardHat,
  MapPinned,
  MessageSquareWarning,
  Package,
  Route,
  Timer,
  Truck,
  UserCog,
  Users,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CardShell, IconSquare, SectionLabel } from "@/components/design-system";
import type { IconSquareTone } from "@/components/design-system/icon-square";
import type {
  ManagementTeamDecision,
  ManagementTeamPole,
  ManagementTeamPoleId,
} from "@shared/constants/management-team";

export const POLE_VISUALS: Record<
  ManagementTeamPoleId,
  { icon: LucideIcon; tone: IconSquareTone; accent: string; ring: string }
> = {
  operations: {
    icon: Route,
    tone: "blue",
    accent: "from-blue-500 to-sky-400",
    ring: "ring-blue-200",
  },
  workshop: {
    icon: Wrench,
    tone: "amber",
    accent: "from-amber-500 to-orange-400",
    ring: "ring-amber-200",
  },
  warehouse: {
    icon: Package,
    tone: "green",
    accent: "from-emerald-500 to-green-400",
    ring: "ring-emerald-200",
  },
};

export const ROLE_VISUALS: Record<
  string,
  { icon: LucideIcon; tone: IconSquareTone }
> = {
  logistics: { icon: MapPinned, tone: "blue" },
  secretary: { icon: FileText, tone: "blue" },
  driver: { icon: Car, tone: "blue" },
  workshop_manager: { icon: UserCog, tone: "amber" },
  technician: { icon: HardHat, tone: "amber" },
  warehouse: { icon: Boxes, tone: "green" },
  field_driver: { icon: Car, tone: "blue" },
};

const DECISION_ICONS: Record<string, LucideIcon> = {
  "cpc-gap": GraduationCap,
  "driver-incidents": MessageSquareWarning,
  "driver-performance": Gauge,
  "fleet-oos": Truck,
  "fleet-immobilized": Timer,
};

const FLOW_STEPS: Array<{ poleId: ManagementTeamPoleId; label: string; hint: string }> = [
  { poleId: "operations", label: "Exploitation", hint: "Missions & planning" },
  { poleId: "workshop", label: "Atelier", hint: "Maintenance & dépannage" },
  { poleId: "warehouse", label: "Magasin", hint: "Pièces & pneus" },
];

type TeamRoleChipProps = {
  role: string;
  label: string;
  count: number;
};

export function TeamRoleChip({ role, label, count }: TeamRoleChipProps) {
  const visual = ROLE_VISUALS[role] ?? { icon: Users, tone: "gray" as IconSquareTone };
  const Icon = visual.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
        "bg-white shadow-sm transition-transform hover:scale-[1.02]",
        visual.tone === "blue" && "border-blue-100 text-blue-800",
        visual.tone === "amber" && "border-amber-100 text-amber-900",
        visual.tone === "green" && "border-emerald-100 text-emerald-800",
        visual.tone === "gray" && "border-gray-200 text-gray-700",
      )}
    >
      <IconSquare size="sm" tone={visual.tone}>
        <Icon className="h-3.5 w-3.5" />
      </IconSquare>
      <span>{count}</span>
      <span className="text-muted-foreground font-normal">{label}</span>
    </span>
  );
}

type TeamFlowStripProps = {
  selectedPoleId: ManagementTeamPoleId | null;
  onSelectPole: (poleId: ManagementTeamPoleId) => void;
};

export function TeamFlowStrip({ selectedPoleId, onSelectPole }: TeamFlowStripProps) {
  return (
    <CardShell>
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <IconSquare size="lg" tone="green">
            <Handshake className="h-5 w-5" />
          </IconSquare>
          <div>
            <SectionLabel>Coordination entre pôles</SectionLabel>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cliquez un maillon pour mettre en avant l&apos;effectif correspondant
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {FLOW_STEPS.map((step, index) => {
            const visual = POLE_VISUALS[step.poleId];
            const Icon = visual.icon;
            const isSelected = selectedPoleId === step.poleId;

            return (
              <div key={step.poleId} className="flex items-center gap-2 lg:flex-1">
                <button
                  type="button"
                  onClick={() => onSelectPole(step.poleId)}
                  className={cn(
                    "group flex flex-1 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all",
                    "hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? cn("border-transparent bg-white shadow-md ring-2", visual.ring)
                      : "border-gray-100 bg-gray-50/80",
                  )}
                >
                  <IconSquare size="lg" tone={visual.tone}>
                    <Icon className="h-5 w-5" />
                  </IconSquare>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{step.label}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{step.hint}</p>
                  </div>
                </button>
                {index < FLOW_STEPS.length - 1 ? (
                  <ArrowRight className="hidden lg:block h-4 w-4 shrink-0 text-muted-foreground" />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </CardShell>
  );
}

type TeamPoleCardProps = {
  pole: ManagementTeamPole;
  driversFieldCount?: number;
  selected: boolean;
  onSelect: () => void;
};

export function TeamPoleCard({ pole, driversFieldCount, selected, onSelect }: TeamPoleCardProps) {
  const visual = POLE_VISUALS[pole.id];
  const Icon = visual.icon;

  return (
    <CardShell
      className={cn(
        "transition-all duration-200 cursor-pointer hover:shadow-md hover:-translate-y-0.5",
        selected && cn("ring-2 shadow-md", visual.ring),
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <div className={cn("h-1.5 w-full bg-gradient-to-r", visual.accent)} />
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <SectionLabel>{pole.label}</SectionLabel>
            <p className="text-xs text-muted-foreground mt-1">{pole.caption}</p>
          </div>
          <IconSquare size="lg" tone={visual.tone}>
            <Icon className="h-5 w-5" />
          </IconSquare>
        </div>

        <div className="flex items-end gap-2">
          <p className="text-3xl font-bold text-gray-900">{pole.appAccountCount}</p>
          <p className="text-sm text-muted-foreground pb-1">compte(s) actif(s)</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {pole.roleBreakdown.length > 0 ? (
            pole.roleBreakdown.map((entry) => (
              <TeamRoleChip
                key={entry.role}
                role={entry.role}
                label={entry.label}
                count={entry.count}
              />
            ))
          ) : (
            <span className="text-sm text-muted-foreground">Aucun compte actif</span>
          )}
          {pole.id === "operations" && driversFieldCount != null && driversFieldCount > 0 ? (
            <TeamRoleChip role="field_driver" label="conducteurs terrain" count={driversFieldCount} />
          ) : null}
        </div>
      </div>
    </CardShell>
  );
}

export function getDecisionIcon(decision: ManagementTeamDecision): LucideIcon {
  return DECISION_ICONS[decision.id] ?? AlertTriangle;
}

export function poleMatchesDecision(
  poleId: ManagementTeamPoleId,
  decisionId: string,
): boolean {
  if (poleId === "operations") {
    return decisionId.startsWith("driver-") || decisionId === "cpc-gap";
  }
  if (poleId === "workshop") {
    return decisionId.startsWith("fleet-");
  }
  return false;
}
