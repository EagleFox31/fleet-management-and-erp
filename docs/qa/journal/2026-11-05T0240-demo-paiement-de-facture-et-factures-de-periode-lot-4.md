## 2026-11-05T02:40:00+01:00 — Démo paiement de facture et factures de période (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : démo « paiement de facture » (secrétaire : acompte puis solde) ; deux factures de période au seed, qui alimentent les rapports de direction (715 500 FCFA encaissés, 1 192 500 FCFA de créances), avec assertion dure dans la spec direction.
- **Comment** : `seedClientInvoices` purge `DEMO-FAC-%` (paiements en cascade) puis recrée ; `e2e/demo/08-paiement-facture.spec.ts` ; `07-direction.spec.ts`.
- **Comment tester (QA)** : seed puis specs 07 et 08, 2 passages verts chacune avec rejeu du seed.
- **RAIDER** : I (purge et recréation, sans doublon) ; ne s'applique pas : code produit.
- **Reste / risques** : audit flotte et TCO à 0 (aucune mission terminée au seed).

