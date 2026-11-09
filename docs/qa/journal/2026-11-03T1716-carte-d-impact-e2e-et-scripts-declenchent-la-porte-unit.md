## 2026-11-03 17:16 — Carte d'impact : e2e/ et scripts/ déclenchent la porte unit

- **Quoi** : `.github/appfactory-impact.json`, les surfaces `e2e` et `scripts` gagnent `unit`.
- **Pourquoi** : main rouge après #194. La garde `toast-title-exact-hygiene` lit e2e/, et la CI d'une PR limitée à e2e/ ne la lançait pas. Leçon dans `docs/analysis/LESSONS_LEARNED.md`.
- **Preuves** : unitaires 1854/1854 avec la spec corrigée.

