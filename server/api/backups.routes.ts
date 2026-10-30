import { createStubRouter } from "./stub";

/** Sauvegardes (contrat backups). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/admin/backups", adminOnly: true },
  { method: "get", path: "/admin/backups/alerts", adminOnly: true },
  { method: "post", path: "/admin/backups/run", adminOnly: true },
]);
