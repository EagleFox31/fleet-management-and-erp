import { createStubRouter } from "./stub";

/** Taux horaires de main-d'oeuvre de l'atelier (CDC #8). Monté sur `/api/workshop-labor-rates`, drapeau `maintenance-report`. Squelette CDC-0a. */
export default createStubRouter([
  { method: "get", path: "/" },
  { method: "put", path: "/:id" },
]);
