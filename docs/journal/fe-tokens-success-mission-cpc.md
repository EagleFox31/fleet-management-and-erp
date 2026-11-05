# fe : jetons success/warning/destructive, mission et formulaire CPC

## Quoi
Les couleurs Tailwind en dur (emerald, green, amber, yellow, rose) de `client/src/pages/missions/new.tsx` (9 occurrences) et `client/src/components/drivers/cpc-update-form.tsx` (5) sont remplacées par les jetons du design system. Aucune logique ni aucun libellé modifié. Nouveau garde-fou : `tests/unit/client/semantic-color-tokens.test.ts`.

## Comment
- succès : `bg-success/10 text-success border-success/30` ; bouton plein `bg-success text-success-foreground hover:bg-success/90`
- alerte : `text-warning-text`, `bg-warning/10` (jamais `text-warning` en clair)
- danger CPC (expiré) : `bg-destructive/10 text-destructive-text border-destructive/30` (avant : `bg-destructive text-destructive-foreground`, 3,60 clair avec texte 10 px gras, ce qui n'est pas du gros texte : seuil 4,5)
- neutre CPC : `bg-muted text-foreground border-border` (avant : `text-muted-foreground`, 4,40 clair, sous AA)
- mission/new.tsx : `text-destructive` sur `bg-destructive/10` (statut CPC, deux bandeaux d'erreur) passe à `text-destructive-text` ; le badge « CPC valide » posé sur la carte `bg-muted` (4,47 clair avec `bg-success/10`) devient `border border-success/30 bg-background text-success` (5,60 clair, 10,36 sombre)

## Contrastes WCAG (script `scripts/contrast-semantic-text.mjs`, fond composé sur la surface, seuil 4,5)
Colonnes « avant » = `main` (palettes rose/slate/emerald/amber en dur, hex Tailwind), pas un état intermédiaire de la branche. Fond sombre réel de la carte CPC = slate-900 (`dark:bg-slate-900`, cpc-update-form.tsx:95) ; le clair est blanc (= page).

| Couple | Clair avant | Clair après | Sombre avant | Sombre après |
|---|---|---|---|---|
| badge CPC expiré (rose-700/rose-50 -> destructive-text sur destructive/10) | 5,72 | 8,18 | 9,37 | 8,15 (slate-900) |
| badge CPC neutre (slate-700/slate-100 -> foreground sur muted) | 9,45 | 18,12 | 9,85 | 14,25 |
| badge CPC succès (emerald-700/emerald-50 -> success sur success/10) | 5,21 | 4,85 | 11,09 | 7,77 (slate-900) |
| badge CPC alerte (amber-700/amber-50 -> warning-text sur warning/10) | 4,84 | 7,64 | 11,89 | 7,17 (slate-900) |
| mission L.547 badge CPC valide (emerald-800/emerald-100 sur carte muted -> success sur page) | 6,78 | 5,60 | 9,94 | 10,36 |
| mission : text-destructive sur destructive/10 -> destructive-text | 3,30 | 8,18 | 1,93 | 9,04 |
| bouton plein (texte blanc sur emerald-600 / green-600 -> success-foreground sur success) | 3,77 / 3,30 | 5,60 | non calculé | 10,36 |

Tous les couples employés après modification sont >= 4,5 dans les deux thèmes (test « contraste WCAG des couples employes »). Le couple « success sur success/10 sur carte muted » (4,47 clair) n'est plus employé : le badge L.547 est posé sur le fond page.

## Pourquoi
Les palettes en dur ignorent le mode sombre unifié et le contrat de contraste des jetons.

## Tester
`node node_modules/vitest/vitest.mjs run tests/unit/client/semantic-color-tokens.test.ts` : garde-fous : contraste de tous les couples calculés >= 4,5 (clair et sombre, hors lignes avant/ancien) et aucun `text-destructive` sur une ligne `bg-destructive/10` de cpc-update-form.tsx et missions/new.tsx. Rouges constatés par mutation (cpc-update-form.tsx:85, missions/new.tsx:547, 733, 748 repassées en `text-destructive`), vert après restauration. `node scripts/contrast-semantic-text.mjs` rejoue les ratios.
