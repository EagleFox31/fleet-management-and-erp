/**
 * Statuts d'une demande de renouvellement de document et transitions permises.
 *
 * pending -> in_progress -> completed ; pending / in_progress -> rejected.
 * Terminée ou rejetée : définitive. Garder le même statut est permis (rejouable).
 */
export const DOCUMENT_RENEWAL_REQUEST_STATUSES = ["pending", "in_progress", "completed", "rejected"] as const;
export type DocumentRenewalRequestStatus = (typeof DOCUMENT_RENEWAL_REQUEST_STATUSES)[number];

const TRANSITIONS: Readonly<Record<DocumentRenewalRequestStatus, readonly DocumentRenewalRequestStatus[]>> = {
  pending: ["in_progress", "rejected"],
  in_progress: ["completed", "rejected"],
  completed: [],
  rejected: [],
};

export function isDocumentRenewalRequestStatus(value: unknown): value is DocumentRenewalRequestStatus {
  return (DOCUMENT_RENEWAL_REQUEST_STATUSES as readonly unknown[]).includes(value);
}

/** `null` si la transition est permise, sinon le message à afficher (409). */
export function documentRenewalTransitionRefusal(from: string, to: DocumentRenewalRequestStatus): string | null {
  if (from === to) return null;
  if (from === "completed") return "Cette demande de renouvellement est terminée : son statut ne change plus.";
  if (from === "rejected") return "Cette demande de renouvellement est rejetée : elle ne peut pas être reprise.";
  if (from === "pending" && to === "completed") {
    return "Une demande en attente doit d'abord être prise en charge avant d'être terminée.";
  }
  if (!(TRANSITIONS[from as DocumentRenewalRequestStatus] ?? []).includes(to)) {
    return "Ce changement de statut n'est pas possible pour cette demande.";
  }
  return null;
}

/** Demande encore ouverte : ni terminée ni rejetée. Un récépissé ne compte que sur une demande ouverte. */
export const OPEN_DOCUMENT_RENEWAL_STATUSES = ["pending", "in_progress"] as const satisfies readonly DocumentRenewalRequestStatus[];
