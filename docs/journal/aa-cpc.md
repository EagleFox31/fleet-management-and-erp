## 2026-11-05 — Assistant de mission : éligibilité CPC du chauffeur

- Quoi : un chauffeur au CPC valide apparaissait « NON FORMÉ » à l'étape 3 et « Suivant » restait muet.
- Comment : règle extraite dans `shared/constants/driver-cpc-eligibility.ts`, lue par les quatre gardes de `server/api/missions.routes.ts` et par l'assistant ; `GET /api/drivers` expose aussi `cpcStatusRecorded` (statut en base) ; raison de blocage affichée en ligne par `client/src/lib/mission-wizard-rules.ts`.
- Pourquoi : la liste recalcule `cpcStatus` depuis `cpcTrainingDate` (`cpc-training-service.ts:73`), alors que le serveur refuse ou accepte sur le statut enregistré. Date absente et statut enregistré valide : l'écran bloquait ce que le serveur acceptait.
- Tester : `tests/unit/shared/driver-cpc-eligibility.test.ts`, `tests/unit/client/mission-wizard-rules.test.ts`, contrats mission-*.
