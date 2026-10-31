# Journal — Produit (`pe`)

Worktree : `../fm-pe`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T13:50:00+01:00 — T-05 — Critères d'acceptation, matrice de recette, questions client

- **Agent** : pe · **Branche** : `lot/pe/T-05-criteres` · **Commit** : voir `git log -1`
- **Statut** : fait (T-36 bloqué : `origin/lot/fe/T-09-squelette-client` absente)
- **Quoi** : `docs/recette/` : critères Given/When/Then P-01 à P-26, matrice R-01 à R-14, texte de la page « Périmètre et prochains lots », questions à valider par le client avec valeur par défaut.
- **Comment** : documents seuls, aucun code. Écarts du plan repris de l'ADR 0001 : P-23 coupé, P-16 sans route dédiée, export client en 403 lundi, ACF et agrément PD sans durée.
- **Pourquoi** : T-05 ; P-10, P-11 ; D-03, D-06, D-13, D-19.
- **Comment tester (QA)** :
  - Étapes : 1. Ouvrir `docs/recette/`. 2. Vérifier que chaque P-xx de 01 à 26 (sauf P-12) a un critère ou figure en « coupé ». 3. Vérifier que chaque R-xx cite un P-xx ou « existant ».
  - Attendu : aucun P-xx orphelin hors la liste « test libre » de la matrice.
  - Preuve : `grep -c "^| P-" docs/recette/criteres-acceptation.md` → 24 lignes (11 MUST, 12 SHOULD, 1 coupé).
- **RAIDER** : couvert D (aucun fichier existant modifié), failure memory sans objet ; I, A, R sans objet (documentation).
- **Reste / risques** : le plan mentionne 13 questions ouvertes, il en contient 19 ; toutes reprises. T-36 attend le squelette client de fe-1.

## 2026-10-30T14:20:00+01:00 — T-36 — Page « Périmètre et prochains lots »

- **Agent** : pe · **Branche** : `lot/pe/T-36-page-perimetre` · **Commit** : voir `git log -1`
- **Statut** : fait
- **Quoi** : page `/scope` (livré, en essai, prochains lots) ; logique extraite dans `client/src/lib/scope-overview.ts` ; test `tests/unit/client/scope-overview.test.ts`.
- **Comment** : route et menu existaient (T-09, id `scope`) ; une seule ligne ajoutée dans `config/lot-screen-components.ts` (propriété fe-1). Les libellés « livré (must) » et « en essai (should) » et leur état viennent de `shared/feature-flags.ts` et des drapeaux effectifs ; le texte livré et les prochains lots reprennent `docs/recette/perimetre-prochains-lots.md`.
- **Pourquoi** : T-36 ; P-10.
- **Comment tester (QA)** :
  - Étapes : 1. Se connecter avec n'importe quel profil. 2. Ouvrir le menu « Périmètre et prochains lots ». 3. Lancer le serveur avec `FEATURE_FLAGS=incidents=on` et vérifier que « Déclaration de panne » passe à « Activé ».
  - Attendu : trois sections ; aucune mention de finance, QHSE, GPS ou tarifs hors « Prochains lots ».
  - Preuve : `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/client/scope-overview.test.ts` → 4 tests verts ; tsc global → 0 `error TS`.
- **RAIDER** : R/A couvert (libellés lus du catalogue) ; D couvert (tests T-09 verts) ; I, failure memory, R sans objet.
- **Reste / risques** : la note de rédaction de `questions-client.md` est conservée (« à retirer avant envoi », non liée à T-36). Les textes livré et prochains lots sont en dur, à synchroniser avec la doc.
