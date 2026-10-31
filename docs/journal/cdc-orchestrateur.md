# Journal — orchestrateur du chantier CDC

Chantier des écarts du cahier des charges (ETS YARORO, §3 et §6). Plan et état : `docs/plans/cdc-ecarts.md`.
Format : `docs/journal/README.md`.

## 2026-10-31T20:11:26+01:00 — CDC-0 — Plan et état du chantier consignés

- **Agent** : orchestrateur-cdc · **Branche** : `lot/api/CDC-0-socle` · **Commit** : celui qui contient ce fichier (sha non écrit, il n'est connu qu'après le commit)
- **Statut** : fait
- **Quoi** : ajout de `docs/plans/cdc-ecarts.md` (contraintes, stratégie, tableau des lots, ordre des vagues, décisions utilisateur en attente, questions au client pour #6) et de ce journal. Aucun code, aucun test, aucune fusion.
- **Comment** : deux fichiers Markdown nouveaux, contenu repris de la consigne de l'orchestrateur et mis en forme (tableaux, listes numérotées). Aucun autre fichier modifié.
- **Pourquoi** : que le plan et l'état du chantier survivent à une interruption de session. Demande de l'orchestrateur.
- **Comment tester (QA)** :
  - Prérequis : worktree `fm-cdc-0-socle` sur la branche `lot/api/CDC-0-socle`.
  - Étapes : 1. `git show --stat HEAD` : deux fichiers ajoutés, `docs/plans/cdc-ecarts.md` et `docs/journal/cdc-orchestrateur.md`. 2. `grep -n "^## " docs/plans/cdc-ecarts.md` : sections Contraintes, Stratégie, Lots, Ordre, Décisions utilisateur en attente, Questions au client pour #6.
  - Attendu : deux fichiers ajoutés, aucun autre fichier modifié, six sections dans le plan.
  - Preuve automatisée : aucune (documentation seule).
- **RAIDER** : couvert : consignation de l'état pour reprise, sans incident à documenter dans `LESSONS_LEARNED.md`. Ne s'applique pas : documentation seule, sans code, sans règle CI, sans changement d'état distant hors push de la branche.
- **Reste / risques** : décisions 1 à 10 et questions client pour #6 toujours ouvertes. Le plan ne reste exact que si chaque agent y reporte ses changements d'état. `docs/journal/README.md` prévoit un fichier par agent : ce journal est un fichier distinct demandé par l'orchestrateur, et `docs/journal/cdc-0-socle.md` existe déjà dans ce worktree.
