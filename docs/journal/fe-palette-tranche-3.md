# Palette, tranche 3 : alert-banner-card, alert-modal, status-metric-strip

## Quoi
Trois primitives du design system passent du rouge, de l'ambre, du vert et de l'émeraude de palette aux jetons destructive, warning et success, et `bg-white` devient `bg-card`. Le cliquet `no-tailwind-palette-in-ui` est abaissé dans le même commit : alert-banner-card 30 -> 10, alert-modal 39 -> 8, status-metric-strip 25 -> 5.

## Comment
- rouge -> destructive / destructive-text ; ambre -> warning / warning-text ; vert et émeraude -> success (le jeton success n'a pas de variante texte, le texte prend `text-success`).
- Fonds en opacité (10 à 20 %), boutons de confirmation `bg-<jeton> hover:bg-<jeton>/90` avec texte blanc conservé, survol des liens par opacité.
- Restent en palette, comme exception documentée (décision 0a, pas de jeton info pour l'instant) : le bleu des trois composants.
- status-badge, multi-domaines (AGENTS.md §1), n'est pas touché : tranche séparée.

## Preuves
- Captures claires avant/après : logistique, magasin, direction, utilisateurs verrouillés. Seule différence visible : l'ambre est plus sobre (fond beige, texte brun plus foncé) ; la structure et le sens sont inchangés.
- Contraste vérifié par `token-pairs-contrast`. Mode sombre non supporté (décision option A) : pas de capture sombre.
