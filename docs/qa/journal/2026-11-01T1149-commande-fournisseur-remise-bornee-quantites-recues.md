## bcd695a - Commande fournisseur : remise bornée, quantités reçues contrôlées (T4)

**Quoi**
- `POST /api/purchase-orders` : remise hors de 0..100 refusée (400). Un total envoyé par le client
  reste ignoré, HT, remise, TVA et TTC sont recalculés.
- `PATCH /api/purchase-orders/:id/lines/:lineId` : quantités entières et positives ; quantité reçue
  plafonnée au commandé (400), jamais en baisse (409, la correction passe par un ajustement de
  stock) ; acceptées + refusées ≤ reçues (400) ; une ligne d'une autre commande est introuvable (404).
- Deux réceptions simultanées de la même ligne ne créditent le stock qu'une fois.
- Les deux routes renvoient leurs erreurs par le gestionnaire central (plus de `details: error.message`).

**Comment**
- Bornes Zod dans la route ; règles métier dans `procurementService.updateOrderLine` (`AppError`).
- Écriture de la ligne conditionnée à la quantité reçue lue (verrou optimiste) ; crédit de stock de
  `registerPartReception` en incrément SQL atomique, aussi utilisé par la livraison de commande.

**Pourquoi**
- Une remise de 150 % donnait un total négatif. Une quantité reçue de -100 puis de 5 créditait 105
  pièces, et la livraison suivante (« commandé - déjà reçu ») recréditait encore l'écart. La lecture
  puis réécriture du stock perdait une réception en cas d'appels simultanés.

**Preuve**
- Contrat `purchase-order-amounts` 8/8 (6 rouges avant le correctif). `error-contract-and-issue-idempotence`,
  `part-requirements-chain`, `api-role-guard-and-validation` verts (un dépassement de délai Neon sur un
  test d'OT, vert au rejeu).
- Unitaire 807/807 ; `npm run check` 0 erreur.

**Reste**
- Carburant : le coût saisi est celui du ticket, pas un montant serveur ; écart au prix de référence
  à traiter comme anomalie, pas en T4. Factures client et fournisseur à vérifier.

