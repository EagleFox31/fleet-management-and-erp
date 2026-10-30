import { createStubRouter } from "./stub";

/** Journal d'audit (contrat audit-logs). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/audit-logs", adminOnly: true },
]);
