/**
 * Couche 3 de AGENTS.md §2, écrans satellites : table déclarative événement -> groupes de queries.
 *
 * Un groupe réunit les écrans qu'un même fait métier fait bouger (stock, argent, statut). Un
 * événement déclare les faits qu'il porte, jamais les clés une à une : ajouter un écran à un
 * groupe le rafraîchit pour tous les événements du groupe. Les clés dépendant d'un identifiant
 * (`/api/work-orders/${id}`) restent dans le case de `useRealTimeSync.ts`.
 *
 * Clés : premier élément d'une `queryKey` posée par un écran. TanStack compare élément par
 * élément : `["/api/warehouse/parts"]` atteint `["/api/warehouse/parts", id, "real-stock"]`, mais
 * `["/api/fuel-card"]` n'atteint pas `["/api/fuel-card/balance"]`. Un préfixe (`prefixes`) vise
 * les clés construites avec un identifiant dans la chaîne (`/api/work-orders/vehicle/${id}`).
 *
 * Garde-fou : `tests/unit/client/realtime-satellites.test.ts`.
 */
import { KPI_QUERY_KEYS, WAREHOUSE_QUERY_KEYS } from "@shared/contracts/realtime-events";
import { TREASURY_BASE_PATH } from "@shared/contracts/treasury";

/**
 * `byId` : clés d'un seul objet, gabarit à `:vehicleId`, `:registrationNumber` ou `:missionId` rempli depuis la
 * charge de l'événement (`vehicleId`, `vehicle.registrationNumber`, `missionId`). Sans identifiant dans la charge,
 * repli sur `byIdFallbackPrefixes` : on rafraîchit trop plutôt que pas assez.
 */
type SatelliteGroup = {
  keys: readonly string[];
  prefixes?: readonly string[];
  byId?: readonly string[];
  byIdFallbackPrefixes?: readonly string[];
};

export type SatellitePayload = { vehicleId?: unknown; missionId?: unknown; vehicle?: { registrationNumber?: unknown } | null } | null | undefined;

const MANAGEMENT_DASHBOARD = "/api/management/dashboard";

