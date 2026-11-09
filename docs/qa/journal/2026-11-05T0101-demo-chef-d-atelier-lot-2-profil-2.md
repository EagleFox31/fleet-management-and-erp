## 2026-11-05T01:01:55+01:00 — Démo chef d'atelier (lot 2, profil 2)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-2` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : création d'un OT par l'assistant, assignation à un technicien depuis la liste, démarrage et clôture depuis le détail.
- **Comment** : `e2e/demo/05-chef-atelier.spec.ts` ; seed : véhicule DEMO-CHEF-001, OT de démo purgés à chaque lancement ; mot de passe de terry aligné sur le défaut e2e (workshop123, exigé par le préflight des comptes).
- **Comment tester (QA)** : seed puis `E2E_DEMO=1 E2E_RECORD=1` sur la spec, base locale ; attendu 1 passed, 2 passages.
- **RAIDER** : I (purge), E (garde de base) ; ne s'applique pas : code produit.
- **Reste / risques** : l'assignation ne démarre pas l'OT (il reste « En attente » et seul « Voir OT » reste dans la liste) ; démarrage par le détail uniquement.

