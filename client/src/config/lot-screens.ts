/**
 * Écrans du lot recette (plan 06, T-09) : une ligne par écran, déclarative.
 *
 * `App.tsx` en tire les routes, `sidebar.tsx` les entrées de menu. Un écran livré
 * remplace seulement son `component` dans `LOT_SCREEN_COMPONENTS` (voir
 * `lot-screen-components.ts`) : ni `App.tsx` ni la sidebar ne sont retouchées.
 *
 * Le drapeau est cosmétique côté client (masque le menu, route introuvable) ;
 * la vraie garde est `requireFeature` côté serveur.
 */
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  CircleDot,
  DatabaseBackup,
  Droplets,
  Files,
  Fuel,
  Lock,
  Receipt,
  ScrollText,
  Tag,
  Ticket,
  Milestone,
} from "lucide-react";
import {
  FINANCE_RECEIVABLE_READ_ROLES,
  FUEL_READ_ROLES,
  MISSION_OPERATIONS_READ_ROLES,
  PENDING_INVOICE_ROLES,
  STAFF_ROLES,
  TIME_TRACKING_READ_ROLES,
  TIRE_MOVEMENT_ROLES,
  VEHICLE_COST_ROLES,
  type AppRole,
} from "@shared/constants/roles";
import type { FeatureKey } from "@shared/feature-flags";

export type MenuGroup = "administration" | "maintenance" | "inventory" | "resources" | "top";

export type LotScreen = {
  id: string;
  /** Chemin wouter ; `:id` pour une ressource. */
  path: string;
  title: string;
  description: string;
  /** Tâche du plan qui livre le contenu réel. */
  task: string;
  feature?: FeatureKey;
  /** `"authenticated"` : tout utilisateur connecté. */
  roles: readonly AppRole[] | "authenticated";
  /** Mise en page autonome (PWA chauffeur) : sans sidebar. */
  standalone?: boolean;
  menu?: { group: MenuGroup; label: string; icon: LucideIcon };
};

const ADMIN = ["admin"] as const satisfies readonly AppRole[];
const WORKSHOP = ["admin", "workshop_manager"] as const satisfies readonly AppRole[];

