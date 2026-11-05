# Palette : detail d'ordre de travail

## Quoi
`pages/maintenance/work-orders/[id].tsx` : 212 -> 64 au cliquet, abaisse dans le meme commit. Reste = blue (exception categorielle).

## Comment
Jetons existants (success, warning-text, destructive-text, card). Equivalents `dark:` en jeton (mode sombre non supporte), titres `text-green-950` -> `text-foreground`. Controle : aucune classe a opacite double (`/30/60`) dans client/src.

## Pourquoi
Un seul point de verite pour les couleurs semantiques ; contraste verifie par les tests de jetons.
