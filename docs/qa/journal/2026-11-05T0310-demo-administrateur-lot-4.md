## 2026-11-05T03:10:00+01:00 — Démo administrateur (lot 4)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : l'administrateur ouvre Administration, Utilisateurs, modifie le compte « recrue1 » (magasinier) et lui donne le rôle de technicien.
- **Comment** : `e2e/demo/09-admin.spec.ts` ; seed : comptes admin1 et recrue1 (le rôle de départ est rétabli à chaque seed par `ensureUser`).
- **Comment tester (QA)** : seed puis spec, 2 passages verts (36,5 s et 42,5 s).
- **RAIDER** : I (rôle rétabli au rejeu) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

