## 2026-11-09T16:05:00+01:00 — Carte carburant et pleins : une lecture en échec lit Indisponible, jamais 0
- **Statut** : fait (PR brouillon)
- **Quoi** : `useFuelCard().balance.failed` (data indéfinie et erreur) ; `dashboard.tsx`, `logistics/dashboard.tsx` (en-tête et onglet Carburant), `client/dashboard.tsx`, `fuel/index.tsx` (solde, prix moyen, « Solde actuel » de la recharge, et pleins/litres/coût issus de `/api/fuel-records`), `fuel-statistics.tsx` (litres, coût, prix moyen, nb de pleins) affichent « Indisponible » avec une sous-ligne `userMessageOf`. Aucune somme partielle.
- **Comment tester (QA)** : `tests/unit/client/fuel-card-render-error-states.test.ts` (12 tests, rendu `react-dom/server`, erreur et témoin 12 345 par écran) + regex dans `money-stock-reads-error-states.test.ts`. Rouge avec chaque garde forcé à `false` (5 écrans), vert restauré.
- **RAIDER** : D : contrats et données saines inchangés, aucune dépendance. Ne s'appliquent pas : A, I, Retroactive.
- **Reste / risques** : `logistics/dashboard.tsx` « Volume consommé » (`/api/fuel-records/statistics`) et `client/dashboard.tsx` « Volume carburant » affichent encore 0 L sur échec de cette requête (hors liste du brief).

