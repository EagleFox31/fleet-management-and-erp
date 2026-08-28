import { getRoleLabel, normalizeRole } from "./roles";
import { PAGE_HELP_MATCHERS, DEFAULT_PAGE_HELP } from "./registry";
import type { AppRole, HelpGuideStep, PageHelpEntry, ResolvedContextualHelp } from "./types";

function filterStepsForRole(steps: HelpGuideStep[], role: AppRole): HelpGuideStep[] {
  return steps.filter((step) => !step.roles || step.roles.length === 0 || step.roles.includes(role));
}

function resolveEntry(entry: PageHelpEntry, role: AppRole): PageHelpEntry {
  return {
    title: entry.title,
    intro: entry.intro,
    steps: filterStepsForRole(entry.steps, role),
  };
}

export function resolveContextualHelp(
  pathname: string,
  roleInput: string | null | undefined,
): ResolvedContextualHelp {
  const role = normalizeRole(roleInput);
  const matcher = PAGE_HELP_MATCHERS.find(({ test }) => test(pathname));
  const entry = resolveEntry(matcher?.entry ?? DEFAULT_PAGE_HELP, role);

  return {
    ...entry,
    pathname,
    role,
    roleLabel: getRoleLabel(role),
  };
}
