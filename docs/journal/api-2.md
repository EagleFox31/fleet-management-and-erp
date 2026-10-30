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
