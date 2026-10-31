import { createStubRouter } from "./stub";

/** Positions GPS des véhicules (CDC #6), lecture. Monté sur `/api/vehicle-positions`, drapeau `gps`. Squelette CDC-0a. */
export default createStubRouter([
  { method: "get", path: "/" },
  { method: "get", path: "/:vehicleId" },
]);
