import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { resolveContextualHelp } from "@/lib/contextual-help/resolve";
import type { ContextualHelpOverride } from "@/lib/contextual-help/types";
import { ContextualHelpPanel } from "./contextual-help-panel";
import { cn } from "@/lib/utils";

interface ContextualHelpButtonProps {
  override?: ContextualHelpOverride;
  className?: string;
  iconClassName?: string;
  align?: "navbar" | "inline";
}

export function ContextualHelpButton({
  override,
  className,
  iconClassName,
  align = "navbar",
}: ContextualHelpButtonProps) {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const { user } = useAuth();

  const resolvedHelp = useMemo(
    () => resolveContextualHelp(location, user?.role),
    [location, user?.role],
  );

  const pillClassName =
    align === "navbar"
      ? "h-10 w-10 min-w-10 rounded-full bg-red-500 text-white shadow-sm hover:bg-red-600 hover:text-white focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
      : "h-9 w-9 min-w-9 rounded-full bg-red-500 text-white shadow-sm hover:bg-red-600 hover:text-white";

  const iconSizeClassName = align === "navbar" ? "h-6 w-6" : "h-5 w-5";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative p-0 transition-all duration-200", pillClassName, className)}
          aria-label="Aide — comment utiliser cette page"
          data-testid="button-contextual-help"
          title="Comment faire ?"
        >
          <HelpCircle className={cn(iconSizeClassName, iconClassName)} strokeWidth={2.25} />
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="text-left pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-4 w-4 text-green-600" />
            Comment faire ?
          </SheetTitle>
          <SheetDescription>
            Touchez une action — on vous montre où cliquer sur la page.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 pr-1">
          {override ? (
            <ContextualHelpPanel help={override} isOverride />
          ) : (
            <ContextualHelpPanel
              help={resolvedHelp}
              roleLabel={resolvedHelp.roleLabel}
              onStepActivate={() => setOpen(false)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
