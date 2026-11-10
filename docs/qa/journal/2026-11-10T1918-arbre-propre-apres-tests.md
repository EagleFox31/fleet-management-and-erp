## 2026-11-10T19:18:00+01:00 — Arbre propre après `npm test`, et diagnostic des tests lents sous charge
- **Statut** : fait (PR brouillon)
- **Quoi** :
  - Cause racine du snapshot réécrit à chaque passe : avec `core.autocrlf=true`, Windows sort `offline-read-driver.test.ts.snap` en CRLF, puis Vitest le réécrit en LF. `git status` montre alors le fichier modifié, alors que son contenu n'a pas changé.
  - Correctif : `.gitattributes`, avec `**/__snapshots__/*.snap text eol=lf`.
  - Garde-fou côté poste : `tests/unit/gitattributes-snapshots.test.ts`. Chaque `.snap` suivi doit avoir `eol=lf`, et un futur snapshot aussi, quel que soit son dossier.
  - Garde-fou côté CI : dans le job `unit`, l'étape « Arbre propre après les tests » échoue si `git status --porcelain` n'est pas vide après `npm test`.
  - Tests lents : `agent-hooks` reçoit 30 s par `describe`, le même délai que `backup-db` et `gitattributes-union`.
- **Diagnostic des 4 échecs sous charge** : pas de fichier temporaire partagé (`mkdtemp` par test), pas de port. Ce sont tous des dépassements de délai sur un processus enfant synchrone.

  | Test | Seul | Délai | Cause | Suite |
  |---|---|---|---|---|
  | `gitattributes-union` « deux branches… » | ~1,5 s | 30 s | une dizaine de `git` en `execFileSync` | aucun correctif |
  | `backup-db` « relancé le même jour… » | 0,4–0,9 s | 30 s | `bash` (MSYS) en `spawnSync` | aucun correctif |
  | `backup-db` « supprime les dumps… » | 0,4–0,9 s | 30 s | idem | aucun correctif |
  | `agent-hooks` « garde-commit-propre trailer » | ~0,15 s | 5 s | `node` en `spawnSync` | délai passé à 30 s |

  Ce que disent ces mesures :
  - Les deux passes complètes de ce soir, avec les workers par défaut puis `--maxWorkers=50%`, sont vertes (387 fichiers sur 387).
  - Les échecs ne se reproduisent que quand d'autres passes de tests tournent en même temps sur le poste.
  - Augmenter encore les délais masquerait le symptôme sans rien régler.
- **Comment tester (QA)** :
  - Vérifié en rouge : sans la règle `.gitattributes`, `gitattributes-snapshots` a 2 échecs.
  - Vérifié en vert : avec la règle, après `git checkout` du snapshot, `git ls-files --eol` donne `i/lf w/lf`, et la passe du test `offline-read-driver` laisse l'arbre propre.
  - Campagnes : tsc 0, `npm test` complet vert.
- **Pourquoi** : un arbre sale après les tests cache les vraies modifications et finit par être commité par erreur. La règle CI empêche qu'un test réécrive à nouveau un fichier suivi.
- **RAIDER** :
  - A : la règle porte sur tous les `__snapshots__`, quel que soit le poste.
  - I : le checkout est stable et un second run ne laisse aucune écriture.
  - D : aucun test retiré.
  - E : la cause a été mesurée avant toute correction.
  - Failure memory : ce journal.
  - Ne s'appliquent pas : R et Retroactive (configuration de dépôt seule).
- **Reste / risques** :
  - Si les échecs sous charge reviennent avec un poste par ailleurs au repos, isoler les tests à processus enfant dans un projet Vitest séquentiel.
  - Le correctif ne s'applique aux clones existants qu'après `git checkout -- '*.snap'` (ou un nouveau checkout).
