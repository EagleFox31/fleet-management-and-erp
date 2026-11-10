export const APP_ROLES = [
  "admin",
  "workshop_manager",
  "technician",
  "secretary",
  "accountant",
  "logistics",
  "warehouse",
  "management",
  "client",
  "driver",
  "user",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** Une action concrète : clic → scroll + surbrillance sur la page */
export interface HelpGuideStep {
  label: string;
  target: string;
  /** Action préparatoire (changer d'onglet, ouvrir un formulaire…) — écoutée par la page */
  prepareAction?: string;
  /** Si défini, l'étape n'est visible que pour ces rôles */
  roles?: AppRole[];
}

export interface PageHelpEntry {
  title: string;
  /** Une phrase max */
  intro?: string;
  steps: HelpGuideStep[];
}

export interface ResolvedContextualHelp extends PageHelpEntry {
  role: AppRole;
  roleLabel: string;
  pathname: string;
}

export interface ContextualHelpOverride {
  title: string;
  description: string;
  tips?: string[];
  shortcuts?: { key: string; action: string }[];
}

export interface PageHelpMatcher {
  test: (pathname: string) => boolean;
  entry: PageHelpEntry;
}
