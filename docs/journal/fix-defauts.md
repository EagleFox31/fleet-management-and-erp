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

## 2026-11-01T22:26:19+01:00 — Fournisseurs : lecture seule du chef d'atelier, 409, commande vers fournisseur désactivé

- **Agent** : fix-defauts · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : le chef d'atelier consulte les fournisseurs (200) mais ne crée, modifie, note ni désactive (403) ; un nom déjà pris donne un 409 lisible ; une commande vers un fournisseur désactivé ou inconnu est refusée.
- **Comment** : index.ts monte /suppliers avec une garde selon la méthode (SUPPLIER_READ_ROLES en GET/HEAD, PROCUREMENT_ROLES sinon) ; supplier-categories.ts retire la branche workshop_manager ; pg-errors.ts (isUniqueViolation) ; createPurchaseOrder vérifie le fournisseur.
- **Pourquoi** : décision de l'utilisateur : le chef d'atelier ne fait que consulter ; défauts SUP1 figés en it.fails.
- **Comment tester (QA)** : connecté en chef d'atelier : liste fournisseurs visible, création/notation en 403 ; créer deux fois le même nom : 409.
- **Preuve** : contrat suppliers-crud-ratings : 23/26, les 2 it.fails passent (Expect test to fail) et le test « workshopManager : 403 » attend désormais 200 en GET ; conversion par le testeur.
- **Reste / risques** : écrans client à aligner par fleet-fe : App.tsx (RoleRoute fournisseurs avec PROCUREMENT_ROLES) et procurement/suppliers/[id].tsx (canCreateOrder inclut workshop_manager).

## 2026-11-01T22:26:19+01:00 — Pièces : validation, 409, 404

- **Agent** : fix-defauts · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : création de pièce : prix non numérique et stock négatif en 400, référence déjà prise en 409 ; suppression d'une pièce inconnue ou déjà supprimée en 404, jamais 500.
- **Comment** : insertPartSchema (price, quantity, minQuantity) ; parts-service : AppError ; routeur parts-catalog.routes.ts, id contraint par [0-9]+.
- **Pourquoi** : PRT1 figés en it.fails.
- **Comment tester (QA)** : créer une pièce avec prix « abc » : 400 ; même référence : 409 ; supprimer deux fois : 204 puis 404.
- **Preuve** : contrat parts-catalog-crud : 17/22, les 5 it.fails passent (Expect test to fail).
- **Reste / risques** : les anciens handlers de routes.ts restent en code mort ; console.log de deletePart conservés (à migrer).
