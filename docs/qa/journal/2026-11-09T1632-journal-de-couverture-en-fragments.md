## Journal de couverture en fragments : un fichier par entrée

**Quoi** : `docs/qa/JOURNAL_COUVERTURE.md` est découpé en `docs/qa/journal/<AAAA-MM-JJTHHMM>-<slug>.md`. L'ancien fichier devient un pointeur. L'index s'affiche à la demande (`npm run journal:index`), il n'est pas commité.

**Comment** :
- `scripts/doc-fragments.ts migrate` découpe le journal. La logique pure est dans `scripts/lib/doc-fragments.ts` : découpe, nommage et index, testés dans `tests/unit/docs/doc-fragments-lib.test.ts`.
- La migration est idempotente : une seconde exécution avec le même manifeste ne fait rien.
- L'horodatage vient du titre, sinon de `git blame` de la ligne de titre.
- Le manifeste figé `_migration-2026-11-09.json` garde le préambule, l'ordre d'origine et le sha256 de la source.

**Pourquoi** : 5 PR en conflit le 9 novembre sur ce seul fichier. GitHub n'applique pas `merge=union`. Leçon : `docs/analysis/LESSONS_LEARNED.md`, 2026-11-09.

**Preuve** : `tests/unit/docs/journal-fragments.test.ts`, vert. Il est rouge dans chacun des trois cas suivants, chacun avec la consigne :
- une entrée `## ` ajoutée à l'ancien fichier ;
- un `notes.md` mal nommé dans le dossier ;
- un fragment migré modifié (empreinte différente).

Le sha256 du manifeste est celui du fichier d'origine dans git, fins de ligne en LF.
