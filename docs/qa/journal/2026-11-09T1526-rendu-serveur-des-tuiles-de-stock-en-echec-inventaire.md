## 2026-11-09T15:26:00+01:00 — Rendu serveur des tuiles de stock en échec (inventaire, magasin, atelier)

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `tests/unit/client/money-stock-render-error-states.test.ts` : rendu `react-dom/server` des trois écrans avec `/api/parts/statistics` en erreur dans le cache (`queryCache.build(...).setState`) ; la tuile doit lire « Indisponible », jamais 0. Un témoin par écran avec données saines. Complète les regex de `money-stock-reads-error-states.test.ts`, qui lisent le source sans prouver l'affichage ;
  - `warehouse/dashboard.tsx` : le sous-texte de « Valeur stock total » teste `statsFailed` et non `statistics.error` (une relance échouée avec données en cache masquait la valeur moyenne par pièce) ; couvert par un cas de rendu.
- **Comment tester (QA)** : `npx vitest run tests/unit/client/money-stock-render-error-states.test.ts` (7 tests). Rouge avec chaque garde forcé à `false` (inventaire l.216, magasin l.162, atelier l.80) et avec `statistics.error` rétabli en l.214 ; vert sinon.
- **RAIDER** : D : aucun contrat touché ; aucune dépendance ajoutée, `vitest.config.ts` inchangé.
- **Reste / risques** : l'onglet « Alertes » du magasin (répartition) n'est pas rendu par défaut, donc non couvert ; tuile « Stock bas / épuisé » de l'atelier (onglet Inventaire) idem, la garde `stockStatsFailed` est prouvée via « Alertes stock magasin ».

