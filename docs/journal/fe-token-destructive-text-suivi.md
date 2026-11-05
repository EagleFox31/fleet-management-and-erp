# Jeton --destructive-text : suite sur vehicle-documents

## Quoi
`client/src/components/vehicles/vehicle-documents.tsx:621` (bandeau d'erreur de chargement des documents) : `text-destructive` remplacé par `text-destructive-text` sur `bg-destructive/10`. C'est le seul couple de `client/src/components/vehicles/` ; `missions/new.tsx` est traité dans #396.

## Comment
Mesure par `node scripts/contrast-semantic-text.mjs` (le script couvre déjà ce couple : texte sur `destructive/10` composé sur la page, aucune extension nécessaire).

| Thème | text-destructive avant | text-destructive-text après |
|---|---|---|
| Clair | 3,30 | 8,18 |
| Sombre | 1,93 | 9,04 |

Test : `tests/unit/client/destructive-text-token.test.ts`, cas ajouté pour vehicle-documents. Rouge prouvé sur l'ancien code (1 échec / 5), vert après (5/5).

## Pourquoi
Le texte rouge sur fond teinté était sous AA (4,5) dans les deux thèmes. Même démarche que #397.

## Comment tester
`node node_modules/typescript/bin/tsc --noEmit -p .` ; `node node_modules/vitest/vitest.mjs run --reporter=dot` ; provoquer une erreur de chargement des documents d'un véhicule, en clair puis sombre.
