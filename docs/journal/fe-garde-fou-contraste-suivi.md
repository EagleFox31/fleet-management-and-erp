# Garde-fou de contraste : suivi des réserves de #416

## Quoi
Le test `token-pairs-contrast.test.ts` est restructuré autour d'une fonction pure `analyse(source)`.
- La ligne signalée est celle de la classe `text-*` fautive, plus le début du bloc.
- `cva(` : la base plus une valeur de chaque axe de `variants` (produit croisé, jamais deux valeurs du même axe) ; les classes de `compoundVariants` sont ajoutées à ces combinaisons.
- Ternaire : base contre chaque branche, couvert par le test du détecteur.
- `classNames={{ }}` : chaque clé séparément.

## Pourquoi
Réserves non bloquantes de la relecture de #416 : un axe croisé ou un `compoundVariants` pouvait cacher une paire sous 4,5.

## Preuve
Mutations vues rouges : badge neutre remis à `bg-secondary/10 text-secondary` (signalé `badge.tsx:24`), compoundVariants fautif, ternaire fautif. Aucune nouvelle paire fautive dans `client/src` (test vert sur le code existant).
