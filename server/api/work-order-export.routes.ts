import { createStubRouter } from "./stub";

/** Export Word d'un OT (contrat work-order-export), coupe-circuit exports. Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/work-orders/:id/export", feature: "exports" },
]);
