# Journal — c7, métier argent (carburant, carte, prix)

Entrées ajoutées en bas, une par commit (règles : `docs/journal/README.md`).

## 2026-11-03T18:12:24+01:00 — Check-list de lancement : colonnes miroir de vehicles

- **Agent** : c7 · **Branche** : `fix/readiness-mirror-columns` · **Commit** : voir `git log` de la branche
- **Statut** : fait, en relecture
- **Quoi** : `GET /api/missions/:id/launch-readiness` applique aussi `getMissionEligibility` aux colonnes `vehicles.insuranceExpiry`, `technicalInspectionDate` et `licensePlateExpiry` (récépissés compris), comme le lancement. Un motif fait tomber l'item du papier concerné, avec le libellé de la règle partagée.
- **Comment** : aucune clé nouvelle dans `checks[]`. Le cast de la carte grise est remplacé par un filtre typé.
- **Pourquoi** : la check-list annonçait « prêt » un véhicule que le lancement refusait.
- **Comment tester** : un véhicule aux papiers valides dont la fiche porte une assurance échue → item « Assurance conforme » rouge, lancement refusé. Ajouter un récépissé d'assurance valable → item vert.
- **Preuve automatisée** : `mission-renewal-receipt.contract.test.ts`, bloc « colonnes miroir » de 3 cas. Mutant : 2 rouges (le cas du récépissé passe avec ou sans la règle).
- **RAIDER** :
  - R : règle unique réutilisée ;
  - D : contrat `checks[]` inchangé.
