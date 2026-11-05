# Palette, tranche 2 : icon-square, deadline-tile, urgency-badge

## Quoi
Trois primitives du design system passent du vert, de l'ambre et du rouge de palette aux jetons primary, warning et destructive (avec leurs variantes -text). Le cliquet `no-tailwind-palette-in-ui` est abaissé dans le même commit : deadline-tile sort de la liste, icon-square 12 -> 3, urgency-badge 9 -> 6.

## Comment
- vert -> primary / primary-text ; ambre -> warning / warning-text ; rouge -> destructive / destructive-text, fonds en opacité (10 à 20 %).
- Le vert « succès » de deadline-tile prend le jeton success.
- Restent en palette, faute de jeton équivalent : le bleu d'icon-square (info), l'orange et le jaune d'urgency-badge (urgences haute et moyenne). Les fusionner dans warning aurait effacé la distinction entre les deux niveaux.

## Preuves
- Captures claires avant/après (tableau de bord, pièces, alertes, achats) : seule différence visible, le vert de l'icône du bandeau, plus sobre.
- Contraste vérifié par `token-pairs-contrast` (629 tests client verts).
- Mode sombre non supporté (décision option A) : pas de capture sombre.
