# text-destructive-text partout + fond plein destructive lisible (fix/destructive-text-everywhere)

## Quoi
- 21 fichiers de `client/src` : `text-destructive` seul (y compris `hover:` et `/90`) devient `text-destructive-text` (41 lignes, jeton seul, aucun reformatage). `text-destructive-foreground` (fond plein) inchange.
- `client/src/index.css` : `--destructive` clair `0 84.2% 60.2%` -> `0 84.2% 48%` (decision de l'utilisatrice : texte blanc >= 4,5 sur bouton, badge, toast). Mode sombre inchange.
- Garde-fous (`tests/unit/client/semantic-color-tokens.test.ts`) : `text-destructive` nu interdit dans tout `client/src` (liste gelee vide) ; chaines de classes testees en entier, donc multi-lignes ; liste fixe `EXCLUS_HISTORIQUE` (plus de filtre sur « avant/ancien ») ; chaque couple porte `[fichier, motif]` verifie dans le code ; couples de la carte CPC (`bg-white` / `dark:bg-slate-900`) ajoutes.

## Comment (WCAG, `node scripts/contrast-semantic-text.mjs`)
| Couple | Avant (clair / sombre) | Apres (clair / sombre) |
|---|---|---|
| destructive-foreground sur destructive (fond plein) | 3,60 / 9,59 | 4,65 / 9,59 |
| destructive-text sur destructive/10 | 8,18 / 9,04 | 7,88 / 9,04 |
| carte CPC : foreground sur carte | - | 19,76 / 17,13 |
| carte CPC : muted-foreground sur carte | - | 4,80 / 6,99 |

Le texte `text-destructive` n'existe plus : il est remplace par `--destructive-text`, jeton propre qui ne depend pas de `--destructive`. Aucun texte n'est degrade par l'assombrissement ; seuls les teintes `/10`, bordures et anneaux deviennent legerement plus soutenus en mode clair.

## Pourquoi
Rouge clair `60,2 %` : blanc dessus 3,60 < 4,5 (AA). Les 3 `hover:text-destructive` (users-table, settings, workflow-documents-viewer) a verifier a l'oeil.
