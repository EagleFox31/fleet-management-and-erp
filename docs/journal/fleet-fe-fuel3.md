# fleet-fe : anomalies carburant par règle

Quoi : colonne « Règle », valeur constatée et référence par règle (L ou km), data-testid par anomalyKey.
Comment : libellés dans `shared/constants/fuel-anomaly-rules.ts`, formatage pur dans `client/src/lib/fuel-anomaly-display.ts`, tableau `fuel-anomalies-table.tsx`.
Pourquoi : depuis #100 le serveur renvoie tank-overflow et odometer-regression ; le kilométrage s'affichait en litres et deux lignes d'un même plein étaient indiscernables.
Tester : `node node_modules/vitest/vitest.mjs run tests/unit/client/fuel-anomaly-display.test.ts`. Pas de spec e2e anomalies carburant existant.
