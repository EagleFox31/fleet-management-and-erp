import { createStubRouter } from "./stub";

/**
 * Import Excel (CDC #9). Monté sur `/api/imports`, drapeau `excel-import`. Le montage accepte
 * `IMPORT_INTERVENTION_ROLES` (admin, chef d'atelier) ; tout autre import est réservé à
 * l'administrateur (`IMPORT_ROLES`) par la garde de la route. Squelette CDC-0a.
 */
export default createStubRouter([
  { method: "post", path: "/interventions" },
  { method: "post", path: "/:kind", adminOnly: true },
]);
