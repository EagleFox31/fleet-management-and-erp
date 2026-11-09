## 2026-11-05T01:41:28+01:00 — Démo magasinier : ouverture par le lien du numéro (suite de #332)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-3` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : la spec 06 ouvre la commande par le lien du numéro (ligne cliquable depuis #332) ; toast asserté en exact (garde toast-title-exact-hygiene) ; README : parcours du magasinier.
- **Comment tester (QA)** : seed puis spec, 2 passages verts (16,8 s et 17,1 s) ; `npm run check` 0 erreur ; unitaires 202 fichiers / 2335 tests verts.
- **RAIDER** : D (garde d'hygiène des e2e respectée) ; ne s'applique pas : code produit.
- **Reste / risques** : spec 07 direction en cours de mise au point (tableau de bord et rapports via onglets).

