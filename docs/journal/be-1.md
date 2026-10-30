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

## 2026-10-30T14:00:00+01:00 — T-14 — Journal d'audit : masquage, recordAudit, auditWrites (partie pure)

- **Agent** : be-1 · **Branche** : `lot/be/T-14-audit` (empilée sur `lot/be/T-22-docx` pour garder un journal linéaire) · **Commit** : voir `git log`
- **Statut** : en cours (écriture en base et montage en attente de db-1 et sol)
- **Quoi** : `maskSecrets` (clés `password`, `pin`, `token`, `*secret*`, `authorization`, valeur `AUDIT_MASK`), troncature à 4 ko, `recordAudit` non bloquant, middleware déclaratif `auditWrites({ rules })` écrivant après la réponse (< 400).
- **Comment** : `server/lib/audit.ts`, `server/middleware/audit-writes.ts`. L'écriture passe par un `AuditSink` injecté (`setAuditSink`) : le sink Drizzle vers `activity_logs` (colonnes method, path, entityId texte du schéma db-1) reste à brancher quand `origin/lot/db/T-07-schema` existera. Build, inspiré de Adapt.
- **Pourquoi** : P-04, PR-07.
- **Comment tester (QA)** : preuve automatisée `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/audit.test.ts` → `8 passed` ; tsc 0 `error TS`.
- **RAIDER** : R/A règles et sink injectés ; I n/a ; D rien d'existant modifié ; E secrets masqués, panne d'audit journalisée sans casser la requête. 3 couches n/a.
- **Reste / risques** : sink base, liste gelée des 8 motifs MUST, montage `apiRouter.use(auditWrites(AUDIT_CONFIG))` dans `server/api/index.ts` (à sol), test d'intégration.
