import { createStubRouter } from "./stub";

/** Mouvements de pneus (contrat tire-movements). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/tires/movements", feature: "tire-movements" },
]);
