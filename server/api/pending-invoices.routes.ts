import { createStubRouter } from "./stub";

/** Factures en attente (contrat pending-invoices). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/billing/pending-invoices", feature: "pending-invoices" },
]);
