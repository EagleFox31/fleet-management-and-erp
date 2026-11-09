## Lot C stock et achats : une lecture en échec n'est plus un zéro ni une liste vide

**Quoi** : huit écrans de stock et d'achat retombaient sur `= []` ou `?? 0` quand une lecture échouait. Ils affichaient alors « 0 en rupture », « Aucune commande trouvée », « Aucune suggestion », « Pièce non utilisée » ou « 0 / jour » comme s'il s'agissait de vraies valeurs. Écrans concernés : accueil stock (tuile rupture, catalogue `part-table`), rapports (KPI stock), commandes (liste, statistiques, compteur), regroupement, nouvelle commande (suggestions), demandes (OT en attente de pièces), fiche pièce (consommation, autonomie, utilisations, OT).
**Comment** : chaque lecture passe par `queryView` / `listQueryView` + `readyData`. En échec, la tuile affiche `UNAVAILABLE` et la liste un `InlineQueryError` avec « Réessayer », et le compteur est masqué. La préremplissage de remise de la nouvelle commande ne part que sur des suggestions lues.
**Pourquoi** : depuis que le serveur répond 500 au lieu de `[]`, le client doit distinguer « vide » d'« illisible ». Sinon un magasinier commande à tort, ou ne commande pas.
**Preuve** :
- `tests/unit/client/money-stock-reads-error-states.test.ts`, garde étendue à 3 nouveaux écrans et à 5 nouvelles lectures : 8 rouges sur l'ancien code, 52/52 verts.
- `tests/unit/client/stock-procurement-render-error-states.test.ts`, rendu : 4 rouges sur l'ancien code (2 témoins verts), 6/6 verts.
- `tests/unit/client` : 1005/1005 verts.
- `tsc` : 0 erreur.
