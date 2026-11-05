/**
 * Facture client annulée : elle n'est pas du chiffre facturé. Relevé de compte et rapport de
 * facturation l'excluent, avec ses paiements, par ce même statut.
 */
export const CANCELLED_CLIENT_INVOICE_STATUS = "cancelled" as const;
