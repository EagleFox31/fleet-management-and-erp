## Relecture PR #64 - délimitation des préfixes, invalidation en double

**Quoi**
- Unitaire `document-expiry-rule` : les préfixes de levée du document 1 ne couvrent pas les clés des documents 10 et 12.
- `useRealTimeSync.ts` : bloc d'invalidation DOC3 retiré, le même `case` invalide déjà les quatre clés d'alertes.

**Pourquoi**
- Relecture : aucun test ne cassait si le `:` final du préfixe disparaissait (le contrat utilise des ids consécutifs).

**Preuve**
- Unitaire 10/10 sur le fichier, `tsc` 0 erreur.

