# Cliquet palette Tailwind et surfaces en dur

## Quoi
`tests/unit/client/no-tailwind-palette-in-ui.test.ts` fige, par fichier, le nombre de classes de la palette (red, green, amber, blue, purple... en `text|bg|border|ring|fill|stroke|from|via|to|divide|outline|decoration|shadow`, avec variantes `dark:`/`hover:`) et de `bg-white` / `text-black` dans `client/src` : 191 fichiers, 6306 occurrences. Exclus : gris neutres, `text-white`, `bg-black`.

## Pourquoi
Les jetons portent le contraste verifie. Sans cliquet, chaque ecran ajoute de la palette. Les tranches suivantes (15 fichiers max, captures clair) abaissent la liste dans le meme commit.

## Mode sombre
Non supporte (ni provider ni bascule) ; note ajoutee a `.claude/design-system.md`. Decision produit remontee par l'orchestrateur.

## Preuve
Classe `text-red-600` ajoutee dans `lib/utils.ts` : 2 tests rouges ; `text-green-600` retire de `header-card.tsx` : test rouge (compte baisse) ; fichiers restaures.
