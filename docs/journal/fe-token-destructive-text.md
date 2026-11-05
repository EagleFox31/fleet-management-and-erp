# Jeton --destructive-text (fix/token-destructive-text)

## Quoi
- `client/src/index.css` : `--destructive-text` ajouté, clair `0 72% 32%`, sombre `0 86% 78%` (une seule variante de sélecteur sombre existe dans ce fichier : `.dark`).
- `tailwind.config.ts` : `destructive.text` -> classe `text-destructive-text`.
- `client/src/pages/missions/new.tsx` : les deux cartes d'incompatibilité (contrôle tonnage, contrôle CPC) passent de `text-destructive` à `text-destructive-text`. Aucune autre ligne, aucun reformatage.
- `scripts/contrast-semantic-text.mjs` : calcul WCAG reproductible, lit les valeurs dans `index.css`. Test : `tests/unit/client/destructive-text-token.test.ts`.

## Comment (ratios, fond composé = couleur à 10 % sur `--background`)
| Thème | text-destructive avant | text-destructive-text | warning-text (référence) |
|---|---|---|---|
| Clair | 3,30 | 8,18 (9,31 sur fond de page) | 7,64 |
| Sombre | 1,93 | 9,04 (9,30 sur fond de page) | 8,20 |
Reproduire : `node scripts/contrast-semantic-text.mjs`. Cible AA (>= 4,5) et >= warning-text : atteinte dans les deux thèmes.

## Pourquoi
`text-destructive` sur `bg-destructive/10` était sous AA (3,30 clair, 1,93 sombre). Même démarche que `--warning-text` (#372).

## Suivi (non modifié) : `text-destructive` sur `bg-destructive/10`
- `client/src/components/vehicles/vehicle-documents.tsx:621`
- `client/src/pages/missions/new.tsx:547`, `:733`, `:748` (hors cartes d'incompatibilité, laissés pour limiter les conflits avec #396)

## Comment tester
`node node_modules/typescript/bin/tsc --noEmit -p .` ; `node node_modules/vitest/vitest.mjs run --reporter=dot` ; ouvrir /missions/new avec un cargo plus lourd que le tonnage, en clair puis sombre. Rouge prouvé : test 4/4 en échec sur l'ancien code.
