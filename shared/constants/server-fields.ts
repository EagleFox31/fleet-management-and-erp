/**
 * Champs que seul le serveur écrit : identifiant, auteurs et horodatages, montants calculés.
 * Source unique de `validateBody` (qui les retire du corps avant validation) et du cliquet
 * `tests/unit/server/write-routes-ratchet.test.ts` (T4 : champs serveur non protégés).
 */
export const SERVER_FIELDS = [
  "id",
  "createdBy",
  "updatedBy",
  "createdAt",
  "updatedAt",
  "recordedBy",
  "approvedBy",
  "requestedBy",
  "receivedBy",
  "issuedBy",
  "totalAmount",
  "cost",
] as const;

export type ServerField = (typeof SERVER_FIELDS)[number];