export const LOT_SCREENS: readonly LotScreen[] = [
  // --- MUST : administration (T-31a, T-32a, T-33a)
  {
    id: "admin-locked-users", path: "/admin/locked-users", title: "Comptes verrouillés", task: "T-31a",
    description: "Comptes bloqués après des échecs de connexion, avec déverrouillage.",
    roles: ADMIN, menu: { group: "administration", label: "Comptes verrouillés", icon: Lock },
  },
  {
    id: "admin-audit-logs", path: "/admin/audit-logs", title: "Journal d'audit", task: "T-31a",
    description: "Qui a modifié quoi et quand, filtrable par utilisateur, période et objet.",
    roles: ADMIN, menu: { group: "administration", label: "Journal d'audit", icon: ScrollText },
  },
  {
    id: "admin-vehicle-document-types", path: "/admin/vehicle-document-types", title: "Types de document véhicule", task: "T-32a",
    description: "Référentiel des types de document et de leur durée de validité.",
    roles: ADMIN, menu: { group: "administration", label: "Types de document", icon: Files },
  },
  {
    id: "admin-backups", path: "/admin/backups", title: "Sauvegardes", task: "T-33a",
    description: "Dernière sauvegarde, historique et lancement manuel.",
    roles: ADMIN, menu: { group: "administration", label: "Sauvegardes", icon: DatabaseBackup },
  },
  {
    id: "scope", path: "/scope", title: "Périmètre et prochains lots", task: "T-36",
    description: "Ce que contient cette livraison et ce qui arrive ensuite.",
    roles: "authenticated", menu: { group: "administration", label: "Périmètre et prochains lots", icon: Milestone },
  },

  // --- SHOULD : atelier (T-51, T-52)
  {
    id: "incident-declare", path: "/driver/incident", title: "Déclarer une panne", task: "T-52", feature: "incidents",
    description: "Déclaration de panne par le chauffeur.",
    roles: ["driver", "admin"], standalone: true,
  },
  {
    id: "incidents-list", path: "/incidents", title: "Pannes déclarées", task: "T-52", feature: "incidents",
    description: "Pannes remontées par les chauffeurs, avec création de l'ordre de travail.",
    roles: WORKSHOP, menu: { group: "maintenance", label: "Pannes déclarées", icon: AlertTriangle },
  },
  {
    id: "wo-history", path: "/maintenance/work-orders/:id/history", title: "Historique de l'ordre de travail", task: "T-51",
    feature: "work-order-audit-trail", description: "Chronologie des changements d'un ordre de travail.",
    roles: STAFF_ROLES,
  },
  {
    id: "wo-quality-check", path: "/maintenance/work-orders/:id/quality-check", title: "Contrôle qualité", task: "T-51",
    feature: "quality-check", description: "Contrôle qualité avant clôture de l'ordre de travail.",
    roles: WORKSHOP,
  },
  {
    id: "oil-change-intervals", path: "/maintenance/oil-change-intervals", title: "Intervalles de vidange", task: "T-51",
    feature: "oil-change-prefill", description: "Intervalles de vidange préremplis par type de véhicule.",
    roles: WORKSHOP, menu: { group: "maintenance", label: "Intervalles de vidange", icon: Droplets },
  },
  {
    id: "tire-movements", path: "/inventory/tires/movements", title: "Mouvements de pneus", task: "T-52", feature: "tire-movements",
    description: "Journal des montages, démontages et rotations de pneus.",
    roles: TIRE_MOVEMENT_ROLES, menu: { group: "inventory", label: "Mouvements de pneus", icon: CircleDot },
  },

  // --- SHOULD : carburant et coût (T-53)
  {
    id: "fuel-vouchers", path: "/fuel/vouchers", title: "Bons de carburant", task: "T-53", feature: "fuel-vouchers",
    description: "Validation des bons de carburant.",
    roles: FUEL_READ_ROLES, menu: { group: "resources", label: "Bons de carburant", icon: Ticket },
  },
  {
    id: "fuel-anomalies", path: "/fuel/anomalies", title: "Anomalies carburant", task: "T-53", feature: "fuel-anomalies",
    description: "Traitement des anomalies de consommation.",
    roles: FUEL_READ_ROLES, menu: { group: "resources", label: "Anomalies carburant", icon: Fuel },
  },
  {
    id: "fuel-prices", path: "/fuel/prices", title: "Prix du carburant", task: "T-53", feature: "fuel-prices",
    description: "Prix du carburant datés.",
    roles: FUEL_READ_ROLES, menu: { group: "resources", label: "Prix du carburant", icon: Tag },
  },
  {
    id: "vehicle-cost", path: "/vehicles/:id/cost", title: "Coût du véhicule", task: "T-53", feature: "vehicle-cost-summary",
    description: "Coût cumulé d'un véhicule : carburant, pièces, main-d'oeuvre.",
    roles: VEHICLE_COST_ROLES,
  },

  // --- SHOULD : exploitation (T-54a)
  {
    id: "time-tracking", path: "/drivers/time-tracking", title: "Pointage", task: "T-54a", feature: "time-tracking",
    description: "Pointage mensuel des chauffeurs.",
    roles: TIME_TRACKING_READ_ROLES, menu: { group: "resources", label: "Pointage", icon: Clock },
  },
  {
    id: "pending-invoices", path: "/operations/pending-invoices", title: "Factures en attente", task: "T-54a", feature: "pending-invoices",
    description: "Factures clients en attente, triées par ancienneté.",
    roles: PENDING_INVOICE_ROLES, menu: { group: "top", label: "Factures en attente", icon: Receipt },
  },
  {
    id: "mission-operations", path: "/operations/tracking", title: "Suivi des opérations", task: "O1", feature: "operations-tracking",
    description: "Suivi des opérations par client : conteneur, BL, dates, durée, facturation.",
    roles: MISSION_OPERATIONS_READ_ROLES, menu: { group: "top", label: "Suivi des opérations", icon: ClipboardList },
  },
  // Entrée de menu en attente de l'alignement des menus (écarts n°2, 6 et 8).
  {
    id: "invoices-awaiting-payment", path: "/finance/invoices-awaiting-payment", title: "Factures en attente de paiement",
    task: "F1c", feature: "finance",
    description: "Factures émises non soldées : retenues à la source, net à payer, jours depuis le dépôt.",
    roles: FINANCE_RECEIVABLE_READ_ROLES,
  },
];

/** Entrées de menu existantes à masquer derrière un drapeau, par href. */
export const FEATURE_GATED_HREFS: Readonly<Record<string, FeatureKey>> = {
  "/management/reports/finance": "finance",
  "/management/reports/scheduled": "report-schedules",
};

export function canAccessLotScreen(screen: LotScreen, role: string | null | undefined): boolean {
  return screen.roles === "authenticated" ? Boolean(role) : screen.roles.includes(role as AppRole);
}

