# --muted-foreground : contraste >= 4,5 sur muted (fix/muted-contrast)

## Quoi
- `client/src/index.css` (clair) : `--muted-foreground` `25 5.3% 44.7%` -> `25 5.3% 43%`. Sombre inchange.
- `scripts/contrast-semantic-text.mjs` : surface « couches » (`sous`), deux couples ajoutes, couple historique « neutre avant » retire.
- Test : liste d'exclusion figee ramenee a 2 couples.

## Comment (WCAG)
| Couple | Avant (clair / sombre) | Apres |
|---|---|---|
| muted-foreground sur muted (= secondary, accent) | 4,40 / 5,81 | 4,69 / 5,81 |
| muted-foreground sur muted/50 dans carte destructive/5 (error-boundary « Suggestions ») | 4,41 / 6,85 | 4,70 / 6,85 |
| muted-foreground sur page | 4,80 / 7,77 | 5,11 / 7,77 |

Mutation : remettre 44.7 % fait echouer le test (4,40 < 4,5). `npm run check` : zero erreur TS ; tests unitaires 2560 verts.
Hors perimetre : muted-foreground sur `destructive/10` (4,25) n'existe nulle part dans le code ; icones (3:1) non traitees.
