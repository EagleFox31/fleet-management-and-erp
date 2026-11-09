## 2026-11-05T01:26:11+01:00 — Démo magasinier (lot 3)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-3` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : réception d'une commande fournisseur confirmée (code de livraison), entrée en stock, puis sortie de la pièce depuis l'onglet Pièces de l'OT en attente.
- **Comment** : `e2e/demo/06-magasinier.spec.ts` ; seed : fournisseur, commande DEMO-BC-001, OT en attente de pièces et sa demande liée ; purge des factures fournisseur générées par la réception. Ouverture de la commande par le bouton œil de la ligne (le numéro n'est pas un lien).
- **Comment tester (QA)** : seed puis `E2E_DEMO=1 E2E_RECORD=1` sur la spec, base locale fleet_test ; attendu 1 passed, 2 passages (verts, 16 à 17 s).
- **RAIDER** : I (purge et recréation à chaque seed), E (garde de base) ; ne s'applique pas : code produit.
- **Reste / risques** : le magasinier n'a pas de lien vers les ordres de travail : accès par la carte « en attente de pièces » de Demandes de pièces, repli par URL directe si elle est absente.

