# Journal — correctifs des it.fails (`fix-defauts`)

Worktree : `../fm-fix-defauts`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-11-01T22:05:59+01:00 — DRV1 — Chauffeur désactivé : affectation, liste PIN, connexion PIN

- **Agent** : fix-defauts · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : un chauffeur dont la fiche est désactivée n'est plus affectable à une mission (400), sort de la liste de l'écran PIN et ne se connecte plus par PIN (401).
- **Comment** : missions.routes.ts : contrôle de drivers.isActive à la création et au PATCH d'affectation. Nouveau routeur server/api/pin-auth.routes.ts (monté dans api/index.ts avant routes.ts, qui est gelé) qui reprend pin-login et drivers-list avec AppError et moduleLogger et exclut les comptes liés à une fiche désactivée ; un compte driver sans fiche reste admis.
- **Pourquoi** : la désactivation de la fiche drivers ne touchait pas les comptes users liés ni l'affectation (DRV1).
- **Comment tester (QA)** : désactiver un chauffeur (admin), puis vérifier qu'il n'apparaît plus sur l'écran PIN, que son PIN est refusé et qu'une affectation à une mission est refusée.
- **Preuve** : contrat drivers-crud-deactivation : les 3 it.fails passent désormais (Expect test to fail), à convertir en it par le testeur.
- **Reste / risques** : les handlers d'origine de routes.ts restent en code mort derrière le routeur (fichier gelé) ; test de non-régression sur les autres contrats du domaine à faire par le testeur.
