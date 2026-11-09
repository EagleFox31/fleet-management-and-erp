## 2026-11-05T04:40:00+01:00 — Démo 07 : montant limité à la carte « Encaissé »

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : l'assertion Trésorerie pouvait passer grâce au seul « Poste Carburant ».
- **Comment** : le montant FCFA non nul est cherché uniquement dans la carte « Encaissé (factures clients réglées) ».
- **Comment tester (QA)** : 07 verte sur 2 passages avec rejeu du seed (28,6 s et 39,0 s) ; `npm run check` 0 erreur.
- **RAIDER** : D (assertion qui cible la bonne donnée) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

