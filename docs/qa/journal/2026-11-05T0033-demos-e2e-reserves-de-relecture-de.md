## 2026-11-05T00:33:32+01:00 — Démos e2e : réserves de relecture de #324

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : garde de base durcie (URL analysée : hôte local et chemin exactement `/fleet_test`), appelée dans chaque spec ; seed qui réconcilie rôle, mot de passe et propriétaire ; demandes de renouvellement de la démo purgées ; README sans `--env-file=.env` seul. Correction de l'entrée précédente : le seed est rejouable sans doublon en base, mais le justificatif téléversé reste dans `uploads/`.
- **Comment tester (QA)** : `DATABASE_URL` vers une autre base : le seed et les specs échouent ; sinon 3 specs vertes.
- **RAIDER** : I et E (garde stricte, réconciliation) ; ne s'applique pas : code produit.
- **Reste / risques** : fichier de justificatif dans `uploads/`.

