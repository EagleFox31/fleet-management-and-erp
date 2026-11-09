# Journal de la campagne de couverture — une entrée par fichier

Ce dossier remplace `docs/qa/JOURNAL_COUVERTURE.md`. Le fichier unique produisait un conflit
à chaque fusion de deux PR qui ajoutaient chacune leur entrée (5 le 9 novembre 2026). Un
fichier par entrée supprime ce conflit : deux PR n'écrivent jamais le même fichier.

## Écrire une entrée

1. Créer `docs/qa/journal/<AAAA-MM-JJTHHMM>-<slug>.md`, dans le **même commit** que le
   changement.
   - Horodatage : heure locale de la machine, `date +%Y-%m-%dT%H%M`.
   - Slug : le sujet en minuscules ASCII, mots séparés par `-`, 60 caractères au plus.
     Pas de numéro de PR, pas de sha : ils ne sont pas connus au moment d'écrire.
   - Collision de nom : ajouter `-2`.
2. La première ligne est le titre `## <sujet>`, puis les rubriques habituelles :

   ```markdown
   ## Alertes : une lecture en échec n'est plus « 0 alerte »

   **Quoi** : ...
   **Comment** : ... (test rouge d'abord, correctif minimal, suites complètes)
   **Pourquoi** : ...
   **Preuve** : commandes rejouables et résultat.
   ```

3. On ne réécrit pas une entrée passée : une correction est une nouvelle entrée qui renvoie
   à l'ancienne.
4. Un incident va dans `docs/analysis/LESSONS_LEARNED.md` ; l'entrée y renvoie.

Codes de tests (voir `PLAN_COUVERTURE_MODULES.md`) : **T1** 401/403 par rôle, **T3** 400
lisible sur corps invalide, **T4** champs tenus par le serveur ignorés, **T7** double
soumission sans doublon.

## Lire le journal

Aucun index n'est commité : il redeviendrait un fichier unique en conflit. À la demande :

```bash
npm run journal:index            # tableau horodatage / entrée, du plus ancien au plus récent
ls docs/qa/journal | tail        # dernières entrées
grep -rl "T7" docs/qa/journal    # entrées qui parlent d'un code de test
```

## Migration du 9 novembre 2026

Les 172 entrées de l'ancien fichier ont été découpées par `scripts/doc-fragments.ts migrate`.
Pour les titres sans date, l'horodatage vient du commit qui a écrit le titre (`git blame`).

`_migration-2026-11-09.json` est le manifeste **figé** de cette migration : préambule
d'origine, ordre d'origine des fragments, empreinte sha256 du fichier source. Il n'est
**jamais réécrit**, et les fragments qu'il liste ne sont plus modifiés : le test
`tests/unit/docs/journal-fragments.test.ts` recolle préambule et fragments dans l'ordre et
doit retrouver l'empreinte, preuve que la découpe n'a rien perdu.

## Garde

`tests/unit/docs/journal-fragments.test.ts` échoue si une entrée `## ` est ajoutée dans
`docs/qa/JOURNAL_COUVERTURE.md`, ou si un fichier de ce dossier ne suit pas le nommage
ci-dessus ou ne commence pas par `## `.
