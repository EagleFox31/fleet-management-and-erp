import type { AuditConfig, AuditRule } from "../middleware/audit-writes";

/** Regle pour une ressource : collection (creation) et element (+ sous-chemins) avec id numerique. */
const resource = (segment: string, entityType: string, options: { idFromResponse?: boolean } = {}): AuditRule[] => [
  { pattern: new RegExp(`^/${segment}$`), entityType, ...options },
  { pattern: new RegExp(`^/${segment}/(\\d+)(?:/.*)?$`), entityType },
];

/**
 * Les 8 motifs MUST audites (P-04). Liste gelee par tests/unit/server/audit-config.test.ts :
 * une route non listee n'est pas auditee, l'ajout d'un motif est donc un choix explicite.
 */
export const AUDIT_CONFIG: AuditConfig = {
  rules: [
    // Creation : l'id du nouvel OT n'est connu que dans la reponse (historique de l'OT).
    ...resource("work-orders", "work_order", { idFromResponse: true }),
    // Statut change par le technicien (demarrage, fin) : meme entite, id dans le chemin.
    { pattern: /^\/technician\/work-orders\/(\d+)\/status$/, entityType: "work_order" },
    ...resource("parts", "part"),
    ...resource("tires", "tire"),
    ...resource("vehicles", "vehicle"),
    ...resource("part-requirements", "part_requirement"),
    ...resource("purchase-orders", "purchase_order"),
    ...resource("supplier-invoices", "supplier_invoice"),
    ...resource("users", "user"),
  ],
};

/**
 * Ecritures des ressources du chantier CDC (lot CDC-0a), journalisees en plus de AUDIT_CONFIG.
 * Liste separee : AUDIT_CONFIG est gelee a 8 entites par tests/unit/server/audit-config.test.ts,
 * un test qui n'appartient pas a ce lot. Les deux configurations sont montees l'une apres
 * l'autre dans server/api/index.ts ; leurs chemins ne se recoupent pas.
 *
 * Exclus a dessein : `/telemetry/positions` et `/vehicle-positions` (volume : une ligne par
 * position et par boitier ; le journal est reserve aux decisions humaines). Une route non
 * listee n'est pas auditee, l'exclusion est donc l'absence de regle.
 */
export const CDC_AUDIT_CONFIG: AuditConfig = {
  rules: [
    ...resource("mission-advisories", "mission_advisory"),
    ...resource("part-scans", "part_scan"),
    ...resource("part-sales", "part_sale"),
    ...resource("admin/telemetry-devices", "telemetry_device"),
    ...resource("workshop-labor-rates", "workshop_labor_rate"),
    ...resource("maintenance-reports", "maintenance_report"),
    { pattern: /^\/imports\/[a-z-]+$/, entityType: "import" },
  ],
};
