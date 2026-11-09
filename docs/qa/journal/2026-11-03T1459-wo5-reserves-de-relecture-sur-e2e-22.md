## 2026-11-03 14:59 — WO5 : réserves de relecture sur e2e/22

- **Quoi** : `e2e/22-work-order-cost.spec.ts` : sondage direct vers 35 000 et 840 (plus de `toBeGreaterThan(0)`), `GET /api/work-orders/:id/labor-rate` vérifié nul avant le cas sans taux, import `node:fs` en tête.
- **Comment** : `readThreeCosts` reçoit le total attendu. **Pourquoi** : réserves du relecteur de #171 (un sondage > 0 pouvait valider un montant partiel). **Preuves** : spec 22 rejouée 2/2, tsc 0.

