## c3f3260 - Facture fournisseur : champs du workflow ignorés, solde initial = TTC (T4)

**Quoi**
- `POST /api/supplier-invoices` : statut, validation, approbation, paiement, solde et écarts envoyés
  par le client sont ignorés (facture toujours `received`, sans validateur ni payeur).
- Montants positifs, plafonnés à 10^12, TTC ≥ HT, arrondis au centime (400 lisible) ; numéro déjà
  saisi 409 ; erreurs par le gestionnaire central.
- Solde initial = TTC. Écran de saisie en single-flight.

**Comment**
- Schéma de route = `insertSupplierInvoiceSchema` moins les champs du workflow ; même exclusion et
  bornes dans `threeWayMatchingService.createSupplierInvoice` (couvre l'import Excel).

**Pourquoi**
- Une secrétaire pouvait créer une facture « payée » ou « approuvée par » un tiers. Un HT négatif
  donnait une facture négative ; un TTC trop faible réécrivait le HT. L'écran n'envoie pas de solde :
  la facture naissait à solde 0 et `/settlements` refusait tout règlement (« solde restant 0 »).

**Preuve**
- Contrat `supplier-invoice-create` 8/8 (8/8 rouges sur l'ancien code) ; `supplier-settlement-idempotence` vert.
- Unitaire 807/807 ; `npm run check` 0 erreur. Base : aucune facture non soldée à solde 0, pas de reprise.

**Reste**
- Import Excel : envoie `totalAmountHT` / `totalAmountTTC` alors que le schéma exige `amountHT` ;
  chaque ligne échoue probablement. À couvrir par un test rouge.

