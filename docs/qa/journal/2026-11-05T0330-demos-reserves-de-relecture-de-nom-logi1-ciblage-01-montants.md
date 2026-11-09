## 2026-11-05T03:30:00+01:00 — Démos : réserves de relecture de #344 (nom logi1, ciblage 01, montants 07, dates locales)

- **Agent** : b7 (fleet-testeur) · **Branche** : `feat/e2e-demo-profils-4` · **Commit** : voir `git log`
- **Statut** : fait
- **Quoi** : quatre réserves de relecture levées sur le seed et les specs de démo.
- **Comment** : seed : `logi1` redevient « Jean Tchoumi » (plus de doublon de nom avec `demotech2`) ; `isoDayFromNow` et les dates « aujourd'hui / échéance » passent en jour calendaire local au lieu d'UTC. 01 : le bouton Commencer est celui de la carte qui porte le titre de l'OT de démo. 07 : montants exacts remplacés par des assertions non nulles, la base de test étant partagée.
- **Comment tester (QA)** : `npm run check` 0 erreur ; unitaires 210 fichiers / 2432 tests ; rejeu e2e/demo 01 à 10, 2 passages (résultats dans le rapport de PR).
- **RAIDER** : I (seed rejouable) ; D (assertions indépendantes des autres données) ; ne s'applique pas : code produit.
- **Reste / risques** : aucun.

