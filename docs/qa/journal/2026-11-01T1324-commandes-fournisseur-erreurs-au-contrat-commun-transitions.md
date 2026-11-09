## b8dbbe1 - Commandes fournisseur : erreurs au contrat commun, transitions en source unique (T3)

**Quoi**
- `/api/purchase-orders` (liste, statistiques, regroupement, optimisation, retards, détail, statut) :
  plus de `details: error.message` ; erreurs au contrat commun `{ message, code, requestId }`.
- Identifiant illisible 400 ; commande inconnue 404 ; transition interdite et clôture sans facture
  payée 409 (avant 400), message en libellés d'écran (« Annulée », « Transmise fournisseur »).

**Comment**
- `AppError` dans `procurementService.updateOrderStatus`, `next(error)` dans les routes,
  `parseIdParam`. `shared/constants/purchase-order-statuses.ts` : statuts, libellés, transitions,
  repris par le service et `client/src/pages/procurement/orders/[id].tsx`. `console.error` migrés.

**Pourquoi**
- Le message technique (dont la transition en codes `cancelled -> sent`) partait dans la réponse ;
  un id non numérique finissait en 500.

**Preuve**
- Contrat `purchase-order-status-errors` 7/7 (4 rouges sur l'ancien code) ; `purchase-order-amounts` vert.
- Unitaire 812/812 (5 nouveaux sur la table de transitions) ; `npm run check` 0 erreur.

**Reste**
- Écran : passer de 400 à 409 est sans effet (il affiche `userMessageOf`). T3 sur `server/routes.ts`.

