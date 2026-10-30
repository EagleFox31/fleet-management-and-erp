import { createStubRouter } from "./stub";

/** Traitement des anomalies carburant (contrat fuel-anomalies). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "patch", path: "/fuel-card/anomalies/:id", feature: "fuel-anomalies" },
]);
