# Journal — Backend 1 (`be-1`)

Worktree : `../fm-be-1`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T13:55:00+01:00 — T-22 — Générateur .docx de l'OT et du bon de sortie

- **Agent** : be-1 · **Branche** : `lot/be/T-22-docx` · **Commit** : voir `git log` de la branche
- **Statut** : fait
- **Quoi** : module pur `buildWorkOrderDocx(doc, data, header?)` qui renvoie un Buffer .docx (OT ou bon de sortie), en-tête TAY texte seul, remplaçable.
- **Comment** : `server/lib/word/` (types, header, common, work-order-doc, exit-voucher-doc, index). Adopt de `docx` (builder), aucun gabarit externe. Aucun accès base : la route T-24 charge les données et les convertit en `WorkOrderDocData`. Types `WorkOrderExportDoc` et `DOCX_CONTENT_TYPE` viennent du contrat figé.
- **Pourquoi** : P-06 / D-12, PR-10.
- **Comment tester (QA)** :
  - Prérequis : aucun (pas de base).
  - Étapes : lancer le test unitaire ; ouvrir un .docx généré dans Word (relecture PE, T-37).
  - Attendu : textes clés, tableaux, accents ; jamais `undefined`.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/word` → `7 passed` ; `tsc --noEmit` → 0 `error TS`.
- **RAIDER** : R/A en-tête et données injectés ; I fonction pure déterministe ; D aucun fichier existant modifié ; E erreurs n/a. Les 3 couches ne s'appliquent pas (aucune transition métier).
- **Reste / risques** : rendu Word réel non vérifié automatiquement ; logo TAY à fournir. Le test lit le zip avec `fflate` (dépendance transitive de `docx`, absente de `package.json` ; `jszip` n'est pas installé).
## 2026-10-30T18:10:00+01:00 — T-22 — En-tête officiel TAY dans l'export Word

- **Agent** : be-1 · **Branche** : `lot/be/T-22-docx` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : le papier officiel (`attached_assets/TAY-header-final.png`, repli `TAY-header.png`) devient le vrai en-tête Word (`word/header1.xml`, `ImageRun` à la largeur utile du papier, marges A4 du papier). Repli texte si l'image manque, avec avertissement `moduleLogger("word-export")`. `TAY-Entêtes.docx` ne contient qu'un en-tête (logo et coordonnées dans l'image), pas de pied de page : rien à reproduire en pied.
- **Comment** : `server/lib/tay-header-asset.ts` (résolution de chemin unique, aussi utilisée par `pdf-generation-service.ts`), `server/lib/word/header.ts`, `index.ts`. `fflate` déclaré en devDependency (test).
- **Pourquoi** : T-22, papier à en-tête officiel.
- **Comment tester (QA)** : `tests/unit/server/word/work-order-docx.test.ts` → 9 passed (image dans `word/media`, relation image dans l'en-tête, repli texte).
- **RAIDER** : R/A chemin et image partagés PDF/Word ; D PDF inchangé, tsc 0 ; E repli sans échec d'export.
- **Reste / risques** : rendu visuel à valider dans Word (marge haute 2800 twips pour une image de 1067x236).

## 2026-10-30T14:00:00+01:00 — T-14 — Journal d'audit : masquage, recordAudit, auditWrites (partie pure)

- **Agent** : be-1 · **Branche** : `lot/be/T-14-audit` (empilée sur `lot/be/T-22-docx` pour garder un journal linéaire) · **Commit** : voir `git log`
- **Statut** : en cours (écriture en base et montage en attente de db-1 et sol)
- **Quoi** : `maskSecrets` (clés `password`, `pin`, `token`, `*secret*`, `authorization`, valeur `AUDIT_MASK`), troncature à 4 ko, `recordAudit` non bloquant, middleware déclaratif `auditWrites({ rules })` écrivant après la réponse (< 400).
- **Comment** : `server/lib/audit.ts`, `server/middleware/audit-writes.ts`. L'écriture passe par un `AuditSink` injecté (`setAuditSink`) : le sink Drizzle vers `activity_logs` (colonnes method, path, entityId texte du schéma db-1) reste à brancher quand `origin/lot/db/T-07-schema` existera. Build, inspiré de Adapt.
- **Pourquoi** : P-04, PR-07.
- **Comment tester (QA)** : preuve automatisée `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/audit.test.ts` → `8 passed` ; tsc 0 `error TS`.
- **RAIDER** : R/A règles et sink injectés ; I n/a ; D rien d'existant modifié ; E secrets masqués, panne d'audit journalisée sans casser la requête. 3 couches n/a.
- **Reste / risques** : sink base, liste gelée des 8 motifs MUST, montage `apiRouter.use(auditWrites(AUDIT_CONFIG))` dans `server/api/index.ts` (à sol), test d'intégration.

## 2026-10-30T14:10:00+01:00 — T-12 — Verrouillage de compte (logique pure et intercepteur)

- **Agent** : be-1 · **Branche** : `lot/be/T-12-verrouillage` (empilée sur T-14) · **Commit** : voir `git log`
- **Statut** : en cours (magasin base et montage en attente de db-1 et sol)
- **Quoi** : `nextLockState`, `isLocked`, `lockoutConfigFromEnv` (`LOCKOUT_MAX_ATTEMPTS`, `LOCKOUT_MINUTES`, défauts `LOCKOUT_DEFAULTS`), interface `LockoutStore` (+ `MemoryLockoutStore`), intercepteur `loginLockoutGuard` : 429 `RATE_LIMITED` avec `lockedUntil` avant la route, 401 incrémente et 2xx remet à zéro après la réponse. Compteur par nom normalisé, nom inconnu inclus.
- **Comment** : `server/services/login-lockout-service.ts`, `server/middleware/login-lockout-guard.ts`. Build (rate-limiter-flexible écarté, plan §3). Sans `AppError.details` (T-08 absent) le corps 429 est écrit directement au format `lockedResponseSchema`.
- **Pourquoi** : P-03, PR-06.
- **Comment tester (QA)** : preuve automatisée `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/login-lockout.test.ts` → `4 passed` ; tsc 0 `error TS`. Manuel après montage : 5 mauvais mots de passe puis 6e essai → 429 avec `lockedUntil`.
- **RAIDER** : R/A seuils par environnement, magasin injecté ; I un succès remet à zéro, verrou expiré repart de zéro ; D rien d'existant modifié ; E aucune fuite d'existence du compte. 3 couches n/a (pas de transition métier).
- **Reste / risques** : `DbLockoutStore` (UPDATE ... RETURNING atomique, table de db-1, miroir `users.failed_login_count/locked_until`), `recordAudit` blocage/déblocage, montage, test d'intégration de concurrence, `express-rate-limit`.
## 2026-10-30T15:00:00+01:00 — T-14 — Sink base et liste gelée des motifs audités

- **Agent** : be-1 · **Branche** : `lot/be/T-14-audit` (fusion de `origin/lot/db/T-07-schema`) · **Commit** : voir `git log`
- **Statut** : fait, hors montage (sol)
- **Quoi** : `dbAuditSink` écrit dans `activity_logs` (id numérique vers `entity_id`, sinon `entity_ref` ; `method`, `path`, `requestId` dans `details`). `AUDIT_CONFIG` : 8 types audités (OT, pièces, pneus, véhicules, demandes de pièce, commandes, factures fournisseur, utilisateurs), chemins imbriqués rattachés à l'entité parente.
- **Comment** : `server/lib/audit-db-sink.ts`, `server/lib/audit-config.ts`, test de liste gelée `tests/unit/server/audit-config.test.ts`. Les 8 motifs sont mon choix, à valider par PE.
- **Pourquoi** : P-04, PR-07.
- **Comment tester (QA)** : après montage, modifier un OT puis lire `activity_logs` : une ligne avec auteur, méthode, chemin. Preuve : `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/audit-config.test.ts` → 3 passed.
- **RAIDER** : R/A configuration déclarative ; D rien d'existant modifié ; E panne d'écriture sans effet sur la requête.
- **Reste / risques** : montage et `setAuditSink(dbAuditSink)` au démarrage (sol). Test d'intégration ajouté avec T-12 (même fichier de base).
## 2026-10-30T16:10:00+01:00 — T-12/T-14 — Magasin en base, 429 via AppError, sink branché au démarrage

- **Agent** : be-1 · **Branche** : `lot/be/T-12-verrouillage` · **Commit** : voir `git log`
- **Statut** : fait, hors montage du garde (sol)
- **Quoi** : `DbLockoutStore` (INSERT ... ON CONFLICT atomique, miroir `users`, blocage audité une seule fois) ; le garde lève `AppError(429, details.lockedUntil)` ; `setAuditSink(dbAuditSink)` au démarrage dans `server/index.ts` ; correction de l'échappement `\d` dans `audit-config.ts`.
- **Comment** : `server/services/login-lockout-db-store.ts`, `server/middleware/login-lockout-guard.ts`, `server/lib/audit-config.ts`, `server/index.ts`.
- **Pourquoi** : P-03, PR-06, P-04, PR-07.
- **Comment tester (QA)** : `tests/integration/login-lockout-db-store.test.ts` sous db-lock → 2 passed (10 échecs simultanés, expiration/reset) ; unitaires 7 passed ; tsc 0 error TS.
- **RAIDER** : I upsert atomique, reset idempotent ; D contrat 429 inchangé ; E aucune fuite d'existence du compte.
- **Reste / risques** : montage du garde par sol.
## 2026-10-30T16:40:00+01:00 — T-57 — Montage des gardes de connexion et de l'audit

- **Agent** : be-1 (reprise de sol) · **Branche** : `lot/be/T-57-montage-gardes` (depuis T-12, fusion de `origin/lot/sol/T-48-captcha`) · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : dans `createApiRouter`, après la session : `loginLockoutGuard` puis `captchaGuard` sur `POST /auth/login` et `/auth/pin-login` (`usernameField: "userId"`), puis `auditWrites(AUDIT_CONFIG)`. Anti-rejeu du captcha : une preuve valide n'est acceptée qu'une fois (`consumeCaptchaProof`, mémoire injectable).
- **Comment** : ordre vérifié dans `server/app.ts` : `express.json()` (l.86), puis `app.use("/api", apiRouter)`, puis `registerRoutes` : les gardes passent donc avant les handlers de `server/routes.ts:132/239`, sans doubler le parseur. Test `tests/contract/login-guards-mount.contract.test.ts`, test unitaire `captcha-replay.test.ts`.
- **Pourquoi** : P-03, P-26, P-04.
- **Comment tester (QA)** : 5 mauvais mots de passe puis 6e essai → 429 `RATE_LIMITED` avec `lockedUntil` (login et pin-login) ; avec `FEATURE_FLAGS=captcha=on`, dès 3 échecs la preuve est exigée et ne sert qu'une fois.
- **RAIDER** : I verrou et reset idempotents ; D handlers de `routes.ts` intacts ; E 400/429 normalisés. 3 couches n/a.
- **Reste / risques** : anti-rejeu en mémoire du processus (non partagé entre instances ni conservé au redémarrage ; une preuve reste de toute façon limitée à 5 min) ; `userId` du pin-login et `username` partagent l'espace de clés du compteur (un identifiant « 5 » et l'utilisateur id 5 se confondent) ; `setAuditSink` reste à `server/index.ts`, donc inactif dans les tests de contrat qui ne l'appellent pas.
## 2026-10-30T17:30:00+01:00 — T-57 — Espaces de clés du verrouillage séparés

- **Agent** : be-1 · **Branche** : `lot/be/T-57-montage-gardes` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : clés du compteur préfixées par route : `pwd:<username>` (login) et `pin:<userId>` (pin-login). Option `keyPrefix` du garde ; le miroir `users` cible le nom (pwd:) ou l'id (pin:) ; `unlockUser` supprime les deux clés et l'ancienne. Compteurs existants sans préfixe : ignorés (expirent avec le verrou).
- **Pourquoi** : un identifiant « 5 » ne doit pas bloquer l'utilisateur d'id 5.
- **Comment tester (QA)** : contrat `login-guards-mount` (5 cas) ; 5 échecs login avec « id » puis pin-login de cet id → 200, `failed_login_count` à 0.
- **Reste / risques** : l'anti-rejeu du captcha reste en mémoire (mono-instance). Timeout des tests captcha porté à 60 s (preuve de travail lente en charge).
