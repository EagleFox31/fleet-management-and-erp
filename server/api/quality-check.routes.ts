import { createStubRouter } from "./stub";

/** Contrôle qualité d'un OT (contrat quality-check). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "post", path: "/work-orders/:id/quality-check", feature: "quality-check" },
]);
