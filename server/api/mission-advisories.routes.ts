import { createStubRouter } from "./stub";

/** Avis de maintenance sur mission (CDC #2). Monté sur `/api/mission-advisories`, drapeau `mission-maintenance-advisory`. Squelette CDC-0a : remplacer les entrées par la vraie logique. */
export default createStubRouter([
  { method: "get", path: "/" },
  { method: "get", path: "/:id" },
  { method: "post", path: "/" },
]);
