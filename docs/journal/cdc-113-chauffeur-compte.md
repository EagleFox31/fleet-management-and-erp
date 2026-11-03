# Journal — #113 une fiche chauffeur par compte (`c7`)

Worktree : `../fm-113`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-11-03T09:15:00+01:00 — #113 — Index unique partiel sur drivers(user_id), 409 et /me sans repli par nom

- **Agent** : c7 · **Branche** : `lot/db/113-driver-unique-user` · **Commit** : voir `git log` de la branche
- **Statut** : fait (outil de fusion des doublons en attente du relevé sur Neon)
- **Quoi** : un compte ne peut être lié qu'à une fiche chauffeur. Seconde fiche ou modification vers un compte déjà lié → 409 « Matricule ou liaison utilisateur déjà utilisée ». `GET /api/drivers/me` ne lie plus un compte au premier homonyme : seul le personnel fait le lien.
- **Comment** :
  - `uq_drivers_user_id` (unique, `WHERE user_id IS NOT NULL`), posé par `DRIVERS_USER_ID_UNIQUE_SQL` dans `server/init-database.ts`, jumelle de `server/db/migrations/20261103_drivers_user_id_unique.sql` ; déclaré dans `shared/schema.ts`.
  - Rétroactif : sur doublons existants, l'index n'est pas posé et rien n'est supprimé ; `reportDriverUserIdUniqueGaps` journalise les comptes et fiches concernés (un `RAISE WARNING` n'atteint pas les logs applicatifs). L'index est posé au démarrage suivant une fois les doublons réglés par la logistique.
  - Routes : le test local d'unicité est remplacé par `isUniqueViolation` de `server/lib/pg-errors.ts` (lit aussi `cause`). Repli par nom de `/me` supprimé.
  - `server/lib/driver-scope.ts` : l'union des fiches est conservée, commentaire renvoyant à l'index.
- **Pourquoi** : décision option A (#113). Le repli par nom liait un compte à la fiche d'un homonyme et lui ouvrait ses missions et données personnelles.
- **Comment tester (QA)** :
  - Prérequis : compte logistique, un compte chauffeur déjà lié à une fiche.
  - Étapes : 1. Créer une seconde fiche avec ce compte. 2. Lier une autre fiche à ce compte. 3. Se connecter avec un compte chauffeur sans fiche liée, homonyme d'une fiche, et ouvrir son profil.
  - Attendu : 1 et 2. Refus « Matricule ou liaison utilisateur déjà utilisée », rien n'est modifié. 3. Aucun profil, la fiche homonyme reste sans compte.
  - Preuve automatisée : `tests/unit/server/drivers-user-id-unique-schema.test.ts`, `tests/integration/drivers-user-id-unique.test.ts`, `tests/contract/drivers-user-unique.contract.test.ts`, sous `db-lock` sur Postgres local.
- **RAIDER** : R (patron migration jumelle + relevé des écarts réutilisé) ; A (`current_schema()`, aucun nom de base) ; I (index posé une fois, re-passage sans effet, testé) ; D (contrat `adm2-drv2` adapté : il créait volontairement deux fiches pour un compte, ce qui est désormais refusé) ; E (refus propre, log actionnable, aucune suppression) ; Retroactive (doublons conservés, signalés).
- **Reste / risques** : relevé des doublons sur Neon (b7) ; s'il y en a, fusion choisie par la logistique (déplacer `assignments.driver_id`, retirer le `user_id` de l'autre fiche). Hors périmètre : `POST /api/drivers/:id/create-user` écrase un `user_id` existant.
