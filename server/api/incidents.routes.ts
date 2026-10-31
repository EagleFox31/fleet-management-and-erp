import { createStubRouter } from "./stub";

/** Déclaration de panne (contrat incidents). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/incidents", feature: "incidents" },
  { method: "post", path: "/incidents", feature: "incidents" },
]);
