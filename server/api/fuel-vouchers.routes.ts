import { createStubRouter } from "./stub";

/** Validation des bons de carburant (contrat fuel-vouchers). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "post", path: "/fuel-vouchers/:id/validate", feature: "fuel-vouchers" },
]);