export const SATELLITE_GROUPS = {
  /** Quantités en stock : liste, stock bas, valeur, consommation, stock réel par pièce. */
  stock: {
    keys: [
      "/api/parts",
      "/api/parts/low-on-stock",
      "/api/parts/statistics",
      "/api/parts/stock-movements",
      ...WAREHOUSE_QUERY_KEYS,
      "/api/warehouse/most-used-parts",
      "/api/warehouse/parts",
      "/api/warehouse/real-stock",
      "/api/part-requirements/active-by-part",
    ],
  },
  /** Demandes de pièce : files du magasin, OT en attente de pièces, regroupement de commandes. */
  partRequirements: {
    keys: [
      "/api/part-requirements",
      "/api/part-requirements/active-by-part",
      "/api/work-orders/awaiting-parts",
      "/api/inventory-requests",
      "/api/purchase-orders/group-suggestions",
    ],
    prefixes: ["/api/part-requirements/by-part/"],
  },
  /** Coût d'un OT : tuiles KPI de coût et tableau de bord de gestion. */
  workOrderCost: {
    keys: ["/api/kpi/maintenance-costs", "/api/kpi/avg-cost-per-intervention", MANAGEMENT_DASHBOARD],
  },
  /** Statut d'un OT : disponibilité de la flotte, conformité, KPI, historique par véhicule. */
  workOrderStatus: {
    keys: [
      "/api/work-orders/awaiting-parts",
      "/api/statistics/fleet",
      "/api/statistics/fleet-kpi",
      "/api/statistics/maintenance-compliance",
      "/api/statistics/scheduled-maintenance",
      "/api/maintenance/stats",
      MANAGEMENT_DASHBOARD,
      ...KPI_QUERY_KEYS,
    ],
    prefixes: ["/api/work-orders/vehicle/"],
  },
  /** Liste des OT par technicien et compteurs du technicien. */
  workOrderLists: {
    keys: ["/api/technician/my-work-orders", "/api/technician/work-orders", "/api/dashboard/technician-stats"],
  },
  /** Statut d'un véhicule : compteurs de flotte et listes avec statut. */
  vehicleStatus: {
    keys: [
      "/api/statistics/fleet",
      "/api/statistics/fleet-kpi",
      "/api/statistics/fleet-history",
      "/api/vehicles/all-with-status",
      "/api/vehicles/stats",
      "/api/vehicles/status-summary",
    ],
  },
  /** Kilométrage et position d'atelier : fiche véhicule, plans et échéances de maintenance. */
  vehicleOperations: {
    keys: ["/api/vehicles", "/api/vehicles/all", "/api/vehicles/all-with-status", "/api/maintenance/date-alerts"],
    prefixes: ["/api/maintenance-schedules"],
    // fiche du seul véhicule touché, jamais toutes les fiches (`/api/vehicles/` en préfixe)
    byId: ["/api/vehicles/:vehicleId", "/api/vehicles/:registrationNumber"],
    byIdFallbackPrefixes: ["/api/vehicles/"],
  },
  /** Carburant : solde et historique de la carte, consommation, statistiques des pleins, fiche véhicule. */
  fuel: {
    keys: [
      "/api/fuel-card",
      "/api/fuel-card/balance",
      "/api/fuel-card/history",
      "/api/fuel-card/monthly-stats",
      "/api/fuel-card/stats-by-client",
      "/api/fuel-records",
      "/api/fuel-records/statistics",
      "/api/fuel-records/consumption-history",
      "/api/fuel-card/vehicle",
    ],
    prefixes: ["/api/fuel-records/vehicle/"],
  },
  /** Trésorerie : soldes des comptes et mouvements, relus quand un fait de carburant ou de budget déplace de l'argent. */
  // Préfixe seul : les écrans posent leurs clés par gabarit (`${TREASURY_BASE_PATH}/accounts`, mouvements, sous-comptes).
  treasury: { keys: [], prefixes: [TREASURY_BASE_PATH] },
  /** Chiffre d'affaires (factures client). */
  clientMoney: { keys: [MANAGEMENT_DASHBOARD, "/api/finance/invoices-awaiting-payment", "/api/finance/withholdings"] },
  /** Dettes fournisseurs (factures fournisseur et règlements). */
  supplierMoney: {
    keys: [
      "/api/supplier-invoices",
      "/api/supplier-invoices/statistics",
      "/api/supplier-invoices/overdue",
      "/api/supplier-invoices/discrepancies",
      MANAGEMENT_DASHBOARD,
    ],
  },
  /** Missions : activité au tableau de bord de gestion. */
  missions: { keys: [MANAGEMENT_DASHBOARD] },
  /** Budget de mission (L1f) : liste, budget d'une mission et ses dépenses, besoin du jour. */
  missionBudgets: { keys: ["/api/mission-budgets", "/api/mission-budgets/daily-need"], byId: ["/api/missions/:missionId/launch-readiness"] },
  /** Échéances documentaires : compteurs de flotte. */
  documents: { keys: ["/api/statistics/fleet"] },
  /** Cloche et listes d'alertes, y compris le filtre par type. */
  alerts: {
    keys: ["/api/alerts", "/api/alerts/count", "/api/alerts/active", "/api/alerts/unread", "/api/alerts/type"],
  },
  /** Commandes fournisseur. */
  purchaseOrders: {
    keys: ["/api/purchase-orders", "/api/purchase-orders/statistics", "/api/purchase-orders/overdue"],
  },
} as const satisfies Record<string, SatelliteGroup>;

export type SatelliteGroupName = keyof typeof SATELLITE_GROUPS;

