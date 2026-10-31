# Journal — API 2 (`api-2`)

Worktree : `../fm-api-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

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
