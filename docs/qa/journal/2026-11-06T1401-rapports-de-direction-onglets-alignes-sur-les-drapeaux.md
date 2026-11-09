## 2026-11-06T14:01:00+01:00 — Rapports de direction : onglets alignés sur les drapeaux

- **Agent** : de (fleet-testeur) · **Branche** : `fix/reports-tabs-flags` · **Commit** : voir `git log`
- **Statut** : fait (PR brouillon)
- **Quoi** : `/management/reports` affichait « Trésorerie & Recouvrement » (drapeau `finance`) et « Distribution & Envois » (`report-schedules`) même avec ces drapeaux éteints, alors que la barre latérale les masquait (constat d'aa).
- **Comment** :
  - `client/src/lib/management-report-tabs.ts` filtre les onglets avec `FEATURE_GATED_HREFS`, la table que lit la barre latérale, et les valeurs de `useFeatureFlags` (hook existant) ;
  - la page ne rend que les onglets visibles et leurs `TabsContent` ;
  - une URL directe vers un onglet masqué retombe sur « Board Pack ».
- **Comment tester (QA)** : `tests/unit/client/management-report-tabs.test.ts` vérifie trois cas :
  - drapeaux éteints, les deux onglets sont absents ; drapeaux allumés, les 5 sont présents ; avec les défauts du catalogue, les deux sont masqués ;
  - une URL directe drapeau éteint retombe sur l'onglet par défaut ;
  - l'onglet affiché fait toujours partie des onglets visibles.
  - Campagnes : unitaires 303/303, tsc 0, check:tests 0.
- **RAIDER** : R (même table de drapeaux que la barre latérale, pas de liste locale) ; D (onglets sans drapeau inchangés) ; E (logique pure testée hors React). Ne s'applique pas : I, Retroactive (pas d'état).
- **Reste / risques** : le drapeau client est cosmétique ; la garde réelle reste `requireFeature` côté serveur. Pas de contrôle visuel dans ce lot.

