## 2026-11-03 15:28 — Flakes : requestId dans les contrôles de fuite, compteur pg_stat de FUEL3

- **Quoi** : `leakText` dans `tests/support/api-error.ts`, utilisé par 50 contrôles de fuite dans 34 fichiers (30 de contrat, 4 unitaires dont le cas forcé) et par `apiErrorProblems`. Garde-fou `tests/unit/leak-check-hygiene.test.ts`. Cas déterministe `X-Request-Id: qrSqlREDR7` dans `part-scans-routes.test.ts`. FUEL3 : `vehicleVersions` (`xmin` et `md5`) remplace `pg_stat_user_tables`.
- **Comment** : le texte contrôlé ne contient plus le `requestId`. FUEL3 mesure ses propres lignes et une sentinelle, que le test supprime à la fin.
- **Pourquoi** : deux échecs aléatoires signalés par 0a. Le garde-fou a trouvé 7 contrôles de plus que le premier relevé.
- **Preuves** : rouge par mutation sur les deux cas (ancien contrôle avec le requestId forcé ; `UPDATE vehicles SET brand = brand` au démarrage). tsc 0, unitaires 142/142 fichiers, contrats 127/127 fichiers, FUEL3 4/4.

