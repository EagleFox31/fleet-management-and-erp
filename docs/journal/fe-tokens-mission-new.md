# fe : jetons de design, assistant de mission

## Quoi
Blocs « Statut CPC », « Astuce », « Contrôle tonnage » et « Contrôle CPC » de `client/src/pages/missions/new.tsx` : couleurs Tailwind brutes remplacées par les jetons du design system.

## Comment
- Fonds et libellés neutres : `bg-muted`, `text-muted-foreground`.
- Erreur : `bg-destructive/10 text-destructive border-destructive/30`.
- Attention (CPC « A FORMER », astuce) : `bg-warning/10 text-warning`, `border-warning/30`, texte `text-foreground`.
- Succès : aucun jeton `success` n'existe dans `tailwind.config.ts` ni `index.css` ; reprise de la teinte emerald du design system (statut Clôturé) avec variantes sombres.
- Aucun texte, logique ni data-testid modifié.

## Pourquoi
Les couleurs en dur ne suivaient pas le thème sombre de façon cohérente.

## Tester
`tsc --noEmit` sans erreur ; `npm test` vert ; ouvrir /missions/new, étape véhicule/chauffeur, en thème clair puis sombre.

## Pastille « À former » sur le jeton warning-text

La pastille du statut CPC « À former » (étape 3) passe de `text-warning` à `text-warning-text` : `text-warning` sur `bg-warning/10` donnait 1,98:1 en clair, illisible. `--warning-text` (introduit dans la PR du jeton success/warning-text) donne 7,64:1 en clair et 8,20:1 en sombre. L'astuce de l'étape 3 est en `text-foreground` et l'alerte CPC de l assistant en `text-destructive` : rien d'autre à basculer. Cette branche embarque le jeton par fusion de feat/design-token-success.
