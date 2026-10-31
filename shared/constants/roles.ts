import { users } from "@shared/schema";
/**
 * Source unique des groupes de rôles partagés entre le serveur et l'interface.
 *
 * Le projet a déjà payé cher la duplication des tables de vérité (libellés de
 * statut, permissions de sortie de stock). Un groupe de rôles recopié dans une
 * page finit toujours par diverger du middleware qui le contrôle: l'écran
 * affiche un bouton, l'API renvoie 403.
 *
 * Règle: si un groupe de rôles est lu des deux côtés, il vit ici.
 */

/**
 * Gestion des chauffeurs — création, modification, activation.
 *
 * La fiche chauffeur n'est pas un carnet d'adresses: c'est un dossier de
 * conformité (CNI, permis, formation CPC) qui décide si un homme peut prendre
 * la route. Trois métiers y touchent:
 * - `logistics`  affecte les chauffeurs aux missions, enregistre les arrivées;
 * - `secretary`  tient les papiers et les renouvellements;
 * - `admin`      en secours, plus le rattachement d'un compte de connexion.
 *
 * Doit rester aligné sur `isDriverManager` (server/middleware/auth.ts).
 */
export const DRIVER_MANAGER_ROLES = ["admin", "logistics", "secretary"] as const;

export type DriverManagerRole = (typeof DRIVER_MANAGER_ROLES)[number];

export function canManageDrivers(role: string | null | undefined): boolean {
  return DRIVER_MANAGER_ROLES.includes(String(role ?? "") as DriverManagerRole);
}

/**
 * Rôle applicatif — dérivé du schéma, jamais recopié.
 *
 * Il existait trois déclarations locales et divergentes de ce type
 * (`middleware/auth.ts`, `types/auth-session.d.ts`, `api/suppliers.routes.ts`):
 * l'une connaissait `management` sans `driver`, l'autre l'inverse, la troisième
 * ni l'un ni l'autre. Ajouter un rôle au schéma cassait donc la compilation à
 * des endroits sans rapport.
 *
 * En dérivant du schéma, un rôle ajouté à `users.role` est connu partout sans
 * autre geste.
 */
export type AppRole = NonNullable<typeof users.$inferSelect>["role"];

/** Liste des rôles à l'exécution, dans l'ordre du schéma. */
export const ALL_APP_ROLES = users.role.enumValues as readonly AppRole[];

/**
 * Approvisionnement — fournisseurs, commandes, factures fournisseur.
 *
 * Le chef d'atelier et le technicien en sont exclus: ils **demandent** des
 * pièces (`part_requirements`), ils ne passent pas les commandes ni ne
 * traitent les factures. C'est ce que dit déjà le menu — l'entrée
 * « Approvisionnement » n'existe que pour ces quatre profils — mais les routes
 * étaient en `PrivateRoute`, donc atteignables par n'importe quel connecté.
 *
 * Le lien demande → commande reste visible côté atelier: il est enrichi par
 * `attachPurchaseOrderContext` sur l'endpoint des demandes, sans passer par
 * l'API commandes.
 */
export const PROCUREMENT_ROLES = ["admin", "secretary", "logistics", "warehouse"] as const;

export type ProcurementRole = (typeof PROCUREMENT_ROLES)[number];

export function canAccessProcurement(role: string | null | undefined): boolean {
  return PROCUREMENT_ROLES.includes(String(role ?? "") as ProcurementRole);
}

/**
 * Indicateurs de pilotage (`/api/kpi/*`) : direction et administrateur.
 * Doit rester aligné sur `isManagementOrAdmin` (server/middleware/auth.ts).
 */
export const KPI_VIEWER_ROLES = ["admin", "management"] as const satisfies readonly AppRole[];

export function canViewKpi(role: string | null | undefined): boolean {
  return (KPI_VIEWER_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * Pointage des chauffeurs (`/api/time-tracking`) : la logistique et
 * l'administrateur saisissent, le secrétariat et la direction consultent.
 * Lu par `server/api/time-tracking.routes.ts` et par l'écran `time-tracking`
 * de `client/src/config/lot-screens.ts` : un seul endroit pour les deux.
 */
export const TIME_TRACKING_WRITE_ROLES = ["admin", "logistics"] as const satisfies readonly AppRole[];
export const TIME_TRACKING_READ_ROLES = [...TIME_TRACKING_WRITE_ROLES, "secretary", "management"] as const satisfies readonly AppRole[];

export function canWriteTimeTracking(role: string | null | undefined): boolean {
  return (TIME_TRACKING_WRITE_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * Carburant : bons (P-17) et anomalies (P-18).
 *
 * Valider un bon ou traiter une anomalie revient à ceux qui gèrent la carte
 * (`isFuelCardManager`, server/middleware/auth.ts, doit rester aligné). Le chef
 * d'atelier et la direction les consultent sans agir (décision du 31 octobre 2026) :
 * leurs écrans masquent Valider / Traiter au lieu d'afficher un bouton qui renvoie 403.
 */
export const FUEL_WRITE_ROLES = ["admin", "logistics", "secretary"] as const satisfies readonly AppRole[];
export const FUEL_READ_ROLES = [...FUEL_WRITE_ROLES, "workshop_manager", "management"] as const satisfies readonly AppRole[];

export function canWriteFuel(role: string | null | undefined): boolean {
  return (FUEL_WRITE_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * Prix du litre (P-19) : 828 FCFA par défaut (ligne datée 2000-01-01). Seuls
 * l'administrateur et la logistique le modifient (décision du 31 octobre 2026) ;
 * le secrétariat gère la carte mais ne fixe pas le prix. Ailleurs, le prix
 * proposé est celui du jour, en lecture seule.
 */
export const FUEL_PRICE_WRITE_ROLES = ["admin", "logistics"] as const satisfies readonly AppRole[];

export function canWriteFuelPrice(role: string | null | undefined): boolean {
  return (FUEL_PRICE_WRITE_ROLES as readonly string[]).includes(String(role ?? ""));
}

/** Mouvements de pneus (`GET /api/tires/movements`), lecture seule. */
export const TIRE_MOVEMENT_ROLES = ["admin", "management", "workshop_manager", "warehouse", "technician"] as const satisfies readonly AppRole[];

/** Factures client en attente (`/api/pending-invoices`). La direction y lit les indicateurs. */
export const PENDING_INVOICE_ROLES = ["admin", "management", "secretary", "logistics"] as const satisfies readonly AppRole[];

/** Coût d'un véhicule (`GET /api/vehicles/:id/cost-summary`). */
export const VEHICLE_COST_ROLES = ["admin", "management", "workshop_manager", "logistics"] as const satisfies readonly AppRole[];

/**
 * Tout le personnel : tout rôle sauf `client` (cloison client, AGENTS.md §11).
 * Lu par `isStaff` (server/middleware/auth.ts) et par les écrans qui en dépendent.
 */
export const STAFF_ROLES: readonly AppRole[] = ALL_APP_ROLES.filter((role) => role !== "client");
