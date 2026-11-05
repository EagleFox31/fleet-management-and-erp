# Palette, tranche 1 : primitives du design system

## Quoi
Six primitives migrent des classes de palette Tailwind vers les jetons : card-shell, header-card, kpi-tile, premium-data-table, premium-table-shell, premium-tabs-nav. Le cliquet `no-tailwind-palette-in-ui` est abaissé dans le même commit (card-shell, header-card, premium-data-table, premium-table-shell, premium-tabs-nav sortent de la liste ; kpi-tile passe de 8 à 2).

## Comment
Correspondance sans changement de sens : bg-white -> bg-card, gris -> jetons muted / border, vert de marque -> primary / primary-text. Le contraste reste couvert par `token-pairs-contrast`.

## Pourquoi
Ces six composants sont consommés par la plupart des écrans (tableau de bord, inventaire, achats, factures). Les migrer en premier réduit la dette là où elle se propage.

## Preuves
- Captures claires avant/après : tableau de bord, pièces, achats, factures. Seule différence visible : la teinte de la carte héros verte, qui suit désormais le jeton primaire.
- Mutation : `text-green-600` réintroduit dans card-shell -> le cliquet passe au rouge ; le fichier restauré repasse au vert.
- `npm run check` : 0 error TS. `npm test` : un seul échec, un timeout de 30 s sur `deploy/backup-db.sh` sous charge ; le fichier seul passe (4/4).
