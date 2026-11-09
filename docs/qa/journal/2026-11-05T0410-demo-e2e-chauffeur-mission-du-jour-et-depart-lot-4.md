## 2026-11-05T04:10:00+01:00 — Démo e2e chauffeur : mission du jour et départ (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : dixième profil de démo, le chauffeur voit sa mission du jour sur son tableau de bord et confirme le départ (statut en cours en base).
- **Comment** : `seedDriverDay` (compte chauffeur1 relié à une fiche chauffeur, véhicule aux papiers valides, mission affectée avec budgets carburant, FDR et imprévus) ; helper `ensureValidPapers` extrait du seed logistique ; spec `10-chauffeur.spec.ts`. Le départ est refusé sans budgets renseignés (constaté au premier essai, 400), le seed les pose.
- **Comment tester (QA)** : `E2E_DEMO=1 ... test e2e/demo/10-chauffeur.spec.ts`, 2 passages verts avec rejeu du seed (13 s de vidéo) ; 04 reste verte.
- **RAIDER** : I (mission purgée puis recréée) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

