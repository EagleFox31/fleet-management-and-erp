# Palette : cinq pages (atelier, chauffeur, facture fournisseur, renouvellement, utilisateurs)

## Quoi
Cliquet abaisse dans le meme commit : admin/users 74 -> 15, driver/dashboard 107 -> 26, procurement/invoices/[id] 131 -> 49, vehicles/document-renew 94 -> 24, workshop-manager/dashboard 126 -> 41. Reste = blue, orange, yellow, purple, cyan (exceptions categorielles) et l'en-tete chauffeur.

## Comment
Memes jetons que les tranches precedentes. Ajouts : focus:border/ring en jeton, `dark:` equivalents en jeton (le mode sombre n'est pas supporte, ils restent sans effet), degrades from/to en jeton. Corrige au passage une erreur du script (suffixe d'opacite d'origine laisse apres la bordure, `border-warning/30/60`) avant commit ; le test de contraste a aussi refuse `text-success` sur `bg-success/20`, remplace par `/10`.
Exception documentee : l'en-tete du tableau de bord chauffeur est sur fond fixe sombre (#0b2116) ; ses trois accents vert clair (icone, libelle, deconnexion) restent en palette, le jeton success etant trop sombre sur ce fond.

## Pourquoi
Un seul point de verite pour les couleurs semantiques.
