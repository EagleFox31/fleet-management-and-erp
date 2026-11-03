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

type SatelliteGroup = { keys: readonly string[]; prefixes?: readonly string[] };

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
    keys: ["/api/vehicles", "/api/maintenance/date-alerts"],
    prefixes: ["/api/vehicles/", "/api/maintenance-schedules"],
  },
  /** Carburant : solde et historique de la carte, consommation, statistiques des pleins, fiche véhicule. */
  fuel: {
    keys: [
      "/api/fuel-card",
      "/api/fuel-card/balance",
      "/api/fuel-card/history",
      "/api/fuel-card/monthly-stats",
      "/api/fuel-card/stats-by-client",
      "/api/fuel-card/consumption-history",
      "/api/fuel-records",
      "/api/fuel-records/statistics",
      "/api/fuel-records/consumption-history",
      "/api/fuel-card/vehicle",
    ],
    prefixes: ["/api/fuel-records/vehicle/"],
  },
  /** Chiffre d'affaires (factures client). */
  clientMoney: { keys: [MANAGEMENT_DASHBOARD] },
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
  fuel_record_changed: ["fuel"],
  fuel_record_validated: ["fuel"],
  client_invoice_created: ["clientMoney"],
  client_invoice_payment_recorded: ["clientMoney"],
  client_invoices_overdue: ["clientMoney"],
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
  vehicle_updated: ["vehicleStatus"],
  vehicle_status_changed: ["vehicleStatus"],
  vehicle_mileage_updated: ["vehicleOperations"],
  vehicle_maintenance_position_updated: ["vehicleOperations"],
  mission_created: ["missions"],
  mission_updated: ["missions"],
  mission_completed: ["missions"],
  mission_status_changed: ["missions"],
  mission_created_from_fuel: ["missions", "fuel"],
  mission_fuel_recorded: ["missions", "fuel"],
  document_renewal_request_created: ["documents"],
  document_renewal_request_status_updated: ["documents"],
  document_renewal_quick_completed: ["documents"],
  vehicle_document_updated: ["documents"],
  alert_created: ["alerts"],
  alert_updated: ["alerts"],
  alert_read: ["alerts"],
};

/** Clés exactes et préfixes à invalider pour un événement (vide s'il n'est pas à la table). */
export function satelliteTargetsOf(event: string): { keys: string[]; prefixes: string[] } {
  const keys = new Set<string>();
  const prefixes = new Set<string>();
  for (const name of EVENT_SATELLITES[event] ?? []) {
    const group: SatelliteGroup = SATELLITE_GROUPS[name];
    for (const key of group.keys) keys.add(key);
    for (const prefix of group.prefixes ?? []) prefixes.add(prefix);
  }
  return { keys: [...keys], prefixes: [...prefixes] };
}
