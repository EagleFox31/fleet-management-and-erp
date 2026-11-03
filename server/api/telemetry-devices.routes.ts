import { createStubRouter } from "./stub";

/** Boîtiers de télémétrie (CDC #6), administration. Monté sur `/api/admin/telemetry-devices`, drapeau `gps`. Squelette CDC-0a. */
export default createStubRouter([
  { method: "get", path: "/" },
  { method: "post", path: "/" },
  { method: "patch", path: "/:id" },
]);
