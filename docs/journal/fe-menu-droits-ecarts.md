# Menu : ecarts 2, 6 et 8 de la carte des droits

## Quoi
- Ecart 2 : "Missions transport" ajoute aux menus ADM et SEC (l'API laisse ADM, SEC, LOG ecrire des missions).
- Ecart 8 : DIR gagne "Ressources Vehicules" (Vehicules, Carburant) ; MAG gagne "Analyse > Rapports" (rapport d'inventaire, filtre par `canReadInventoryReport` dans la page).
- Ecart 6 (chauffeurs) : aucun changement. Le menu "Chauffeurs" est deja sur ADM, SEC, LOG, comme l'ecran. Elargir le menu a tout le personnel (droit API) exigerait d'ouvrir la route (App.tsx, hors perimetre de ce lot, traite par une autre session) ; un menu plus large que l'ecran serait un lien mort.

## Regle
Le menu suit le droit de l'API, jamais plus large. Garde : `tests/unit/client/sidebar-menu-droits.test.ts` (rouge vu en retirant Missions du menu admin).

## Non traite
DIR n'a pas "Rapports" (/reports) : il a deja "Rapports Direction" ; a confirmer avec le metier.
