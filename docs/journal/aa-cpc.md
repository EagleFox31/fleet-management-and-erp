## 2026-11-05 — Assistant de mission : éligibilité CPC du chauffeur

- Quoi : un chauffeur au CPC valide apparaissait « NON FORMÉ » à l'étape 3 et « Suivant » restait muet.
- Comment : règle extraite dans `shared/constants/driver-cpc-eligibility.ts`, lue par les quatre gardes de `server/api/missions.routes.ts` et par l'assistant ; `GET /api/drivers` expose aussi `cpcStatusRecorded` (statut en base) ; raison de blocage affichée en ligne par `client/src/lib/mission-wizard-rules.ts`.
- Pourquoi : la liste recalcule `cpcStatus` depuis `cpcTrainingDate` (`cpc-training-service.ts:73`), alors que le serveur refuse ou accepte sur le statut enregistré. Date absente et statut enregistré valide : l'écran bloquait ce que le serveur acceptait.
- Tester : `tests/unit/shared/driver-cpc-eligibility.test.ts`, `tests/unit/client/mission-wizard-rules.test.ts`, contrats mission-*.

## 2026-11-05 — Reprise de relecture : expiration CPC et contrats

- Quoi : la règle juge aussi la date (statut FORMÉ enregistré mais formation de plus de 731 jours : refusé, raison « Formation CPC expirée le JJ/MM/AAAA ») ; classe de caractères écrite en échappements ; badge « À FORMER » via `normalizeCpcStatus` ; leçon consignée.
- Comment : `CPC_VALIDITY_DAYS` et `cpcExpiryDayOf` dans le module partagé (importés par `cpc-training-service.ts`), `addDaysToDateOnly` dans `expiry-day.ts` ; les gardes serveur lisent `cpc_training_date`.
- Pourquoi : aucune synchro planifiée ne remet `cpc_status` à jour ; sans cela la PR ouvrait une régression réglementaire.
- Tester : `tests/contract/mission-driver-cpc-status.contract.test.ts` (6 échecs sur 7 sans le correctif), tests unitaires de la règle.

## 2026-11-05 — Suites CPC : bornes, date future, jour UTC, statut partagé

- Quoi : contrats des bornes J-731 (accepté) / J-732 (refusé 400) et de launch-readiness à J-800 ; une date de formation CPC dans le futur est refusée à la saisie d'un chauffeur (POST et PATCH `/api/drivers`) ; `cpc-training-service.ts` calcule expiration et jours restants en jour UTC ; les écrans comparent le statut CPC par `normalizeCpcStatus` / `getDriverCpcEligibility`.
- Comment : `pastOrTodayDateField` dans `server/api/drivers-management.routes.ts` (helper `todayUtcDateOnly`), appliqué au seul `cpcTrainingDate` ; un PATCH sans cette clé n'évalue pas la règle. `computeCpcExpiry` (service) passe par `cpcExpiryDayOf` et `daysBetweenDateOnly` ; le fichier sort de la liste FROZEN de `expiry-day-local-math-hygiene.test.ts`. Les `console.*` du service passent à `moduleLogger("cpc-training")`. Marge de 59 jours inchangée (décision métier en attente).
- Pourquoi : à 23h30 UTC le calcul en millisecondes donnait -1 jour restant le dernier jour valable ; une date future donnait un statut FORMÉ sans formation faite. Import Excel et scripts (`scripts/import-tay.ts`, `import-3-drivers.ts`) écrivent en SQL direct, hors de ce schéma : une date future y reste acceptée.
- Tester : `tests/unit/server/cpc-training-service.test.ts` (heure simulée 23h30 UTC), `tests/contract/mission-driver-cpc-status.contract.test.ts` (2 échecs sur 21 sans le correctif de saisie).
