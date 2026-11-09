## 2026-11-03 14:05 — PRT1 : test.fail du temps réel levé après #165

- **Quoi** : le cas deux profils de `e2e/21-parts-catalog.spec.ts` passe en `test` ordinaire ; la ligne PRT1 du plan note le défaut corrigé.
- **Comment** : #165 émet `part_catalog_changed` sur POST, PATCH, DELETE et update-stock ; la reconnaissance de trame de la spec l'acceptait déjà.
- **Pourquoi** : la PR qui fusionne en second lève le `test.fail` (Playwright signalerait sinon l'échec inverse).

