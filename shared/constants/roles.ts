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
 * Lecteurs des données personnelles de la fiche chauffeur (CNI, permis, naissance) : les
 * gestionnaires, plus la direction qui lit sans gérer (elle n'entre pas dans `DRIVER_MANAGER_ROLES`,
 * donc `isDriverManager` lui reste fermé).
 */
export const DRIVER_PERSONAL_DATA_READER_ROLES = [
  ...DRIVER_MANAGER_ROLES,
  "management",
] as const satisfies readonly AppRole[];

export function canReadDriverPersonalData(role: string | null | undefined): boolean {
  return (DRIVER_PERSONAL_DATA_READER_ROLES as readonly string[]).includes(String(role ?? ""));
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
 * Libellés français des rôles : source unique (UI et exports).
 * `Record<AppRole, string>` : un rôle ajouté au schéma sans libellé casse `tsc`.
 */
export const ROLE_LABELS: Record<AppRole, string> = {
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

/**
 * Consultation des fournisseurs : les profils d'approvisionnement, plus le chef
 * d'atelier qui lit les fiches sans rien écrire (création, modification,
 * évaluation et désactivation restent à PROCUREMENT_ROLES).
 */
export const SUPPLIER_READ_ROLES = [...PROCUREMENT_ROLES, "workshop_manager"] as const;

export function canAccessProcurement(role: string | null | undefined): boolean {
  return PROCUREMENT_ROLES.includes(String(role ?? "") as ProcurementRole);
}

/**
 * Indicateurs de pilotage (`/api/kpi/*`) : direction, administrateur et chef d'atelier
 * (le cahier des charges lui donne les pannes, le préventif et les coûts de son atelier).
 * La garde de `server/api/kpi.routes.ts` et celle de l'export `kpi-report` en dérivent.
 */
export const KPI_VIEWER_ROLES = ["admin", "management", "workshop_manager"] as const satisfies readonly AppRole[];

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

/** Journal de trésorerie (T1) : saisie par l'administrateur et le secrétariat ; la direction lit. */
export const TREASURY_WRITE_ROLES = ["admin", "secretary"] as const satisfies readonly AppRole[];
export const TREASURY_READ_ROLES = ["admin", "secretary", "management"] as const satisfies readonly AppRole[];

/** Factures client en attente (`/api/pending-invoices`). La direction y lit les indicateurs. */
export const PENDING_INVOICE_ROLES = ["admin", "management", "secretary", "logistics"] as const satisfies readonly AppRole[];

/** Budget de mission (L1, `/api/mission-budgets`) : la logistique saisit, la direction approuve et décaisse. */
export const MISSION_BUDGET_WRITE_ROLES = ["admin", "logistics"] as const satisfies readonly AppRole[];
export const MISSION_BUDGET_APPROVE_ROLES = ["admin", "management"] as const satisfies readonly AppRole[];
export const MISSION_BUDGET_READ_ROLES = ["admin", "logistics", "management"] as const satisfies readonly AppRole[];

/**
 * Factures en attente de paiement et retenues à la source (lot F1, `/api/finance/...`) : lecture.
 * La logistique lit les retenues, le net et les taux : son suivi « opération et facturation » les porte déjà
 * (décision du 2026-11-05). Elle n'écrit rien (FINANCE_RECEIVABLE_WRITE_ROLES).
 */
export const FINANCE_RECEIVABLE_READ_ROLES = ["admin", "management", "secretary", "logistics"] as const satisfies readonly AppRole[];

/** Dépôt d'une facture chez le client, taux de retenue d'un client : saisie (la direction lit). */
export const FINANCE_RECEIVABLE_WRITE_ROLES = ["admin", "secretary"] as const satisfies readonly AppRole[];

export function canReadFinanceReceivable(role: string | null | undefined): boolean {
  return (FINANCE_RECEIVABLE_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

export function canWriteFinanceReceivable(role: string | null | undefined): boolean {
  return (FINANCE_RECEIVABLE_WRITE_ROLES as readonly string[]).includes(String(role ?? ""));
}

/** Suivi des opérations clients (`mission_operations`) : saisie par l'administration et la logistique. */
export const MISSION_OPERATIONS_WRITE_ROLES = ["admin", "logistics"] as const satisfies readonly AppRole[];
/** Lecture du suivi des opérations : + secrétariat et direction. */
export const MISSION_OPERATIONS_READ_ROLES = ["admin", "logistics", "secretary", "management"] as const satisfies readonly AppRole[];

/**
 * Demandes de renouvellement de documents : création et rapprochement (secrétariat,
 * logistique, atelier). Source unique de `isDocumentRenewalWriter` (middleware) et
 * des contrôles de `server/api/document-renewals.routes.ts`.
 */
export const DOCUMENT_RENEWAL_WRITER_ROLES = ["admin", "secretary", "logistics", "workshop_manager"] as const satisfies readonly AppRole[];

/**
 * Lecture des centres et des demandes de renouvellement (`GET /centers`, `GET /requests`) :
 * les écrivains plus le technicien. Source unique du routeur et de l'événement temps réel
 * `document_renewal_center_changed`.
 */
export const DOCUMENT_RENEWAL_VIEWER_ROLES = [...DOCUMENT_RENEWAL_WRITER_ROLES, "technician"] as const satisfies readonly AppRole[];

/**
 * Modification d'un véhicule (`PATCH /api/vehicles/:id`) : l'administrateur et le chef
 * d'atelier modifient toute la fiche. La logistique ne saisit que la capacité des
 * réservoirs (`tankCapacityL`, FUEL3, décision du 2 novembre 2026), aucun autre champ.
 */
export const VEHICLE_EDIT_ROLES = ["admin", "workshop_manager"] as const satisfies readonly AppRole[];
export const VEHICLE_TANK_CAPACITY_ONLY_ROLES = ["logistics"] as const satisfies readonly AppRole[];
/** Secrétariat : atteint le PATCH véhicule pour le seul prix d'achat (décision du 3 novembre 2026). */
export const VEHICLE_PRICE_ONLY_PATCH_ROLES = ["secretary"] as const satisfies readonly AppRole[];
export const VEHICLE_PATCH_ROLES = [...VEHICLE_EDIT_ROLES, ...VEHICLE_TANK_CAPACITY_ONLY_ROLES, ...VEHICLE_PRICE_ONLY_PATCH_ROLES] as const satisfies readonly AppRole[];

/**
 * Champs que les rôles hors `VEHICLE_EDIT_ROLES` peuvent envoyer au PATCH véhicule. Tout autre champ,
 * ou un corps vide, est refusé en 403.
 */
export const VEHICLE_RESTRICTED_PATCH_FIELDS: Readonly<Record<string, readonly string[]>> = {
  logistics: ["tankCapacityL", "purchasePrice"],
  secretary: ["purchasePrice"],
};

/**
 * Gestionnaires de la carte carburant (`isFuelCardManager`). Seuls eux suppriment un plein qui a
 * mouvementé la carte : le service de suppression relit cette liste sous verrou.
 */
export const FUEL_CARD_MANAGER_ROLES = ["admin", "logistics", "secretary"] as const satisfies readonly AppRole[];

/** Saisie de la capacité des réservoirs : tous les rôles du PATCH véhicule. */
export function canEditTankCapacity(role: string | null | undefined): boolean {
  return ([...VEHICLE_EDIT_ROLES, ...VEHICLE_TANK_CAPACITY_ONLY_ROLES] as readonly string[]).includes(String(role ?? ""));
}

/**
 * Lecture du prix d'achat d'un véhicule (`vehicles.purchasePrice`), décision du 3 novembre 2026 :
 * administrateur, logistique et secrétariat seulement. Tout autre rôle (chauffeur, client, chef
 * d'atelier, technicien, magasinier, direction…) ne le reçoit ni dans les réponses des routes
 * véhicule, mission, pneus, coûts de mission et exports, ni dans les trames temps réel.
 * Le serveur le retire par `redactVehiclePrice[Deep]` (server/lib/vehicle-price-scope.ts) ; l'interface
 * masque le bloc avec `canReadVehiclePurchasePrice`. Un test d'hygiène
 * (tests/unit/server/vehicle-select-hygiene.test.ts) gèle les lectures entières de `vehicles`.
 *
 * Le tableau de bord de direction (rôle management) sert la valeur d'acquisition par véhicule
 * (`acquisitionHT`) : c'est voulu, la direction la voit.
 */
export const VEHICLE_PURCHASE_PRICE_READ_ROLES = ["admin", "logistics", "secretary"] as const satisfies readonly AppRole[];

export function canReadVehiclePurchasePrice(role: string | null | undefined): boolean {
  return (VEHICLE_PURCHASE_PRICE_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * Écriture du prix d'achat (décision du 3 novembre 2026) : administrateur, logistique et secrétariat.
 * La direction reste en lecture seule, le chef d'atelier n'y a pas droit. Cette liste ne change pas
 * qui peut appeler `PATCH` ou `POST /api/vehicles` : elle refuse seulement la clé `purchasePrice`
 * aux autres rôles.
 */
export const VEHICLE_PURCHASE_PRICE_WRITE_ROLES = ["admin", "logistics", "secretary"] as const satisfies readonly AppRole[];

export function canWriteVehiclePurchasePrice(role: string | null | undefined): boolean {
  return (VEHICLE_PURCHASE_PRICE_WRITE_ROLES as readonly string[]).includes(String(role ?? ""));
}

/** Coût d'un véhicule (`GET /api/vehicles/:id/cost-summary`). */
export const VEHICLE_COST_ROLES = ["admin", "management", "workshop_manager", "logistics"] as const satisfies readonly AppRole[];

/**
 * Rapports d'exploitation : inventaire des pièces (`GET /api/reports/inventory`) et
 * performance des techniciens (`GET /api/reports/technician-performance`).
 * Lus par `isInventoryReportReader` / `isTechnicianReportReader` et par l'écran `/reports`.
 */
export const INVENTORY_REPORT_ROLES = ["admin", "management", "workshop_manager", "warehouse", "secretary"] as const satisfies readonly AppRole[];
export const TECHNICIAN_REPORT_ROLES = ["admin", "management", "workshop_manager"] as const satisfies readonly AppRole[];

export function canReadInventoryReport(role: string | null | undefined): boolean {
  return (INVENTORY_REPORT_ROLES as readonly string[]).includes(String(role ?? ""));
}

export function canReadTechnicianReport(role: string | null | undefined): boolean {
  return (TECHNICIAN_REPORT_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * Tout le personnel : tout rôle sauf `client` (cloison client, AGENTS.md §11).
 * Lu par `isStaff` (server/middleware/auth.ts) et par les écrans qui en dépendent.
 */
export const STAFF_ROLES: readonly AppRole[] = ALL_APP_ROLES.filter((role) => role !== "client");

/**
 * Coût d'un OT (taux horaire servi par `GET /api/work-orders/:id/labor-rate`) : le personnel
 * sauf le chauffeur, qui n'a pas à connaître les coûts d'atelier.
 */
export const WORK_ORDER_COST_READ_ROLES: readonly AppRole[] = STAFF_ROLES.filter((role) => role !== "driver");

/**
 * Destinataires des événements temps réel sur les papiers d'un véhicule (dépôt, suppression) :
 * ils portent véhicule, type, échéance et acteur de toute la flotte. Le personnel hors
 * chauffeur ; ni client ni chauffeur (cloison, AGENTS.md §11).
 */
export const VEHICLE_DOCUMENT_EVENT_ROLES: readonly AppRole[] = STAFF_ROLES.filter((role) => role !== "driver");

/**
 * Destinataires de la trame complète des événements de mission (création, modification, statut,
 * plein) : le routeur missions est réservé au personnel (`isStaff`) et la trame porte client,
 * adresses, coûts et plein de toute la flotte. Le chauffeur affecté reçoit à part une trame
 * réduite à l'identifiant ; un client ne reçoit rien (AGENTS.md §11).
 */
export const MISSION_EVENT_ROLES: readonly AppRole[] = STAFF_ROLES.filter((role) => role !== "driver");

/**
 * Destinataires des événements du catalogue pièces (création, modification, suppression, ajustement
 * de stock) : le personnel qui lit le stock et ses prix, sans le chauffeur ni le client
 * (AGENTS.md §11).
 */
export const PART_CATALOG_EVENT_ROLES: readonly AppRole[] = STAFF_ROLES.filter((role) => role !== "driver");

/**
 * Coûts, rapprochement par client et statistiques d'exploitation (`/api/operations`) : le
 * personnel sauf le chauffeur, même pour sa propre mission (amortissement tiré du prix d'achat,
 * agrégats de toute la flotte). Décision du 3 novembre 2026.
 */
export const OPERATIONS_COST_READ_ROLES: readonly AppRole[] = STAFF_ROLES.filter((role) => role !== "driver");

/**
 * Destinataires des événements de facturation client (création, paiement, retard) : les rôles
 * qui lisent la facturation (`authorize` de `server/api/billing.routes.ts`). La facture est celle
 * d'un client de flotte (table `clients`), pas d'un compte : aucun compte `client` n'en reçoit.
 */
export const CLIENT_BILLING_EVENT_ROLES: readonly AppRole[] = ["admin", "secretary", "logistics"];

/**
 * Statistiques de facturation client (`GET /api/billing/statistics`, graphique CA par client) : les
 * roles de la facturation plus la direction, qui lit le chiffre d'affaires sans recevoir les
 * evenements de facture. Decision du 5 novembre 2026. Liste distincte de
 * `CLIENT_BILLING_EVENT_ROLES`, qui garde les autres routes et le ciblage WebSocket.
 */
export const CLIENT_BILLING_STATS_ROLES: readonly AppRole[] = [...CLIENT_BILLING_EVENT_ROLES, "management"];

export function canReadClientBilling(role: string | null | undefined): boolean {
  return (CLIENT_BILLING_STATS_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * Guides et cahier de tests servis par `GET /api/documentation` : la route serveur est réservée
 * à l'admin (`isAdmin`). Un autre rôle ne doit ni émettre la requête ni voir l'onglet.
 */
export const DOCUMENTATION_READ_ROLES = ["admin"] as const satisfies readonly AppRole[];

export function canReadDocumentation(role: string | null | undefined): boolean {
  return (DOCUMENTATION_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

export function canReadWorkOrderCost(role: string | null | undefined): boolean {
  return (WORK_ORDER_COST_READ_ROLES as readonly string[]).includes(String(role ?? ""));
}

/**
 * Écarts du cahier des charges (chantier CDC, lot CDC-0a). Groupes lus par le montage
 * de `server/api/index.ts` et, plus tard, par les écrans : ne pas les recopier.
 */

/** Impression des étiquettes QR des pièces. */
export const PART_LABEL_ROLES = ["admin", "warehouse"] as const satisfies readonly AppRole[];

/** Scan d'une pièce (`/api/part-scans`) : magasin et atelier. */
export const PART_SCAN_ROLES = ["admin", "warehouse", "workshop_manager", "technician"] as const satisfies readonly AppRole[];

/**
 * Vente de pièces, écriture. Provisoire, décision utilisateur #4 : le groupe
 * définitif n'est pas arrêté.
 */
export const PART_SALE_ROLES = ["admin", "warehouse", "secretary"] as const satisfies readonly AppRole[];

/**
 * Vente de pièces, lecture : les rôles d'écriture, plus la direction (lecture seule).
 * Provisoire, décision utilisateur #4.
 */
export const PART_SALE_READ_ROLES = [...PART_SALE_ROLES, "management"] as const satisfies readonly AppRole[];

/** Positions GPS des véhicules (`/api/vehicle-positions`). Pas de vue client prévue à ce stade. */
export const GPS_VIEW_ROLES = ["admin", "logistics", "management", "workshop_manager"] as const satisfies readonly AppRole[];

/** Import Excel, tous types sauf les interventions. */
export const IMPORT_ROLES = ["admin"] as const satisfies readonly AppRole[];

/** Import Excel des interventions : le chef d'atelier s'ajoute à l'administrateur. */
export const IMPORT_INTERVENTION_ROLES = ["admin", "workshop_manager"] as const satisfies readonly AppRole[];

/** Rapport de maintenance (`/api/maintenance-reports`). */
export const MAINTENANCE_REPORT_ROLES = ["admin", "workshop_manager", "management"] as const satisfies readonly AppRole[];

/**
 * Gestionnaires de missions : édition d'une mission (`PATCH /api/missions/:id`) — coût carburant,
 * dates, budgets, chauffeur et véhicule. Aligné sur `MISSION_FUEL_MANAGERS` et `isDriverManager`.
 * Le chauffeur affecté n'y figure pas : il n'a aucune écriture légitime par cette route.
 */
export const MISSION_MANAGER_ROLES = ["admin", "logistics", "secretary"] as const satisfies readonly AppRole[];

/**
 * Changement de statut d'une mission (`PUT /api/missions/:id/status`) : gestionnaires et chauffeur.
 * Le chauffeur n'agit que sur ses missions : la cloison `router.param("id")` du routeur le garantit.
 */
export const MISSION_STATUS_ROLES = [...MISSION_MANAGER_ROLES, "driver"] as const satisfies readonly AppRole[];

/**
 * Statuts qu'un rôle hors `MISSION_MANAGER_ROLES` (le chauffeur affecté) peut viser par
 * `PUT /api/missions/:id/status` : démarrer et livrer. Clôturer (`completed`, qui écrit le coût
 * réel) et annuler restent aux gestionnaires : le chauffeur n'écrit aucun montant (décision du 3/11).
 */
export const DRIVER_MISSION_STATUS_TARGETS = ["in_progress", "delivered"] as const;

/** Vrai si `role` peut viser `targetStatus` par `PUT /api/missions/:id/status`. */
export function canRoleSetMissionStatus(role: string | null | undefined, targetStatus: string): boolean {
  const r = String(role || "");
  if ((MISSION_MANAGER_ROLES as readonly string[]).includes(r)) return true;
  if (!(MISSION_STATUS_ROLES as readonly string[]).includes(r)) return false;
  return (DRIVER_MISSION_STATUS_TARGETS as readonly string[]).includes(targetStatus);
}

/** Avis de maintenance rattachés aux missions (`/api/mission-advisories`) : logistique et atelier. */
export const MISSION_ADVISORY_ROLES = ["admin", "logistics", "workshop_manager"] as const satisfies readonly AppRole[];

/**
 * Gestion des demandes de pièce (`PATCH /api/part-requirements/:id`, `isInventoryManager`).
 * Toute transition de `STATUS_PERMISSIONS` doit rester dans ce jeu, sinon le droit est mort.
 */
export const INVENTORY_MANAGER_ROLES = ["admin", "workshop_manager", "warehouse", "secretary"] as const satisfies readonly AppRole[];

/**
 * Contrôles inopinés QHSE (lot Q1). Saisie et lecture de tous les contrôles : l'administration, la
 * direction et la logistique (qui initie les contrôles sur itinéraire). Le chauffeur lit seulement
 * les siens (cloison `driverScopeOf`), il n'entre pas dans ce groupe.
 * Doit rester aligné sur les gardes de `server/api/qhse-inspections.routes.ts`.
 */
export const QHSE_INSPECTION_ROLES = ["admin", "management", "logistics"] as const satisfies readonly AppRole[];

/** Grille de critères (référentiel configurable) : l'administration et la direction la modifient. */
export const QHSE_CRITERIA_MANAGER_ROLES = ["admin", "management"] as const satisfies readonly AppRole[];
