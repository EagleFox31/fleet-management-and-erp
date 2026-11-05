# Palette : commandes fournisseur (nouvelle, detail) et liste des chauffeurs

## Quoi
Cliquet abaisse dans le meme commit : drivers/index 80 -> 27, procurement/orders/[id] 97 -> 43, procurement/orders/new 89 -> 33. Reste = blue, orange, yellow, purple (exceptions categorielles).

## Comment
Meme script de migration que les tranches precedentes (green/emerald -> success, amber -> warning, red -> destructive, bg-white -> bg-card). Aucun libelle touche. `components/**` non touche. Controle grep : aucune classe a opacite double.

## Pourquoi
Un seul point de verite pour les couleurs semantiques.

## Captures (theme clair, 1280x800, avant/apres)
Detail de commande (statut, montants, badges, carte total TTC), nouvelle commande, liste des chauffeurs. Rendu equivalent : memes teintes, vert un peu plus sobre sur les badges (success/15 au lieu de green-100), aucun libelle ni montant modifie.
