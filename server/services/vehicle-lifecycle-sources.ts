/** Critère d'action d'un véhicule et désactivations de la suppression douce, sans accès base (testable seul). */

/**
 * Source unique du critère « le véhicule a eu une action » : une ligne qui le référence dans l'une
 * de ces tables, quel que soit son statut (pleins supprimés en douceur compris). Sans action, la
 * suppression est physique ; avec, elle est douce et aucune donnée saisie n'est perdue.
 * `tests/unit/server/vehicle-activity-sources.test.ts` impose que toute clé étrangère vers
 * `vehicles.id` figure ici ou dans `VEHICLE_REFERENCES_NOT_ACTIVITY`.
 */
export const VEHICLE_ACTIVITY_SOURCES: readonly { table: string; column: string; label: string; minRows?: number }[] = [
  { table: "work_orders", column: "vehicle_id", label: "ordres de travail" },
  { table: "part_requirements", column: "vehicle_id", label: "demandes de pièce" },
  { table: "fuel_records", column: "vehicle_id", label: "pleins" },
  { table: "treasury_entries", column: "vehicle_id", label: "écritures de trésorerie" },
  { table: "assignments", column: "vehicle_id", label: "affectations de mission" },
  { table: "assignments", column: "trailer_id", label: "affectations de mission (remorque)" },
  { table: "mission_operations", column: "trailer_vehicle_id", label: "missions (remorque)" },
  { table: "vehicle_tires", column: "vehicle_id", label: "pneus montés" },
  { table: "tire_rotations", column: "vehicle_id", label: "rotations de pneus" },
  { table: "vehicle_documents", column: "vehicle_id", label: "documents" },
  { table: "document_renewal_requests", column: "vehicle_id", label: "renouvellements de documents" },
  { table: "workflow_documents", column: "vehicle_id", label: "documents d'acquisition" },
  { table: "maintenance_schedules", column: "vehicle_id", label: "plans de maintenance" },
  { table: "incidents", column: "vehicle_id", label: "incidents" },
  { table: "qhse_inspections", column: "vehicle_id", label: "inspections QHSE" },
  { table: "payment_instruments", column: "vehicle_id", label: "traites et effets" },
  // La création du véhicule pose une première ligne (storage.createVehicle) : seul un vrai
  // changement de statut, au-delà de celle-ci, compte comme une action.
  { table: "status_history", column: "vehicle_id", label: "changements de statut", minRows: 2 },
];

/** Références à `vehicles.id` qui ne sont pas une action, avec leur raison. */
export const VEHICLE_REFERENCES_NOT_ACTIVITY: Readonly<Record<string, string>> = {
  "vehicle_deletion_effects.vehicle_id": "journal posé par la suppression douce elle-même (cascade)",
};

/**
 * Éléments désactivés par la suppression douce, journalisés dans `vehicle_deletion_effects`, et
 * rejoués à l'identique par la restauration. Les pneus restent montés (décision du 5 novembre
 * 2026) ; l'historique et l'argent ne sont jamais touchés.
 *
 * `stampColumn` : horodatage que tout écrivain de la table renouvelle. La suppression le pose et
 * le journalise ; la restauration ne rouvre la ligne que s'il n'a pas bougé, ce qui distingue
 * « rejeté par la suppression » de « rejeté à la main pendant le retrait » (même valeur).
 * `maintenance_schedules.updated_at` est renouvelé par un déclencheur (init-database) : un plan
 * désactivé à la main pendant le retrait le reste après la restauration.
 */
export const VEHICLE_DEACTIVATIONS: readonly {
  table: string;
  column: string;
  activeValues: readonly (string | boolean)[];
  applied: string | boolean;
  stampColumn?: string;
}[] = [
  { table: "maintenance_schedules", column: "is_active", activeValues: [true], applied: false, stampColumn: "updated_at" },
  { table: "document_renewal_requests", column: "status", activeValues: ["pending", "in_progress"], applied: "rejected", stampColumn: "updated_at" },
];
