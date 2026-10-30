# Journal — API 2 (`api-2`)

Worktree : `../fm-api-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

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
