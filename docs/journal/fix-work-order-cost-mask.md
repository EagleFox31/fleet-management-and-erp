# Journal — fix-work-order-cost-mask

Branche : `fix/work-order-cost-mask`. Modèle d'entrée : `README.md`.

## 2026-11-05 — Masquage des coûts d'OT hors rôles coût

- **Quoi** : dans les lectures `GET /api/work-orders/*`, les clés `cost`, `unitPrice` et `totalCost` sont retirées de la réponse pour les rôles hors `WORK_ORDER_COST_READ_ROLES` (chauffeur, client). La réponse reste en 200 : le chauffeur et le client gardent l'accès à l'OT, sans les montants.
- **Comment** : `server/lib/work-order-cost-mask.ts` (copie récursive sans les trois clés, liste fermée ; Date et instances intactes) et middleware `workOrderCostMask` monté dans `server/api/index.ts` sur `/work-orders`, juste après `sessionMiddleware`, pour couvrir aussi l'historique véhicule monté plus tôt. Il enveloppe `res.json` sur les GET et lit le rôle à l'envoi (`req.user`, ou relecture du compte quand la garde est `authenticate` seul ; erreur ou compte absent : on masque). `routes.ts` n'est pas touché (dette gelée). Inscription au garde-fou des middlewares montés sur préfixe.
- **Écran** : `client/src/pages/maintenance/work-orders/[id].tsx` masque, pour les rôles non coût, la carte « Coût total », les colonnes prix et total des pièces, « Total pièces », les montants de la liste des pièces utilisées, le récapitulatif des coûts et les coûts du PDF (`canReadWorkOrderCost`), pour ne pas afficher 0 FCFA.
- **Preuves** : unitaire du helper (objets imbriqués, tableaux, null, Date, clés voisines) ; contrat par route (liste, détail, pièces posées, historique véhicule, en attente de pièces) : rôle coût voit la sentinelle, chauffeur et client en 200 sans clé ni montant sur le corps entier. Mutants : démontage du middleware (9 échecs) ; suppression de la relecture du compte (liste en échec).
- **Hors périmètre** : `estimatedCost` des demandes de pièce, OT embarqués dans d'autres réponses (détail véhicule, maintenance), coûts de rotation de pneus.
