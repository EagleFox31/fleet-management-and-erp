import type { AuditConfig, AuditRule } from "../middleware/audit-writes";

/** Regle pour une ressource : collection (creation) et element (+ sous-chemins) avec id numerique. */
const resource = (segment: string, entityType: string): AuditRule[] => [
  { pattern: new RegExp(`^/${segment}$`), entityType },
  { pattern: new RegExp(`^/${segment}/(\\d+)(?:/.*)?$`), entityType },
];

/**
 * Les 8 motifs MUST audites (P-04). Liste gelee par tests/unit/server/audit-config.test.ts :
 * une route non listee n'est pas auditee, l'ajout d'un motif est donc un choix explicite.
 */
export const AUDIT_CONFIG: AuditConfig = {
  rules: [
    ...resource("work-orders", "work_order"),
    ...resource("parts", "part"),
    ...resource("tires", "tire"),
    ...resource("vehicles", "vehicle"),
    ...resource("part-requirements", "part_requirement"),
    ...resource("purchase-orders", "purchase_order"),
    ...resource("supplier-invoices", "supplier_invoice"),
    ...resource("users", "user"),
  ],
};
