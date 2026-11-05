# fe : jetons success/warning/destructive, mission et formulaire CPC

## Quoi
Les couleurs Tailwind en dur (emerald, green, amber, yellow, rose) de `client/src/pages/missions/new.tsx` (9 occurrences) et `client/src/components/drivers/cpc-update-form.tsx` (5) sont remplacées par les jetons du design system. Aucune logique ni aucun libellé modifié. Nouveau garde-fou : `tests/unit/client/semantic-color-tokens.test.ts`.

## Comment
- succès : `bg-success/10 text-success border-success/30` ; bouton plein `bg-success text-success-foreground hover:bg-success/90`
- alerte : `text-warning-text`, `bg-warning/10` (jamais `text-warning` en clair)
- danger CPC (expiré) : `bg-destructive text-destructive-foreground`
- neutre CPC : `bg-muted text-muted-foreground border-border`

## Contrastes WCAG (calculés depuis index.css, clair sur blanc, sombre sur 240 10% 3.9%)
| Usage | Clair | Sombre |
|---|---|---|
| text-success sur bg-success/10 | 4,85 | 9,04 |
| text-success nu | 5,60 | 10,36 |
| text-warning-text sur warning/10 | 7,02 | 8,20 |
| text-muted-foreground sur bg-muted | 4,40 | 5,81 |
| destructive-foreground sur bg-destructive (plein) | 3,60 | 9,59 |
| success-foreground sur bg-success (bouton) | 5,60 | 10,36 |

Écart signalé : `text-destructive` sur `bg-destructive/10` donne 3,30 (clair) et 1,93 (sombre), insuffisant (déjà utilisé dans missions/new.tsx pour les cartes d'incompatibilité, laissé tel quel). Pour le badge CPC expiré, la variante pleine est retenue (3,60 clair, limite AA gros texte ; 9,59 sombre). Correction propre : jeton `--destructive-text` dans index.css (hors périmètre).

## Pourquoi
Les palettes en dur ignorent le mode sombre unifié et le contrat de contraste des jetons.

## Tester
`node node_modules/vitest/vitest.mjs run tests/unit/client/semantic-color-tokens.test.ts` : rouge sur l'ancien code (2 échecs), vert après.
