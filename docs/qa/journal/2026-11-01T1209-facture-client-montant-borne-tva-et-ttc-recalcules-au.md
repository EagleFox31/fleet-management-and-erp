## 0c4941b - Facture client : montant borné, TVA et TTC recalculés au centime (T4)

**Quoi**
- `POST /api/billing/invoices/generate` : mission, montant (> 0, plafonné à 10^12 HT) et échéance
  (AAAA-MM-JJ) validés (400 lisible). TTC, solde, TVA, statut et auteur envoyés par le client sont ignorés.
- Mission inconnue 404 ; mission sans client 409 ; numéro de facture déjà pris 409.
- Écran mission : « Générer Facture » en single-flight, un double clic ne crée plus deux factures.

**Comment**
- Schéma Zod dans la route, erreurs par le gestionnaire central (`next(error)`), `AppError` dans
  `clientBillingService.generateInvoiceFromMission` ; HT et TVA arrondis au centime, TTC = HT + TVA.

**Pourquoi**
- Un montant de -5000 créait une facture négative ; une échéance ou un id invalide, une mission
  inconnue ou un numéro en double renvoyaient un 500 avec le message technique brut.

**Preuve**
- Contrat `client-invoice-generate` 11/11 (7 rouges avant le correctif) ; `client-payment-idempotence` 7/7.
- Unitaire 807/807 ; `npm run check` 0 erreur.

**Reste**
- Plusieurs factures par mission restent permises (onglet Factures de la mission) : pas de 409 par mission.
- Factures fournisseur à vérifier (T4).

