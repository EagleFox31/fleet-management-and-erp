# Palette : detail de mission

## Quoi
`pages/missions/[id].tsx` : 241 -> 39 occurrences au cliquet (reste = blue, orange, yellow, purple, exceptions categorielles documentees). Cliquet abaisse dans le meme commit.

## Comment
Jetons existants, memes regles que les tranches precedentes : vert/emeraude -> success, ambre -> warning(-text), rouge -> destructive(-text), bg-white -> bg-card, boutons pleins avec survol `brightness-90`, degrades from/to en jeton. Capture avant/apres (theme clair) : le vert devient celui du jeton `success`, plus fonce ; aucune mise en page deplacee.

## Pourquoi
Un seul point de verite pour les couleurs semantiques et un contraste verifie par les tests de jetons.
