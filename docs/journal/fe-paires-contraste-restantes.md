# Paires de contraste restantes (fix/contrast-remaining-pairs)

## Quoi
- Balayage de `client/src` : toute ligne portant `text-<jeton>` et `bg-<jeton>[/alpha]`, ratio WCAG calcule sur les deux themes.
- Corrige : `bg-secondary/10 text-secondary` (badge neutre `ui/badge.tsx:24`, alerts-panel:67) = 1,08 clair / 1,31 sombre (texte quasi invisible) -> `bg-muted text-muted-foreground` (4,69 / 5,81).
- Garde-fou : `tests/unit/client/token-pairs-contrast.test.ts` (cliquet, liste gelee de 4 paires primary). Mutation : remettre l'ancienne classe le fait echouer.

## Decision en attente (marque) : vert primary `142 69% 36%`
| Paire | Ratio actuel (clair) | Occurrences |
|---|---|---|
| primary-foreground (blanc) sur primary (Button, Badge, calendrier, pagination...) | 3,59 (sombre 3,59) | 20 |
| primary sur primary/10, /15, /20 (badges, pastilles) | 3,20 / 3,02 / 2,84 | 4 |

Option A : `--primary` a `142 69% 31%` : blanc dessus 4,66 ; texte primary sur /10 4,10 (reste < 4,5 : prevoir un jeton `--primary-text`, comme destructive-text). Option B : ne rien changer (texte gras/grand 3:1 admis). Le gel disparait avec la decision.
