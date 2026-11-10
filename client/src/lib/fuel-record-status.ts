/**
 * Statut de validation d'un plein, tel que l'écran l'affiche. Un plein validé sans valideur
 * (`validatedBy` NULL) vient de la reprise de l'historique, pas d'un bon validé à la main.
 */
export function fuelValidationLabel(record: { validationStatus?: string | null; validatedBy?: number | null }): string {
  if (record.validationStatus !== "validated") return "En attente";
  return record.validatedBy == null ? "Validé (reprise)" : "Validé";
}
