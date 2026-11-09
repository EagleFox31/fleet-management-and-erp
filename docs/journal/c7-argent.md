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

## 2026-11-03T19:03:17+01:00 — P2 : règlement de facture rejoué depuis une mission livrée par le parcours

- **Agent** : c7 · **Branche** : `test/p2-delivered-by-journey` · **Commit** : voir `git log` de la branche
- **Statut** : fait, en relecture
- **Quoi** : `e2e/13-mission-invoice-payment` n'écrit plus `missions.status = delivered`.
  - Test 1 : affectation, lancement et livraison à l'écran.
  - Tests 2 à 4 : mêmes routes par l'API (PATCH affectation, PATCH budgets, PUT status).
  - P2 passe à « Fait » dans `docs/qa/PLAN_COUVERTURE_MODULES.md`.
- **Comment** : nouveau `e2e/helpers/mission-journey.ts`, extrait de la spec 17 (véhicule aux papiers valides, chauffeur FORMÉ, crédit carte, parcours navigateur et API, nettoyage). La spec 17 l'importe désormais.
- **Pourquoi** : le paiement était testé sur un état posé en base, qui ne prouvait pas que le parcours réel y mène.
- **Comment tester** : `node node_modules/@playwright/test/cli.js test e2e/13-mission-invoice-payment.spec.ts e2e/17-mission-lifecycle.spec.ts` sur une base de test (jamais la prod).
- **Preuve automatisée** : spec 13 4/4, spec 17 5/5, sur une base locale dédiée (`fleet_test_c7e2e`).
- **RAIDER** :
  - R : helper partagé par les deux specs ;
  - D : la spec 17 reste verte ;
  - I : données préfixées, supprimées en fin de spec.

## 2026-11-03T19:22:06+01:00 — P2, suites de relecture : purge par préfixe, budget exigé, driverIds retiré

- **Agent** : c7 · **Branche** : `test/p2-minors` · **Commit** : voir `git log` de la branche
- **Statut** : fait, en relecture
- **Quoi** : les trois mineurs de la relecture de #230.
  - La spec 13 purge les lignes `E2E-P2-` en `beforeAll`.
  - Un champ budget absent fait échouer le parcours navigateur au lieu d'être sauté.
  - La spec 17 n'a plus de `driverIds` inutilisé.
- **Comment** : la `purge()` de la spec 17 devient `purgeJourneyRows(prefix)` dans `e2e/helpers/mission-journey.ts`, que les deux specs appellent. `createLaunchableDriver(lastName, employeeNumber, { cpcStatus, track })` : suivre l'id devient facultatif.
- **Pourquoi** :
  - un run interrompu laissait des restes que le run suivant ne voyait pas ;
  - un champ budget sauté aurait laissé lancer la mission sans ce budget, en silence.
- **Comment tester** : `node node_modules/@playwright/test/cli.js test e2e/13-mission-invoice-payment.spec.ts e2e/17-mission-lifecycle.spec.ts` sur une base de test (jamais la prod).
- **Preuve automatisée** : 9/9 sur `fleet_test_c7e2e`, puis 0 ligne `E2E-P2-` ou `E2E-MIS1-` restante. `npm run check` n'inclut pas e2e/ : tsc ciblé (tsconfig temporaire étendant la racine, include e2e/, shared/, server/, tests/support/) sans erreur dans les fichiers touchés, les 2 erreurs restantes (e2e/22, tests/support/alert-emission-scan.ts) existent déjà sur main.
- **Garde** : `purgeJourneyRows` refuse tout préfixe hors `E2E-<SPEC>-` (un `""` ferait `LIKE '%'`).
- **RAIDER** :
  - R : purge partagée ;
  - I : la purge par préfixe rend le run rejouable après un plantage ;
  - D : signatures internes aux e2e, tous les appelants sont mis à jour.

## 2026-11-07T17:40:00+01:00 — Coût pneus de l'OT, badges pneus : une lecture en échec n'est plus prise pour du vide (#593)

- **Agent** : c7 · **Branche** : `c7-tires-load-errors` · **PR** : #593
- **Statut** : fait, en relecture
- **Quoi** : depuis #592, les lectures pneus renvoient 500 au lieu de `[]`. Trois écrans retombaient encore sur `[]` :
  - fiche OT : coût pneus calculé sur une liste vide, donc coût de l'OT sous-évalué sans signal, à l'écran comme dans le PDF ;
  - liste des véhicules : badge « Pneus non renseignés » sur tous les véhicules ;
  - fiche véhicule : badge, bandeau et invite de montage `tiresPrompt`.
