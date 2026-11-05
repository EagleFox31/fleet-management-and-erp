# fe : jetons success/warning/destructive, mission et formulaire CPC

## Quoi
Les couleurs Tailwind en dur (emerald, green, amber, yellow, rose) de `client/src/pages/missions/new.tsx` (9 occurrences) et `client/src/components/drivers/cpc-update-form.tsx` (5) sont remplacées par les jetons du design system. Aucune logique ni aucun libellé modifié. Nouveau garde-fou : `tests/unit/client/semantic-color-tokens.test.ts`.

## Comment
- succès : `bg-success/10 text-success border-success/30` ; bouton plein `bg-success text-success-foreground hover:bg-success/90`
- alerte : `text-warning-text`, `bg-warning/10` (jamais `text-warning` en clair)
- danger CPC (expiré) : `bg-destructive/10 text-destructive-text border-destructive/30` (avant : `bg-destructive text-destructive-foreground`, 3,60 clair avec texte 10 px gras, ce qui n'est pas du gros texte : seuil 4,5)
- neutre CPC : `bg-muted text-foreground border-border` (avant : `text-muted-foreground`, 4,40 clair, sous AA)
- mission/new.tsx : `text-destructive` sur `bg-destructive/10` (statut CPC, deux bandeaux d'erreur) passe à `text-destructive-text` ; le badge « CPC valide » posé sur la carte `bg-muted` (4,47 clair avec `bg-success/10`) devient `border border-success/30 bg-background text-success` (4,80 clair)

## Contrastes WCAG (script `scripts/contrast-semantic-text.mjs`, fond composé sur la surface, seuil 4,5)
| Couple | Clair avant | Clair après | Sombre avant | Sombre après |
|---|---|---|---|---|
| badge CPC expiré | 3,60 | 8,18 | 9,59 | 9,04 |
| badge CPC neutre | 4,40 | 18,12 | 5,81 | 14,25 |
| text-success sur success/10 (page) | 4,85 | 4,85 | 9,04 | 9,04 |
| text-success sur success/10 (carte muted) | 4,47 | 4,80 (fond page) | 6,38 | 9,04 |
| text-warning-text sur warning/10 (page) | 7,64 | 7,64 | 8,20 | 8,20 |
| text-warning-text sur warning/10 (carte muted) | 7,05 | 7,05 | 5,80 | 5,80 |
| text-destructive sur destructive/10 (ancien) / destructive-text (nouveau) | 3,30 | 8,18 | 1,93 | 9,04 |
| success-foreground sur success (bouton) | 5,60 | 5,60 | 10,36 | 10,36 |

Tous les couples employés sont >= 4,5 dans les deux thèmes.

## Pourquoi
Les palettes en dur ignorent le mode sombre unifié et le contrat de contraste des jetons.

## Tester
`node node_modules/vitest/vitest.mjs run tests/unit/client/semantic-color-tokens.test.ts` : rouge sur l'ancien code (2 échecs), vert après ; les deux derniers tests couvrent le badge CPC (expiré et neutre). `node scripts/contrast-semantic-text.mjs` rejoue les ratios.
