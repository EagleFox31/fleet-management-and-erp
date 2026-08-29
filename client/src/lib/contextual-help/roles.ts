import type { AppRole } from "./types";

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Administrateur",
  workshop_manager: "Chef d'atelier",
  technician: "Technicien",
  secretary: "Secrétaire",
  logistics: "Logisticien",
  warehouse: "Magasinier",
  management: "Direction",
  client: "Client",
  driver: "Chauffeur",
  user: "Utilisateur",
};

const ROLE_ALIASES: Record<string, AppRole> = {
  administrateur: "admin",
  secretaire: "secretary",
  "secrétaire": "secretary",
  logisticien: "logistics",
  magasinier: "warehouse",
  directeur: "management",
  direction: "management",
  dg: "management",
};

export function normalizeRole(role: string | null | undefined): AppRole {
  const normalized = (role ?? "user").trim().toLowerCase();
  return ROLE_ALIASES[normalized] ?? (normalized as AppRole);
}

export function getRoleLabel(role: AppRole): string {
  return ROLE_LABELS[role] ?? ROLE_LABELS.user;
}