- **Comment** :
  - `client/src/lib/work-order-tires-cost.ts` :
    - `listQueryView` réutilise `queryView`, et une réponse 200 qui n'est pas une liste devient une erreur ;
    - `workOrderDisplayCost` renvoie `tiresCost` et `totalCost` à `null` quand les rotations sont inconnues ;
    - `formatKnownCost` affiche « Indisponible » après un échec, « Chargement… » pendant le chargement, jamais 0. Le PDF suit le même état.
  - `vehicle-tires-status.ts` : `vehicleTiresRegistration` et `vehicleIdsWithRegisteredTiresIfKnown` renvoient `null` quand l'état est inconnu, et aucun badge ne s'affiche alors.
  - Une relance en échec avec une liste en cache garde la liste.
- **Pourquoi** : un coût d'OT faux est de l'argent. C'est la deuxième occurrence du défaut « échec pris pour du vide » après `widgets-silent-errors.md`. Les tests des helpers seuls ne prouvaient pas que les pages s'en servent.
- **Serveur** : il ne s'appuie pas sur ce calcul. `technician-work-orders-service.ts` recalcule depuis la base. Son propre repli `ZERO_COST` en cas d'échec fera l'objet du lot suivant.
- **Preuve automatisée** :
  - `tests/unit/client/work-order-tires-cost.test.ts` et `vehicle-tires-registration.test.ts` : rouges avant la correction, verts après ;
  - `tests/unit/client/tires-queries-no-empty-default.test.ts`, garde sur le code source des 3 fichiers :
    - il interdit la valeur par défaut `= []` sur une requête pneus et exige les helpers ;
    - il est rouge quand on remet `= []` (fiche OT et fiche véhicule, 2 échecs), vert sur le code livré.
  - `npm run check` : 0 erreur TS ; `check:tests` : 0.
- **Leçon** : la phrase ajoutée à l'entrée du 2026-11-07 de `docs/analysis/LESSONS_LEARNED.md` couvre aussi ces écrans.
- **RAIDER** :
  - R : `queryView` est réutilisé, `computeWorkOrderCost` n'est pas modifié ;
  - D : les données lues s'affichent comme avant ;
  - A, I et le volet rétroactif sont sans objet (client uniquement, aucune écriture).

## 2026-11-07T18:01:12+01:00 — Profil technicien : un coût d'OT non calculé n'est plus affiché à 0

- **Statut** : fait, en relecture
- **Quoi** : `technician-work-orders-service.ts` journalisait l'échec du calcul groupé des coûts et renvoyait une carte vide. Chaque OT recevait alors `ZERO_COST`, même avec un `work_orders.cost` renseigné. `GET /api/technician/my-work-orders` répondait 200 et le profil technicien affichait 0 comme un vrai coût. La page ne lisait que `isLoading` : sur une erreur, elle affichait aussi des 0.
- **Comment** :
  - serveur : `calculateWorkOrderCosts` relève `AppError(500, message lisible, { cause })` après le log, et `ZERO_COST` est supprimé ; un OT sans coût calculé lève aussi une `AppError` au lieu d'un 0 ;
  - `getPendingWorkOrdersCount` relève au lieu de `return 0` et sort de la liste gelée de `swallowed-read-catch-hygiene` ; les `console.*` du fichier passent par `moduleLogger` ;
  - client : `client/src/lib/technician-profile-stats.ts` (`technicianProfileView`, sur `queryView`). Une erreur sans données, ou une réponse sans liste d'OT, affiche « Indisponible » avec `InlineQueryError` (message lisible, référence, « Réessayer ») ;
  - les routes de `routes.ts` (gelé) ne sont pas modifiées : elles répondaient déjà 500 sur une exception du service.
