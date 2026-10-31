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
