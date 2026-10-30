import { createStubRouter } from "./stub";

/** Défi ALTCHA (contrat auth-captcha). Squelette T-08 : à remplacer par l'implémentation. */
export default createStubRouter([
  { method: "get", path: "/auth/challenge", feature: "captcha" },
]);
