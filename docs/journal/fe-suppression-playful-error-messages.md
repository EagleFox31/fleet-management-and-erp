# Suppression de playful-error-messages.tsx (code mort)

## Quoi
`client/src/components/ui/playful-error-messages.tsx` est supprimé (22 lignes avec emoji) et retiré du cliquet emoji.

## Pourquoi
Aucun import dans `client`, `server`, `shared`, `tests` ni `e2e` (recherche `git grep playful`). Le hook `use-animated-error.ts` est, lui, utilisé (login, loading-error, fuel-record-form) et reste à migrer.

## Preuve
`npm run check` zéro erreur TS ; unitaires client 621/621 ; cliquet emoji à jour.
