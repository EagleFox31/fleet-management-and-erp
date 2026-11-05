# Vert primary à 31 % et jeton primary-text

## Quoi
`--primary` passe à 142 69% 31 % (clair et sombre). Nouveau jeton `--primary-text` (clair 24 %, sombre 55 %) pour le texte posé sur une teinte ou sur la page, sur le modèle de `destructive-text`. Le `text-primary` nu est interdit par test.

## Comment
Jeton dans `client/src/index.css`, mappé dans `tailwind.config.ts` (`primary.text`). Couples ajoutés à `scripts/contrast-semantic-text.mjs`. Garde-fou par bloc de classes (`cn(`, `className`), multi-lignes et branches de ternaire séparées, liste gelée par `fichier:ligne` (vide), jetons popover inclus.

## Pourquoi
Le blanc sur le vert plein était à 3,59 : sous le seuil WCAG 4,5 (décision de l'utilisatrice : option A).

| Couple | Avant | Après (clair / sombre) |
|---|---|---|
| primary-foreground sur primary | 3,59 | 4,66 / 4,66 |
| primary-text sur primary/20 | - | 5,31 / 9,28 |
| primary-text sur primary/10 | - | 6,09 / 10,29 |
| primary-text sur la page | - | 6,93 / 11,03 |

## Preuve
Remettre `--primary` à 36 % fait échouer deux tests (vérifié). `npm run check` : zéro erreur TS ; unitaires clients 611/611.
