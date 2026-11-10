import { ROLE_LABELS } from "@shared/constants/roles";
import type { AppRole } from "./types";

const ROLE_ALIASES: Record<string, AppRole> = {
  administrateur: "admin",
  secretaire: "secretary",
  "secrétaire": "secretary",
  comptable: "accountant",
  lecteur: "viewer",
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

/** Libellé d'un rôle tel que stocké (code ou alias) : table unique de l'UI. */
export function roleLabelOf(role: string | null | undefined): string {
  return getRoleLabel(normalizeRole(role));
}
