import { createStubRouter } from "./stub";

/** Comptes verrouillés (contrat auth-lockout). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/admin/users/locked", adminOnly: true },
  { method: "post", path: "/admin/users/:id/unlock", adminOnly: true },
]);