/** Faits métier portés par chaque événement émis par le serveur. */
export const EVENT_SATELLITES: Record<string, readonly SatelliteGroupName[]> = {
  // Stock
  purchase_order_created: ["purchaseOrders", "partRequirements"],
  purchase_order_status_updated: ["purchaseOrders", "stock", "partRequirements", "supplierMoney", "alerts"],
  purchase_order_line_updated: ["purchaseOrders", "stock", "partRequirements", "supplierMoney", "alerts"],
  parts_delivered: ["purchaseOrders", "stock", "partRequirements", "alerts"],
  part_received: ["purchaseOrders", "stock", "partRequirements", "alerts"],
  part_used_added: ["stock", "partRequirements", "workOrderCost"],
  part_used_removed: ["stock", "partRequirements", "workOrderCost"],
  warehouse_stock_movement_recorded: ["stock"],
  part_requirement_created: ["partRequirements", "stock"],
  part_requirement_updated: ["partRequirements", "stock"],
  part_requirement_deleted: ["partRequirements", "stock"],
  part_catalog_changed: ["stock"],
  // Argent
  fuel_card_recharged: ["fuel"],
  fuel_card_consumption_recorded: ["fuel"],
  fuel_record_changed: ["fuel", "missions", "missionBudgets", "treasury"],
  fuel_record_validated: ["fuel"],
  client_invoice_created: ["clientMoney"],
  client_invoice_payment_recorded: ["clientMoney"],
  client_invoices_overdue: ["clientMoney"],
  client_invoice_deposited: ["clientMoney"],
  client_withholding_updated: ["clientMoney"],
  supplier_invoice_created: ["supplierMoney"],
  supplier_invoice_updated: ["supplierMoney"],
  supplier_invoice_settlement_recorded: ["supplierMoney"],
  supplier_invoice_settlement_reconciled: ["supplierMoney"],
  supplier_invoice_settlement_rejected: ["supplierMoney"],
  supplier_invoice_bulk_approved: ["supplierMoney"],
  // Statut
  work_order_created: ["workOrderStatus", "workOrderLists"],
  work_order_updated: ["workOrderStatus"],
  work_order_status_changed: ["workOrderStatus"],
  work_order_deleted: ["workOrderStatus", "workOrderLists"],
  work_order_awaiting_parts: ["workOrderStatus", "partRequirements"],
  // Heures d'une tâche : main-d'oeuvre valorisée dans les KPI de coût.
  work_order_item_changed: ["workOrderCost", "workOrderLists"],
  vehicle_updated: ["vehicleStatus"],
  vehicle_status_changed: ["vehicleStatus"],
  vehicle_mileage_updated: ["vehicleOperations"],
  // Retrait ou remise : compteurs de flotte, plans de maintenance, échéances, missions.
  vehicle_deleted: ["vehicleStatus", "vehicleOperations", "documents", "missions"],
  vehicle_restored: ["vehicleStatus", "vehicleOperations", "documents", "missions"],
  vehicle_maintenance_position_updated: ["vehicleOperations"],
  mission_created: ["missions"],
  mission_updated: ["missions"],
  mission_completed: ["missions"],
  mission_status_changed: ["missions"],
  mission_created_from_fuel: ["missions", "fuel"],
  mission_fuel_recorded: ["missions", "fuel"],
  mission_budget_updated: ["missionBudgets"],
  document_renewal_request_created: ["documents"],
  document_renewal_request_status_updated: ["documents"],
  document_renewal_quick_completed: ["documents"],
  vehicle_document_updated: ["documents"],
  alert_created: ["alerts"],
  alert_updated: ["alerts"],
  alert_read: ["alerts"],
};

/** Clés exactes et préfixes à invalider pour un événement (vide s'il n'est pas à la table). */
export function satelliteTargetsOf(event: string, payload?: SatellitePayload): { keys: string[]; prefixes: string[] } {
  const keys = new Set<string>();
  const prefixes = new Set<string>();
  const ids: Record<string, string | null> = {
    vehicleId: idOf(payload?.vehicleId),
    missionId: idOf(payload?.missionId),
    registrationNumber: typeof payload?.vehicle?.registrationNumber === "string" && payload.vehicle.registrationNumber.trim() ? payload.vehicle.registrationNumber : null,
  };
  for (const name of EVENT_SATELLITES[event] ?? []) {
    const group: SatelliteGroup = SATELLITE_GROUPS[name];
    for (const key of group.keys) keys.add(key);
    for (const prefix of group.prefixes ?? []) prefixes.add(prefix);
    if (!group.byId) continue;
    const filled = group.byId.flatMap((template) => {
      const param = template.match(/:(\w+)/)?.[1];
      const value = param ? ids[param] : null;
      return value ? [template.replace(`:${param}`, value)] : [];
    });
    for (const key of filled) keys.add(key);
    if (ids.vehicleId === null) for (const prefix of group.byIdFallbackPrefixes ?? []) prefixes.add(prefix);
  }
  return { keys: [...keys], prefixes: [...prefixes] };
}

function idOf(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(n) && n > 0 ? String(n) : null;
}
