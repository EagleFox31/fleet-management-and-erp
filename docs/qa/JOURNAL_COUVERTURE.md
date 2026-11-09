# Journal de la campagne de couverture — déplacé

Ce fichier ne reçoit plus d'entrée. Le journal vit dans `docs/qa/journal/`, un fichier par entrée :
voir `docs/qa/journal/README.md` (règle, nommage, format).

Lire le journal : `npm run journal:index`.

Pourquoi : le fichier unique produisait un conflit à chaque fusion de deux PR
(`docs/analysis/LESSONS_LEARNED.md`, 2026-11-09). Les 171 entrées d'origine ont été découpées
sans perte, preuve : `tests/unit/docs/journal-fragments.test.ts`.
