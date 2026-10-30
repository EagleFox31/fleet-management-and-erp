import { createStubRouter } from "./stub";

/** Coût d'un véhicule (contrat vehicle-cost-summary). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/vehicles/:id/cost-summary", feature: "vehicle-cost-summary" },
]);
