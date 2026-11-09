## 6b066f0 - Import Excel factures fournisseur : lignes du modèle acceptées, erreurs lisibles (T4)

**Quoi**
- `POST /api/supplier-invoices/import` : chaque ligne passe par la même saisie que `POST /`
  (champs du workflow ignorés, statut `received`, solde initial = TTC).
- Dates JJ/MM/AAAA strictes (31/02 refusé) ; `N° Commande` rattaché à la commande, refusé si
  inconnu ou d'un autre fournisseur (avant : ignoré sans rien dire).
- Message par ligne rédigé pour l'utilisateur ; erreur imprévue journalisée, ligne avec référence.
  Fichier refusé ou illisible : 400 au contrat commun. Un événement `supplier_invoice_created` par facture.

**Comment**
- `createSupplierInvoiceSchema` réutilisé, `ImportRowError` pour les refus de ligne, commandes lues
  en une requête (`inArray`), `AppError` + `next(error)` pour le fichier.

**Pourquoi**
- L'import envoyait `totalAmountHT` alors que le schéma exige `amountHT` : toute ligne du modèle
  échouait, avec le JSON Zod brut affiché à l'écran.

**Preuve**
- Contrat `supplier-invoice-import` 12/12 (rouge sur l'ancien code : ligne du modèle, montants
  numériques, dates) ; `supplier-invoice-create` et `supplier-settlement-idempotence` verts.
- Unitaire 807/807 ; `npm run check` 0 erreur.

**Reste**
- T3 : `PATCH /api/purchase-orders/:id/status` renvoie encore `details: error.message` en 500.

