# Journal — API 2 (`api-2`)

Worktree : `../fm-api-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T14:18:37+01:00 — T-47 contrôle qualité d'un OT
- **Statut** : fait
- **Quoi** : `POST /api/work-orders/:id/quality-check` (drapeau `quality-check`, chef d'atelier et admin). Validation : l'OT reste terminé ; rejet : retour en cours avec motif obligatoire (jamais `pending`, D-17). L'auteur et l'heure viennent de la session.
- **Comment** : `server/api/quality-check.routes.ts` remplace le squelette ; colonnes `qc_*` via `workOrderQuality` ; transaction ; événement `work_order_updated` avec `scope` par rôles (admin, chef d'atelier, technicien) ; violation d'exclusion 23P01 convertie en 409. Build (pas de service existant à adopter, machine d'états hors périmètre).
- **Pourquoi** : P-25, contrat `shared/contracts/quality-check.ts`.
- **Comment tester (QA)** : activer `FEATURE_FLAGS=quality-check=on`, terminer un OT, POST `{"result":"failed","reason":"..."}` en chef d'atelier : statut `in_progress`. Technicien : 403 ; OT non terminé : 409 ; rejet sans motif : 400. Preuve : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/work-order-quality-check.contract.test.ts` (7 passés).
## 2026-10-30T15:53:27+01:00 — T-24 — Export Word d'un OT

- **Agent** : api-2 · **Branche** : `lot/api/T-24-work-order-export` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `GET /api/work-orders/:id/export?doc=ot|bon-sortie` renvoie le .docx de l'ordre de travail ou du bon de sortie.
- **Comment** : `server/api/work-order-export.routes.ts` branché sur `buildWorkOrderDocx` (T-22, branche fusionnée ici). Garde `isTechnician` pour `ot`, `isStockIssuer` pour `bon-sortie`, coupe-circuit `exports`. Un technicien ne télécharge que ses OT. 404 OT absent, 400 `doc` inconnu, `Content-Length` posé, nom de fichier fixe (id numérique validé par zod).
- **Pourquoi** : P-06 / R-07, export Word cité au CDC.
- **Comment tester (QA)** :
  - Prérequis : OT existant assigné à un technicien, comptes technicien, magasinier, client.
  - Étapes : 1. Technicien assigné : GET ?doc=ot. 2. Magasinier : ?doc=bon-sortie. 3. Technicien : ?doc=bon-sortie. 4. Autre technicien : ?doc=ot.
  - Attendu : 200 + fichier Word ouvrable ; 200 ; 403 ; 403. OT inconnu 404, ?doc=x 400.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/work-order-export.contract.test.ts` → 1 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert moindre privilège, contrat figé, nettoyage des données de test ; sans objet : migration.
- **Reste / risques** : dépend de T-22 (PR be) et T-08 ; libellés d'état d'OT définis localement faute de table partagée.
## 2026-10-30T15:57:44+01:00 — T-23b — Garde de double affectation sur les OT

- **Agent** : api-2 · **Branche** : `lot/api/T-23b-booking-guard` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : créer ou déplacer un OT sur le créneau d'un technicien ou d'un véhicule déjà pris répond 409 `CONFLICT` avec la liste des chevauchements, sans écriture.
- **Comment** : `server/middleware/booking-guard.ts` (corps fusionné avec la ligne existante, appel de `bookingGuard` de T-23a), monté dans `server/api/index.ts` (3 lignes, fichier SOL, prévu par le plan T-23b) avant les autres routeurs `/work-orders`. Sans session ou PATCH sans changement de ressource, créneau ou statut : passe la main. Branche basée sur T-23a, T-08 fusionné.
- **Pourquoi** : P-08, double affectation.
- **Comment tester (QA)** :
  - Prérequis : compte chef d'atelier, un OT actif avec technicien et créneau.
  - Étapes : 1. Créer un OT pour le même technicien sur un créneau qui chevauche. 2. Déplacer un autre OT sur ce créneau. 3. Modifier la description d'un OT.
  - Attendu : 409 avec `conflicts[]`, rien d'écrit ; 409 ; 200.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/work-order-booking-guard.contract.test.ts` → 1 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert non-régression (PATCH neutre intact), idempotence ; sans objet : migration.
- **Reste / risques** : le plan parle de `errors[]`, le contrat figé porte `conflicts` : contrat suivi. Course résiduelle lecture/écriture actée en ADR.
## 2026-10-30T16:08:35+01:00 — T-43 — Routes d'incidents

