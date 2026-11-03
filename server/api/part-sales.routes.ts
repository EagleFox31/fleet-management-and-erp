import { createStubRouter } from "./stub";

/** Vente de pièces (CDC #4). Monté sur `/api/part-sales`, drapeau `part-sales`. Squelette CDC-0a. */
export default createStubRouter([
  { method: "get", path: "/" },
  { method: "get", path: "/:id" },
  { method: "post", path: "/" },
]);
