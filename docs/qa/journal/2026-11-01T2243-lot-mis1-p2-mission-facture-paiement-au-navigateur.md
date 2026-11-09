## Lot MIS1 + P2 - Mission, facture, paiement au navigateur

**Quoi**
- `e2e/13-mission-invoice-payment.spec.ts` : la logistique crée une mission (API), la facture depuis
  l'écran mission (HT 100 000, TTC 119 250), la secrétaire encaisse en deux fois ; facture soldée, bouton
  de paiement absent, bouton désactivé pour la logistique. Vérité lue en base ; mission, facture, comptes
  et client supprimés en fin de spec.

**Comment**
- Comptes créés par `createE2EUser`, serveur et runner sur `DATABASE_URL_TEST` (branche tests-piste-b),
  sous verrou, Edge (`E2E_CHANNEL=msedge`).

**Pourquoi**
- `05-mission-billing-payment` lisait la première facture trouvée et skippait sur base vide.

**Preuve**
- Spec 13 : 1/1 vert (2,5 min). Pas de défaut produit visé : pas de rouge avant, le test est une
  couverture de parcours.

**Limites**
- Mission posée à « livrée » en base : affectation, étapes et lancement non rejoués (documents du
  véhicule et CPC requis).

