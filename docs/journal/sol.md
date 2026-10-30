# Journal — Architecte (`sol`)

Worktree : `../fm-sol`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T14:00:00+01:00 — T-08 — Squelette serveur : drapeaux, details d'erreur, routeurs du lot

- **Agent** : sol · **Branche** : `lot/sol/T-08-squelette` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : `GET /api/feature-flags`, garde `requireFeature(key)` (404 normalisé), `AppError.details` fusionné dans le corps (429 `lockedUntil`, 409 `conflicts`), 19 routeurs de ressources du lot montés en squelettes 501 derrière leur drapeau.
- **Comment** : `server/lib/feature-flags.ts` (Build, sur `shared/feature-flags.ts`), `server/api/stub.ts` (`createStubRouter`), un `server/api/<ressource>.routes.ts` par contrat, montés en fin de `createApiRouter` ; `details` transmis par `res.locals` à la garde de sortie, clés réservées (message, code, requestId, errors) jamais écrasées. Lignes de montage existantes non touchées (api-1).
- **Pourquoi** : ADR 0001 §6 et D2 (un seul passage sur le fichier chaud).
- **Comment tester (QA)** :
  - Prérequis : serveur lancé, compte quelconque.
  - Étapes : 1. `GET /api/feature-flags` connecté. 2. `GET /api/incidents` avec défauts.
  - Attendu : 1. 200, objet de booléens. 2. 404 `NOT_FOUND` (501 si `FEATURE_FLAGS=incidents=on`).
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run tests/unit/server/feature-flags.test.ts` → 7 passed ; contrat : `tests/contract/feature-flags.contract.test.ts` sous `db-lock`.
- **RAIDER** : couvert R/A/I/D (ajout non cassant, aucun chemin existant masqué), E (404 normalisé, logs `moduleLogger`) ; failure memory sans objet.
- **Reste / risques** : gardes de rôle des squelettes à resserrer par chaque propriétaire.

## 2026-10-31T14:20:00+01:00 — T-27 — Runbook de la recette

- **Agent** : sol · **Branche** : `lot/sol/T-08-squelette` · **Commit** : voir `git log`
- **Statut** : en cours (rédaction seule ; instance et base à créer)
- **Quoi** : `docs/deploiement/recette.md` (variables, `APP_ENV=recette`, `FEATURE_FLAGS`, déploiement depuis l'étiquette, reset).
- **Comment** : document seul, aucune commande d'hébergement ni Neon. Ce qui dépend du compte est marqué « À valider ».
- **Pourquoi** : T-27, ADR 0001.
- **Comment tester (QA)** : relire le §7 et confirmer chaque point avec le titulaire du compte.
- **RAIDER** : sans objet hors documentation.
- **Reste / risques** : `APP_ENV` n'est lu par aucun code à ce jour.
