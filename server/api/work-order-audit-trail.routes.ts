import { createStubRouter } from "./stub";

/** Historique d'un OT (contrat work-order-audit-trail). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/work-orders/:id/audit-trail", feature: "work-order-audit-trail" },
]);
