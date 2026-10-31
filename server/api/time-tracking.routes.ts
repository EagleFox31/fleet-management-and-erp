import { createStubRouter } from "./stub";

/** Pointage (contrat time-tracking). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/time-tracking", feature: "time-tracking" },
  { method: "put", path: "/time-tracking", feature: "time-tracking" },
  { method: "get", path: "/time-tracking/monthly-stats", feature: "time-tracking" },
]);
