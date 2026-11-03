# Journal — c7, métier argent (carburant, carte, prix)

Entrées ajoutées en bas, une par commit (règles : `docs/journal/README.md`).

## 2026-11-03T18:01:40+01:00 — #205 — Plein débité de la carte : montants figés au PATCH

- **Agent** : c7 · **Branche** : `fix/fuel-record-ledger-lock` · **Commit** : voir `git log` de la branche
- **Statut** : fait, en relecture
- **Quoi** : `PATCH /api/fuel-records/:id` renvoie 409 quand un plein qui a mouvementé la carte (`debitAmount` ou `creditAmount` non nul) changerait de quantité, de coût, de véhicule ou de date. Notes, kilométrage et « plein complet » restent modifiables.
- **Comment** : `server/lib/fuel-record-ledger-lock.ts` compare les valeurs normalisées (montant à 0,005 près, date au jour). Les champs verrouillés sont retirés du correctif, donc la valeur stockée reste écrite. Le `catch` de la route transmet les `AppError`.
- **Pourquoi** : le solde est la somme des lignes. Réécrire le coût ou les litres d'un débit faisait diverger la ligne et la carte en silence.
- **Réserves de relecture traitées** :
  - pas de dérive par arrondi ;
  - message « demandez l'annulation » (le DELETE est réservé au chef d'atelier) ;
  - aucun `details` dans le corps ;
  - test `secondary-routes-validation` passé sur un plein manuel.
- **Comment tester** : en logistique, modifier la quantité d'un plein de mission → message « régularisation / demandez l'annulation ». Modifier seulement la note → enregistré.
- **Preuve automatisée** : `tests/unit/server/fuel-record-ledger-lock.test.ts` ; bloc « montants figés » de `fuel-records-and-document-paths.contract.test.ts`. Mutant : 4 rouges.
- **RAIDER** :
  - D : pleins manuels inchangés ;
  - E : invariant côté serveur, message lisible ;
  - failure memory : leçon dans LESSONS_LEARNED.

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

## 2026-11-03T18:35:16+01:00 — Check-list de lancement : même jour d'échéance que le lancement

- **Agent** : c7 · **Branche** : `fix/readiness-expiry-day` (empilée sur `fix/readiness-mirror-columns`) · **Commit** : voir `git log` de la branche
- **Statut** : fait, en relecture
- **Quoi** : l'assurance et la visite technique de la check-list sont jugées par `isExpiredOnOrBeforeToday`, comme au lancement : jour UTC, le jour de l'échéance bloque. `isDateExpired` devient `isDriverLicenseExpired`, réservée au permis, dont le comportement est inchangé.
- **Pourquoi** : un papier expirant aujourd'hui était « conforme » à la préparation et refusé au lancement.
- **Comment tester** : une assurance dont l'échéance est aujourd'hui donne l'item « Assurance conforme » rouge, et le lancement la refuse. Une échéance demain donne l'item vert.
- **Preuve automatisée** :
  - contrat `mission-renewal-receipt`, bloc « jour de l'échéance » (3 cas ; mutant : 2 rouges) ;
  - garde-fou `mission-expiry-day-hygiene.test.ts`.
- **RAIDER** :
  - R : une seule règle de date pour les papiers véhicule ;
  - D : permis inchangé, `checks[]` inchangé ;
  - failure memory : entrée LESSONS.
