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

## 2026-11-01T22:26:19+01:00 — Catalogue de pannes : valideur serveur, 404

- **Agent** : fix-defauts · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : le valideur d'une panne vient de la session et plus du corps ; un id inconnu donne 404.
- **Comment** : routeur fault-catalog.routes.ts monté avant routes.ts.
- **Pourquoi** : CAT2 figés en it.fails.
- **Comment tester (QA)** : valider une panne avec validatedBy forgé : le champ est ignoré et l'utilisateur connecté enregistré.
- **Preuve** : contrat fault-catalog-lifecycle : les 3 it.fails passent (Expect test to fail).
- **Reste / risques** : handlers d'origine de routes.ts en code mort.

## 2026-11-01T22:26:19+01:00 — Comptes : auto-désactivation admin, authenticate relit le compte

- **Agent** : fix-defauts · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : un admin ne peut pas désactiver son propre compte (400) ; authenticate refuse un compte supprimé ou inconnu.
- **Comment** : admin-users-guard.routes.ts ; authenticate asynchrone avec getUser ; tests auth-middleware et users-admin-self-deactivation.
- **Pourquoi** : mineurs #66.
- **Comment tester (QA)** : un admin PATCH son propre /toggle avec isActive=false : 400, compte actif.
- **Preuve** : unitaires 854/854 ; contrats users-admin-self-deactivation et users-admin-soft-delete verts.
- **Reste / risques** : getUser (storage.ts, gelé) renvoie encore les comptes supprimés : exception storage.ts à décider ; authorize et authenticate filtrent déjà deletedAt.

## 2026-11-01T22:26:20+01:00 — Workflow d'acquisition : liste blanche des champs

- **Agent** : fix-defauts · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : un corps forgé (status, userId) n'est plus écrit ; la clôture ne passe que par /complete.
- **Comment** : workflows.routes.ts (Zod) ; workflow-service : colonnes explicites en insert et en update.
- **Pourquoi** : défaut signalé à la relecture de #72.
- **Comment tester (QA)** : POST avec status=completed et currentStep=5 : brouillon créé en in_progress, aucun véhicule activé.
- **Preuve** : tsc 0 erreur ; test de contrat à écrire par le testeur (VEH3 de #72 reste à lui).
- **Reste / risques** : aucun test de contrat dans ce commit : à couvrir par fleet-testeur.

## 2026-11-01T23:13:33+01:00 — Tests : it.fails corrigés passés en it, contrat du workflow d'acquisition

- **Agent** : fix-defauts (testeur) · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : 13 `it.fails` corrigés deviennent des `it` (chauffeurs 3, fournisseurs 3, pièces 5, pannes 3, hors VEH3 et statut véhicule) ; chef d'atelier fournisseurs en lecture seule (GET 200, POST/PATCH/notation/désactivation 403) ; nouveau contrat workflow-vehicle-acquisition (POST et PATCH).
- **Comment** : retrait des 7 entrées converties de KNOWN_SETUP_IN_IT_FAILS ; le contrat WFL1 vérifie en base statut, propriétaire, completedAt et le nombre de véhicules, avec deux comptes.
- **Pourquoi** : un it.fails corrigé qui reste en it.fails est rouge ; le défaut de liste blanche du workflow n'avait aucun test.
- **Comment tester (QA)** : lancer les contrats drivers-crud-deactivation, suppliers-crud-ratings, parts-catalog-crud, fault-catalog-lifecycle, workflow-vehicle-acquisition sous db-lock.
- **Preuve** : 7/7, 26/26, 22/22, 12/12, 16/16 ; WFL1 rouge sur l'ancien service et sans le routeur (12 échecs), vert avec ; tsc 0 erreur ; unitaires 854/854 ; hygiène 7/7.
- **Reste / risques** : api-auth-guard rouge (garde de lecture fournisseurs dans server/api/index.ts non reconnue comme garde de session) ; supplier-settlement-idempotence instable une fois sur deux (vert au rejeu).

## 2026-11-01T23:30:00+01:00 — Véhicules : cloison client sur les listes, jokers LIKE, bornes de pagination

- **Agent** : fix-defauts · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : GET /api/vehicles et /api/vehicles/all ne renvoient plus tous les véhicules à un client (AGENTS.md §11) ; `%` et `_` de la recherche sont du texte ; offset négatif et limit hors entier sûr se replient sur la valeur par défaut. Le répartiteur de garde de /api/suppliers est marqué comme garde de session (api-auth-guard repasse vert).
- **Comment** : server/services/vehicle-list-service.ts (requête cloisonnée par `ownerScopeOf`, `escapeLike` de server/lib/sql-like.ts, tri départagé par id) ; routes `/` et `/all` en `isAnyUser` dans api/vehicles.routes.ts, avant routes.ts gelé ; `sessionGuard` exporté.
- **Pourquoi** : `authenticate` seul laissait un compte client lire immatriculation, VIN et marque de toute la flotte. Défaut répété (87c8678, cf585de) : garde-fou de contrat vehicles-lists-client-scope sur chaque liste véhicules.
- **Comment tester (QA)** : compte client : liste limitée à ses véhicules, total cohérent ; personnel : tout.
- **Preuve** : contrats vehicles-lists-client-scope (nouveau) et vehicles-crud verts ; lists-pagination-filters : les 5 it.fails véhicules passent (Expect test to fail), à convertir ; api-auth-guard 2/2 ; unitaires 854/854 ; tsc 0.
- **Reste / risques** : jokers `%` `_` encore actifs sur ordres de travail et fournisseurs (searchCases partagé) ; GET /api/vehicles/:id/mileage, /mileage/history et /check/:registrationNumber restent sous `authenticate` seul (lecture par id sans cloison) ; routes.ts:958 et :1005 restent en code mort.

## 2026-11-01T23:59:00+01:00 — Contrats véhicules : les 5 it.fails corrigés deviennent des it

- **Agent** : fix-defauts (testeur) · **Branche** : `fix/defauts-it-fails` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : dans lists-pagination-filters, la suite véhicules passe en `it` pour les jokers `%` et `_`, l'offset négatif, la limite hors entier sûr et la cloison client.
- **Comment** : option `jokersEscaped` de `searchCases`, activée pour les seuls véhicules ; ordres de travail et fournisseurs gardent leurs `it.fails` de jokers, comme pièces (offset, limit) et fournisseurs (isActive, catégorie). Aucune entrée de KNOWN_SETUP_IN_IT_FAILS n'était concernée.
- **Pourquoi** : un it.fails dont le défaut est corrigé passe pour « attendu rouge » et masquerait une régression.
- **Comment tester (QA)** : contrats lists-pagination-filters, vehicles-lists-client-scope, vehicles-crud, vehicle-documents-client-scope sous db-lock.
- **Preuve** : 106/106 sur 4 fichiers ; tsc 0 erreur ; unitaires 854/854 (hygiène incluse).
- **Reste / risques** : jokers encore défectueux sur ordres de travail et fournisseurs.
