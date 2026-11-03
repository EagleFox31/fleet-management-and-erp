import { createStubRouter } from "./stub";

/** Rapport de maintenance (CDC #8). Monté sur `/api/maintenance-reports`, drapeaux `exports` et `maintenance-report`. Squelette CDC-0a. */
export default createStubRouter([
  { method: "get", path: "/" },
  { method: "post", path: "/" },
]);
