# Palette : commandes fournisseur (nouvelle, detail) et liste des chauffeurs

## Quoi
Cliquet abaisse dans le meme commit : drivers/index 80 -> 27, procurement/orders/[id] 97 -> 43, procurement/orders/new 89 -> 33. Reste = blue, orange, yellow, purple (exceptions categorielles).

## Comment
Meme script de migration que les tranches precedentes (green/emerald -> success, amber -> warning, red -> destructive, bg-white -> bg-card). Aucun libelle touche. `components/**` non touche. Controle grep : aucune classe a opacite double.

## Pourquoi
Un seul point de verite pour les couleurs semantiques.
