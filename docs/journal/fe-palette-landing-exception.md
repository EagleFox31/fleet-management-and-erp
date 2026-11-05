# Palette : landing.tsx reste gelee (exception documentee)

## Quoi
`client/src/pages/landing.tsx` (cliquet a 258) n'est pas migree vers les jetons.

## Pourquoi
La landing est posee sur un fond sombre fixe (slate-950). Les jetons success/warning/destructive sont calibres pour la surface claire. Mesure (scripts/contrast-semantic-text.mjs, hsl vers rgb, ratio WCAG) sur slate-950 :
- emerald-400 actuel : 10,49:1
- text-success : 3,61:1 (sous 4,5)
- text-warning-text : 2,45:1
- text-destructive-text : 2,17:1
Migrer ferait passer le texte vert de 10,5 a 3,6 : regression de lisibilite, sans gain de coherence. `bg-white` du bouton CTA sur fond sombre n'a pas non plus de sens en `bg-card`.

## Condition pour migrer
Introduire des jetons "sur fond sombre" (ex. success-on-dark) puis migrer avec capture dediee. Decision de design, hors lot palette actuel. Meme logique que l'en-tete chauffeur (#0b2116).