- **Agent** : api-2 · **Branche** : `lot/api/T-43-incidents-routes` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `POST` et `GET /api/incidents` (déclaration de panne) derrière le drapeau `incidents`.
- **Comment** : `server/api/incidents.routes.ts` appelle `createIncident` / `listIncidents` de be-2 (PR #29, branche fusionnée ici avec T-08). Gardes : drapeau, `authenticate`, `isAnyUser` ; le périmètre (client 403, chauffeur limité à ses véhicules en affectation active, personnel libre) est tranché par le service. POST répond 201.
- **Pourquoi** : P-22.
- **Comment tester (QA)** :
  - Prérequis : `FEATURE_FLAGS=incidents=on`, comptes chauffeur (avec affectation active), chef d'atelier, client.
  - Étapes : 1. Chauffeur déclare une panne sur son véhicule puis sur un autre. 2. Chef d'atelier déclare sur n'importe quel véhicule. 3. Client et anonyme appellent la route. 4. GET par chauffeur puis par chef d'atelier.
  - Attendu : 201 puis 403 ; 201 ; 403 et 401 ; le chauffeur ne voit que les siennes. Drapeau coupé : 404.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/incidents.contract.test.ts` → 1 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert moindre privilège, drapeau, nettoyage des données de test ; sans objet : migration.
- **Reste / risques** : dépend de la PR #29 (service). Les lancements de test ont souffert de coupures réseau vers Neon (relancés).
## 2026-10-30T16:13:02+01:00 — T-20 — Routes d'administration des sauvegardes

- **Agent** : api-2 · **Branche** : `lot/api/T-20-backups-routes` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `GET /api/admin/backups`, `GET /api/admin/backups/alerts`, `POST /api/admin/backups/run` (admin).
- **Comment** : `server/api/backups.routes.ts` sur le dépôt `backup_runs` et `runBackup` de be (T-19a/b, branche fusionnée avec T-08). Liste triée du plus récent, sans `location` (chemin) ; `durationMs` calculé. Alertes : dernière exécution échouée, aucune réussite depuis 24 h. `run` : 202 avec la ligne créée, déclenchement forcé en arrière-plan ; si une exécution tourne déjà (moins de 30 min), elle est renvoyée sans second dump ; le verrou consultatif de `runBackup` ferme la course.
- **Pourquoi** : P-05 / R-02.
- **Comment tester (QA)** :
  - Prérequis : compte admin ; `pg_dump` absent sur la recette : la ligne passe en `failed` et l'alerte part.
  - Étapes : 1. POST run. 2. GET liste puis alerts. 3. Rappeler POST run pendant l'exécution. 4. Compte non admin.
  - Attendu : 202 avec id ; ligne visible sans chemin ; même id renvoyé ; 403.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/backups.contract.test.ts` → 1 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert moindre privilège, idempotence du déclenchement, aucun chemin ni message technique exposé ; sans objet : migration.
- **Reste / risques** : le plan T-20 disait 409 sur double déclenchement ; le contrat figé dit « renvoie l'exécution en cours » : contrat suivi (202 avec la ligne en cours). Le chemin de démarrage réel (pg_dump) n'est pas lancé dans le contrat pour ne pas écrire un dump de la base de test.
## 2026-10-30T15:43:14+01:00 — T-18 — Réglages de notification par utilisateur

- **Agent** : api-2 · **Branche** : `lot/api/T-18-notifications-settings` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `GET` et `PATCH /api/notifications/settings` : chaque utilisateur lit et règle ses 9 sujets (in-app, e-mail).
- **Comment** : `server/api/notification-settings.routes.ts` (`authenticate`, `isAnyUser`). L'utilisateur vient de `req.user.id`, jamais du corps. PATCH par upsert idempotent sur (user, topic) ; sujet inconnu refusé par zod. `email` ignoré si le drapeau `email-notifications` est coupé. Absence de ligne = valeurs par défaut du contrat. Build : Adapt du pattern des routeurs existants.
- **Pourquoi** : P-07 / R-14, désactivation propre à l'utilisateur.
- **Comment tester (QA)** :
  - Prérequis : deux comptes A et B.
  - Étapes : 1. A désactive `documents` via PATCH. 2. GET avec A puis avec B.
  - Attendu : A voit `documents` inactif, B garde le sien ; un `userId` dans le corps est ignoré ; sujet inconnu 400.
  - Preuve automatisée : `node ../lot-tools/db-lock.mjs api-2 -- node --env-file=.env node_modules/vitest/vitest.mjs run --config vitest.contract.config.ts tests/contract/notification-settings.contract.test.ts` → 5 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert idempotence (upsert), non-régression (contrat figé), moindre privilège ; sans objet : migration.
- **Reste / risques** : `shouldNotify(topic)` branché par T-17 (BE).

## 2026-10-30T16:38:52+01:00 — T-44
- **Agent** : api-2 · **Branche** : `lot/api/T-44-fuel` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : `POST /api/fuel-vouchers/:id/validate`, `GET/POST /api/fuel-prices`, et lecture centralisée du prix du litre (`getFuelPriceAt`) à la place des 828 en dur de `missions.routes.ts` et `fuel-card-service.ts`.
- **Comment** : `fuel-voucher-service.ts` (mise à jour conditionnée à `pending` : idempotent, auteur et date non réécrits), `fuel-price-service.ts` (upsert sur la date d'effet ; repli sur 828 du contrat si lecture impossible). Gardes : écriture et validation `isFuelCardManager` (technicien 403), lecture des prix `isStaff`. Build : Adapt.
- **Pourquoi** : P-17, P-19, PR-16 (constante figée remplacée).
- **Comment tester (QA)** :
  - Prérequis : drapeaux `fuel-vouchers` et `fuel-prices` actifs ; compte logistique.
  - Étapes : 1. Poser 843 au 1er novembre. 2. Interroger le prix au 30 octobre et au 2 novembre. 3. Valider un bon deux fois.
  - Attendu : 828 puis 843 ; bon validé avec l'auteur, second appel sans changement.
  - Preuve automatisée : contrat `fuel-vouchers-prices` 7 passed ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert idempotence, repli sûr, non-régression (défaut 828 inchangé) ; sans objet : migration (table existante).
- **Reste / risques** : le solde carburant utilise maintenant le prix du jour au lieu de 828 fixe quand aucun prix réel moyen n'existe.
## 2026-10-30T16:33:12+01:00 — T-17b
- **Agent** : api-2 · **Branche** : `lot/api/T-17b-should-notify` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : les alertes respectent les réglages de notification : un utilisateur qui coupe un thème in-app ne reçoit plus les alertes de ce thème.
- **Comment** : `notification-preferences-service.ts` (`filterUsersByTopic` en une requête pour tout le lot, `shouldNotify`), règle pure dans `notification-preference-rule.ts`. `createAlertIfNotExists` filtre ses destinataires et pose `topic` sur l'alerte (par défaut le type). Sans ligne : in-app actif, e-mail coupé. Lecture en échec : tous conservés (une alerte en trop plutôt qu'une perdue). Build : Adapt.
- **Pourquoi** : P-12, réglages de T-18 effectifs.
- **Comment tester (QA)** :
  - Prérequis : deux comptes, tous deux destinataires d'un même type d'alerte.
  - Étapes : 1. A coupe le thème via PATCH /api/notifications/settings. 2. Provoquer l'alerte.
  - Attendu : B la reçoit, A non ; les autres thèmes de A inchangés.
  - Preuve automatisée : unitaire (2 passed), intégration `notification-preferences-service` (2 passed) ; `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert défaut non-régressif, repli sûr, une seule requête ; sans objet : migration.
- **Reste / risques** : chevauche `alert-service.ts` avec BE T-17a (non poussée) : résoudre à la fusion. Canal e-mail non branché (hors périmètre).
## 2026-11-03 — DIR3 libellés d'export
- **Agent** : api-2 · **Branche** : `fix/dir3-export-labels` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : les exports utilisateurs et ordres de travail sortent des libellés français (rôles magasinier, secrétaire, logisticien, direction ; statut « Attente pièces » ; priorité « Critique »).
- **Comment** : `ROLE_LABELS` déplacé dans `shared/constants/roles.ts` (`Record<AppRole,string>`), nouveau `shared/constants/work-orders.ts` (statuts et priorités d'OT), `export-service.ts` les importe avec repli `label ?? raw`. Build : Adapt.
- **Pourquoi** : défauts DIR3-1/2/3 ; une table locale divergente de l'enum du schéma.
- **Comment tester (QA)** : Exporter les ordres de travail et les utilisateurs ; attendu : plus d'identifiant technique brut dans Rôle, Statut, Priorité.
- **Preuve automatisée** : contrat exports 221 passed (6 fichiers), unitaires 1470 passed, `tsc --noEmit` 0 erreur.
- **RAIDER** : couvert source unique, non-régression (libellés UI inchangés) ; sans objet : migration.
- **Reste / risques** : tables client divergentes pour « attente pièces » (voir PR).
