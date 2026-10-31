import { createStubRouter } from "./stub";

/** Scan QR des pièces (CDC #3). Monté sur `/api/part-scans`, drapeau `part-qr`. Squelette CDC-0a. */
export default createStubRouter([
  { method: "get", path: "/" },
  { method: "post", path: "/" },
]);
