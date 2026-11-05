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

## 2026-11-05 — Suites CPC, arbitrages : réponses 400 chauffeur et update-cpc

- Quoi : POST/PATCH `/api/drivers` renvoient un corps ApiErrorBody (`message`, `code`, `errors[]` par champ en français) ; `message` ne reprend que les messages écrits dans le schéma, sinon « Données chauffeur invalides » ; `POST /api/drivers/:id/update-cpc` refuse aussi une date future.
- Comment : `server/lib/driver-cpc-input.ts` (message et test de date futur partagés), liste explicite `SCHEMA_MESSAGES` pour distinguer les messages personnalisés, `toFieldErrors` de `shared/errors.ts` pour le détail.
- Pourquoi : le texte Zod par défaut (anglais) ne doit jamais atteindre l'écran.
- Tester : `tests/contract/mission-driver-cpc-status.contract.test.ts` (4 échecs sur 27 sans le correctif).

## 2026-11-05 — Éligibilité CPC calculée par le serveur pour les missions, mineurs de #333

- Quoi : `assignment.driver.cpcEligible` et `cpcIneligibleReason` (libellé fixe, sans date) sur GET /api/missions et GET /api/missions/:id ; `cpcTrainingDate` retirée du payload ; absents pour un client et pour la fiche d'un autre chauffeur (cloison de #127). La règle partagée renvoie un code de raison (EXPIRED, NOT_VALID, MISSING, FUTURE_DATE) ; une formation datée du futur rend le chauffeur inéligible. Les `console.*` de `drivers-management.routes.ts` passent à `moduleLogger` (le journal de GET /me ne liste plus les missions) ; une date impossible (9999-99-99) donne 400 au lieu de 500.
- Comment : `server/lib/mission-driver-cpc.ts`, `invalidateDriverCpcDependents` (client) pour la couche 3 (la synchro temps réel `driver_updated` et `driver_cpc_updated` invalide aussi le détail de mission), `buildDriverPatchPayload` : la fiche n'envoie `cpcTrainingDate` que si elle a changé.
- Pourquoi : le tableau de bord logistique jugeait le CPC sur le statut seul, une formation expirée passait ; l'envoi systématique de la date réécrivait le statut CPC à chaque modification de fiche.
- Tester : `tests/contract/mission-driver-cpc-eligibility.contract.test.ts` (8 échecs sur 11 sans le correctif), `tests/contract/drivers-input-validation.contract.test.ts` (4 échecs sur 6 sans le correctif).

## 2026-11-05 — launch-readiness sans date CPC, code de raison exposé, ton de statut partagé

- Quoi : `GET /api/missions/:id/launch-readiness` ne renvoie plus la raison datée du CPC (libellé fixe + `cpcIneligibleCode` sur la vérification `driver_cpc_valid`) ; un chauffeur (accès à la route) n'y lit que ses missions (403 sinon) et la checklist porte sur sa propre affectation. `cpcIneligibleCode` s'ajoute à `cpcIneligibleReason` sur les affectations. `cpcStatusTone` (shared) remplace les tables de couleurs par graphie de statut (fiche chauffeur, admin/users). Écran mission : sans verdict serveur, « Verdict CPC indisponible » (plus de repli sur le statut). Tableau de bord logistique : le blocage affiche la raison serveur. Date `0000-01-01` : 400 au lieu de 500. Les `res.status(500)` de `drivers-management.routes.ts` passent à `AppError`.
- Comment : `driverScopeOf`, `canAccessMissionAsDriver` et `driverLiveAssignmentFilter` dans la route ; parcours récursif des clés JSON dans le contrat.
- Pourquoi : la raison datée sortait vers tout le personnel, chauffeurs compris ; un repli client concluait à l'éligibilité sans verdict.
- Tester : `tests/contract/mission-driver-cpc-eligibility.contract.test.ts` (3 échecs sur 15 sans le correctif), `tests/contract/mission-driver-cpc-status.contract.test.ts` (1 échec), `tests/contract/drivers-input-validation.contract.test.ts` (1 échec), `tests/unit/shared/driver-cpc-eligibility-codes.test.ts`.

## 2026-11-05 — launch-readiness : affectation vivante seule, erreurs par AppError, garde de lecture

- Quoi : la check-list de lancement ne lit plus une affectation annulée ou refusée pour le personnel ; le 403 chauffeur hors mission (défense en profondeur) et le 500 passent par `AppError` (plus de `res.status`). Garde unitaire sur les lectures d'`assignments` des handlers `/:id/*` ouverts aux chauffeurs ; reste gelé : `GET` et `POST /:id/document-renewal-requests`.
- Comment : filtre `notInArray(assignments.status, VOID_ASSIGNMENT_STATUSES)` côté personnel, `driverLiveAssignmentFilter` côté chauffeur ; le `catch` relaie les `AppError` telles quelles.
- Pourquoi : `router.param` cloisonne la mission, pas l'affectation lue ; mineurs de la relecture de #345.
- Tester : `tests/contract/mission-launch-readiness-live-assignment.contract.test.ts` (2 échecs sur 2 sans le correctif), `tests/unit/server/mission-assignment-read-scope.test.ts`.

## 2026-11-05 — document-renewal-requests : affectation vivante seule

- Quoi : GET et POST /:id/document-renewal-requests lisent le véhicule de l'affectation vivante, plus la première affectation par id (annulée ou d'un autre chauffeur) ; liste gelée du garde vidée.
- Comment : le filtre (driverLiveAssignmentFilter pour un chauffeur, VOID_ASSIGNMENT_STATUSES exclus pour le personnel) est posé dans la condition de la jointure, la mission reste trouvée (404 inchangé).
- Pourquoi : router.param cloisonne la mission, pas l'affectation lue ; dette gelée de #349.
- Tester : tests/contract/mission-document-renewal-live-assignment.contract.test.ts (3 échecs sur 5 sans le correctif), tests/unit/server/mission-assignment-read-scope.test.ts.
