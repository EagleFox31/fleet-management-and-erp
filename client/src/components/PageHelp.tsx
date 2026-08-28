import { ContextualHelpButton } from "@/components/help/contextual-help-button";
import type { ContextualHelpOverride } from "@/lib/contextual-help/types";

interface PageHelpProps extends ContextualHelpOverride {}

/** @deprecated Préférez ContextualHelpButton — conservé pour compatibilité PageHeader */
export function PageHelp(props: PageHelpProps) {
  return <ContextualHelpButton override={props} align="inline" />;
}

export function PageHelpButton(props: PageHelpProps) {
  return <PageHelp {...props} />;
}

export { ContextualHelpButton } from "@/components/help/contextual-help-button";
