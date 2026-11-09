## 2026-11-05T00:24:24+01:00 — Démos e2e par profil (technicien, secrétariat, client)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : trois parcours filmés, un par profil, hors suite e2e par défaut : technicien (demande de pièce puis clôture de l'OT), secrétariat (renouvellement d'une assurance avec justificatif), client (ses véhicules, preuve de cloison 403).
- **Comment** : `e2e/demo/` (seed idempotent gardé sur fleet_test en local, helpers, 3 specs, README) ; `playwright.config.ts` ignore `e2e/demo/` sauf `E2E_DEMO=1`. Build : comptes et données par upsert sur clés naturelles (recette-seed non réutilisé, garde d'environnement incompatible).
- **Pourquoi** : démonstration par profil ; ne remplace aucun test.
- **Comment tester (QA)** : seed puis `E2E_DEMO=1 E2E_RECORD=1 node --env-file=.env node_modules/@playwright/test/cli.js test e2e/demo/<spec> --reporter=list` sur base locale ; attendu : 1 passed, 2 passages consécutifs.
- **RAIDER** : I (seed rejouable), D (suite par défaut inchangée), E (refus hors base locale) ; ne s'applique pas : code produit.
- **Reste / risques** : dialogue de renouvellement rapide de `vehicle-documents.tsx` inatteignable (code mort, le bouton mène à la page de renouvellement).

