import { createStubRouter } from "./stub";

/** Indicateurs (contrat kpi). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/kpi/incidents-per-month" },
  { method: "get", path: "/kpi/preventive-compliance" },
  { method: "get", path: "/kpi/avg-cost-per-intervention" },
]);
