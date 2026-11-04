/**
 * Listes gelées des cliquets de routes d'écriture (tests/unit/server/write-routes-ratchet.test.ts).
 * Générées le 2026-11-02 par la détection de ./support/write-routes-scan.ts. Une liste ne peut que
 * rétrécir : corriger la route, puis retirer son entrée ici (le test l'exige).
 */

/** T1 : routes d'écriture sans garde de rôle ni de permission (ni au montage). Elles ne sont ouvertes qu'à un compte connecté, ou le contrôle est fait dans le handler. */
export const T1_WITHOUT_ROLE_GUARD: readonly string[] = [
  "delete /api<relative(alertPath(\":id\"))>",
  "patch /api${relative(alertPath(\":id\"))}/read",
  "patch /api/notifications/settings",
  "patch /api/onboarding/complete",
  "patch /api/onboarding/mascot",
  "patch /api/onboarding/step",
  "post /api/users/change-password",
  "post /api<relative(ALERT_READ_ALL_PATH)>",
];

/** T3 : routes qui lisent `req.body` sans schéma Zod ni `prepareColumnUpdate` / `columnTypeErrors` : un corps invalide peut finir en 500. */
export const T3_WITHOUT_BODY_VALIDATION: readonly string[] = [
  "patch /api/document-renewals/requests/:id/status",
  "patch /api/labor-catalog/:id",
  "patch /api/part-requirements/:id",
  "patch /api/supplier-invoices/:id/settlements/:settlementId/reconcile",
  "patch /api/supplier-invoices/:id/settlements/:settlementId/reject",
  "patch /api/work-order-items/:id",
  "post /api/drivers/:id/create-user",
  "post /api/drivers/:id/update-cpc",
  "post /api/fuel-card/recharge",
  "post /api/labor-catalog",
  "post /api/supplier-invoices/:id/payment",
  "post /api/warehouse/stock-movement",
  "post /api/work-orders/:workOrderId/awaiting-parts",
  "post /api/work-orders/:workOrderId/items",
  "post /api/work-orders/:workOrderId/part-requirements/:requirementId/issue",
  "post /api/work-orders/:workOrderId/parts",
  "put /api/missions/:id/status",
  "put /api/vehicles/:id/maintenance-position",
  "put /api/vehicles/:id/mileage",
];

/** T4 : routes qui lisent `req.body` sans schéma d'insertion qui omet les champs serveur, sans écrasement explicite de `createdBy`/`updatedBy`..., sans liste de champs retenus. */
export const T4_WITHOUT_SERVER_FIELD_PROTECTION: readonly string[] = [
  "patch /api/clients/:id",
  "patch /api/drivers/:id",
  "patch /api/fuel-card/anomalies/:id",
  "patch /api/fuel-records/:id",
  "patch /api/labor-catalog/:id",
  "patch /api/purchase-orders/:id/lines/:lineId",
  "patch /api/supplier-invoices/:id/settlements/:settlementId/reconcile",
  "patch /api/supplier-invoices/:id/settlements/:settlementId/reject",
  "patch /api/vehicle-tires/:id",
  "patch /api/vehicle-tires/:id/remove",
  "patch /api/work-order-items/:id",
  "patch /api/work-orders/:id",
  "post /api/fuel-records",
  "post /api/labor-catalog",
  "post /api/missions/:id/fuel-records",
  "post /api/missions/:id/fuel-records/declare-no-refuel",
  "post /api/supplier-invoices",
  "post /api/supplier-invoices/:id/settlements",
  "post /api/tire-rotations",
  "post /api/work-orders",
  "post /api/work-orders/:workOrderId/awaiting-parts",
  "post /api/work-orders/:workOrderId/items",
  "post /api/work-orders/:workOrderId/part-requirements/:requirementId/issue",
  "post /api/work-orders/:workOrderId/parts",
  "put /api/time-tracking",
];
