import { createStubRouter } from "./stub";

/** Préférences de notification (contrat notification-settings). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/notifications/settings" },
  { method: "patch", path: "/notifications/settings" },
]);
