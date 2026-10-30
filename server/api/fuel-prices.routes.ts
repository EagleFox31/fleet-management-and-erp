import { createStubRouter } from "./stub";

/** Prix du carburant daté (contrat fuel-prices). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/fuel-prices", feature: "fuel-prices" },
  { method: "post", path: "/fuel-prices", feature: "fuel-prices" },
]);