- **Pourquoi** : un coût faux est de l'argent. C'est la troisième occurrence du défaut « échec pris pour du vide » (après `widgets-silent-errors.md` et #593).
- **Preuve automatisée** :
  - `tests/unit/server/technician-work-orders-cost-error.test.ts` : 4 rouges avant la correction (OT renvoyés à coût 0, statistiques résolues, comptage à 0), verts après ; le cas nominal (coût de base conservé) est vert des deux côtés ;
  - `tests/unit/client/technician-profile-stats.test.ts` : états error, loading, ready, et calcul des coûts ;
  - `tests/integration/work-order-cost.test.ts` sur Postgres local : 4/4 ;
  - unitaires : 3 240 verts, seul `db-pool-options` échoue (node_modules local, connu) ; `npm run check` : 0 erreur TS ; `check:tests` : 0.
- **RAIDER** :
  - R : `queryView`, `InlineQueryError` et `UNAVAILABLE` sont réutilisés ;
  - D : un calcul réussi renvoie les mêmes valeurs qu'avant ;
  - E : `AppError`, `moduleLogger`, cliquet resserré d'une entrée ;
  - A, I et le volet rétroactif sont sans objet (aucune écriture, aucun schéma).

## 2026-11-08 23:06 — Coûts technicien, refonte après relecture (#594)

Cette entrée remplace l'approche de l'entrée précédente, refusée en relecture : une AppError 500 sur toute la liste aurait privé le technicien de ses interventions pour un simple coût manquant.

- **Quoi** :
  - serveur : `GET /api/technician/my-work-orders` reste en 200. `calculateWorkOrderCosts` isole les quatre requêtes du coût (heures, pièces, rotations, taux) par `Promise.allSettled`. Seule la composante en échec passe à `null`, le total aussi, et l'OT porte `costUnavailable: true`. Chaque échec est journalisé par `moduleLogger`. Un OT absent de la table des coûts reçoit la même valeur `null`, plus aucun throw ;
  - `getPendingWorkOrdersCount` relève toujours une `AppError` (comptage, pas une liste) ;
  - client : `technicianWorkOrdersView` / `technicianProfileView` (sur `queryView`) et `InlineQueryError` sur le tableau de bord, « Mes OT » (start_url de la PWA) et le profil ; un coût inconnu s'affiche « Indisponible » (`workOrderCostLabel`, `formatKnownCost`). Les totaux du profil passent à `null` dès qu'un OT terminé est sans coût ; les `any[]` du profil sont typés.
- **Pourquoi** : la liste des OT est l'écran de travail du technicien ; un coût est une donnée annexe. Une panne du coût ne doit ni cacher les OT, ni s'afficher comme 0.
- **Preuve automatisée** :
  - `tests/unit/server/technician-work-orders-cost-error.test.ts` : liste servie quand tout échoue ; une requête en échec à la fois (pièces, rotations, taux) ne met à `null` que sa composante ;
  - `tests/unit/client/technician-profile-stats.test.ts` : un OT terminé sans coût met tous les totaux à `null` ;
  - `tests/unit/client/technician-pages-query-errors.test.ts` : garde de branchement, rouge sur les trois pages de main (7a5ddefe), verte après ; cliquet sur les pages technicien qui lisent une requête sans traiter l'erreur (`fleet-status.tsx`, `vehicles.tsx` gelées).
- **Mémoire** : `docs/analysis/LESSONS_LEARNED.md`, entrée du 2026-11-07, complétée avec la troisième occurrence et le contrôle renforcé.

## 2026-11-08 23:31 — Statistiques avancées des pneus en une seule requête

- **Quoi** :
  - `getTireStatisticsAdvanced` envoie une seule requête SQL (sous-requêtes scalaires et `json_agg`) au lieu de 5 en parallèle, qui prenaient 5 places du pool par appel de `GET /api/tires/statistics-advanced` ;
  - `server/lib/json-table-row.ts` (nouveau) : `jsonRowOf(table, alias)` agrège une ligne entière en JSON avec les colonnes texte du pilote (numeric, bigint, dates) castées en `::text`, et `rowFromJson` la décode avec le décodeur Drizzle de chaque colonne : même objet qu'un `select()` ;
  - les actions requises sont calculées par une méthode pure (`buildRequiredActions`), même logique qu'avant ;
  - l'erreur reste une `AppError(500, …, { cause })`. Contrat d'API inchangé (forme et types).
- **Écart assumé** : l'ancien calcul rendait toujours vides les alertes « rotation dépassée / en approche » (colonne externe non qualifiée dans une sous-requête corrélée, voir LESSONS_LEARNED du 2026-11-08). Le nouveau calcul les rend justes.
- **Pourquoi** : sous charge, les 5 requêtes saturaient le pool et la page /inventory/tires attendait jusqu'au plafond de connexion.
- **Preuve automatisée** :
  - `tests/integration/tire-statistics-advanced-sql.test.ts` (Postgres local) : ancien calcul copié tel quel identique hors rotations ; ancien calcul avec la seule référence qualifiée identique en tout (objets et JSON servi) ; une seule requête (`db.execute` une fois, `db.select` jamais) ;
  - `tests/unit/server/correlated-subquery-hygiene.test.ts` : garde, rouge sur le service de main, verte après ;
  - `tests/unit/server/tire-select-hygiene.test.ts` : `jsonRowOf(tires, …)` compte comme une lecture entière (prix d'achat) ; l'entrée gelée #6 est justifiée (route refusée au chauffeur). Sans l'extension du détecteur, la nouvelle lecture passait inaperçue (vu rouge) ;
  - `tests/unit/server/tire-statistics-advanced-error.test.ts` : l'échec reste une AppError 5xx.
- **RAIDER** :
  - R : `jsonRowOf` / `rowFromJson` génériques (toute table de 50 colonnes au plus) ;
  - D : résultat identique hors correction prouvée, contrat inchangé ;
  - E : `AppError`, garde automatique, leçon consignée ;
  - Reuse-first : aucun helper équivalent dans le dépôt ni dans Drizzle (pas de décodage public d'une ligne JSON) : Build, petit et testé ;
  - A, I et le volet rétroactif sont sans objet (lecture seule, aucun schéma).
