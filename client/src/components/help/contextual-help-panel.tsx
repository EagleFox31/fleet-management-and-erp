import { ChevronRight, HelpCircle, Lightbulb } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { executeHelpStep } from "@/lib/contextual-help/scroll-to-target";
import type { ContextualHelpOverride, HelpGuideStep, ResolvedContextualHelp } from "@/lib/contextual-help/types";
import { cn } from "@/lib/utils";

interface ContextualHelpPanelProps {
  help: ResolvedContextualHelp | ContextualHelpOverride;
  roleLabel?: string;
  isOverride?: boolean;
  onStepActivate?: () => void;
}

function OverridePanel({ help }: { help: ContextualHelpOverride }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 leading-relaxed">{help.description}</p>
      {help.tips?.map((tip, index) => (
        <p key={index} className="text-sm text-gray-700 flex gap-2">
          <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          {tip}
        </p>
      ))}
    </div>
  );
}

function StepButton({
  step,
  onActivate,
}: {
  step: HelpGuideStep;
  onActivate: (step: HelpGuideStep) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onActivate(step)}
      className={cn(
        "w-full flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3.5 text-left",
        "hover:border-green-200 hover:bg-green-50/60 transition-colors group",
      )}
      data-testid={`help-step-${step.label.slice(0, 24).replace(/\s+/g, "-").toLowerCase()}`}
    >
      <span className="flex-1 text-sm font-medium text-gray-800 group-hover:text-green-900">
        {step.label}
      </span>
      <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-green-600 shrink-0" />
    </button>
  );
}

function GuidePanel({
  help,
  roleLabel,
  onStepActivate,
}: {
  help: ResolvedContextualHelp;
  roleLabel: string;
  onStepActivate?: () => void;
}) {
  const handleStep = (step: HelpGuideStep) => {
    executeHelpStep(step, { onBeforeScroll: onStepActivate });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900">{help.title}</h3>
        <Badge variant="outline" className="shrink-0 text-[11px] border-green-200 text-green-700 bg-green-50">
          {roleLabel}
        </Badge>
      </div>

      {help.intro && (
        <p className="text-sm text-gray-500">{help.intro}</p>
      )}

      {help.steps.length > 0 ? (
        <ul className="space-y-2">
          {help.steps.map((step) => (
            <li key={`${step.label}-${step.target}`}>
              <StepButton step={step} onActivate={handleStep} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500 rounded-xl bg-gray-50 px-4 py-3">
          Rien de spécifique pour votre profil sur cette page. Utilisez le menu à gauche.
        </p>
      )}

      <p className="text-xs text-gray-400 pt-1">
        Astuce : la zone concernée clignote en vert sur la page.
      </p>
    </div>
  );
}

export function ContextualHelpPanel({ help, roleLabel, isOverride, onStepActivate }: ContextualHelpPanelProps) {
  if (isOverride && "description" in help) {
    return <OverridePanel help={help as ContextualHelpOverride} />;
  }

  return (
    <GuidePanel
      help={help as ResolvedContextualHelp}
      roleLabel={roleLabel ?? (help as ResolvedContextualHelp).roleLabel}
      onStepActivate={onStepActivate}
    />
  );
}

export { HelpCircle };
