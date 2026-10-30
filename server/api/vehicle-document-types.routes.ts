import { createStubRouter } from "./stub";

/** Types de document véhicule (contrat vehicle-document-types). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/vehicle-document-types" },
  { method: "post", path: "/vehicle-document-types", adminOnly: true },
  { method: "patch", path: "/vehicle-document-types/:code", adminOnly: true },
]);
