import { createStubRouter } from "./stub";

/** Réception signée d'une demande de pièce (contrat part-requirement-receive). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "post", path: "/part-requirements/:id/receive", feature: "part-requirement-receive" },
]);
