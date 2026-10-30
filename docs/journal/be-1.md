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
