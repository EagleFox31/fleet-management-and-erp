
## 2026-11-03 23:30 — c7 : #224 reprises de relecture

- Relecture 0a « OK sous réserve » traitée, SHA 7fbbb6a envoyé à 0a :
  - expiredDocuments passe par isDateExpired, avec un test ;
  - main est fusionnée (574402e, sans force-push) ;
  - nouveau garde expiry-day-local-math-hygiene, avec une liste gelée de 6 fichiers.
- Description de PR #224 réécrite sur tout le delta, avec la section RAIDER.
- Prochaine étape : 0a ouvre l'issue des 6 fichiers gelés et décide de la fusion.

## 2026-11-04 17:37 — c7 : suite de #307 livrée
- PR brouillon fix/alert-retry-followup : abandonedSample (5 max) + lot en erreur de connexion sans reprise unitaire ; test rouge puis vert, check 0 erreur.
- Postgres 54320 inutilisable (plage réservée Windows 54299-54398) : base de test perso, projet compose c7test, ports 55432/55433 (docker compose -p c7test down pour la retirer). c7_idem/c7_side n existent plus (tmpfs) : dropdb sans objet.
- Reste : pending.catch(() => {}) dans part-requirements-idempotence.

## 2026-11-04 17:55 — c7 : #312 CI rouge corrigée
- Cause : mock de moduleLogger non fiable en suite complète (module déjà chargé). Remplacé par emitLossContext, fonction pure exportée et testée ; suite intégration complète 328/328, check 0.
- Leçon : ne pas asserter sur un logger instancié à l import ; extraire le contexte en fonction pure.

## 2026-11-05 00:48 — c7 : état pour reprise (création mission assigned)
- Branche fix/mission-create-assigned (worktree c7-backup), base main. GO de 0a : POST /api/missions planned+affectation => assigned + affectation pending, en transaction ; draft+aff reste draft ; affectation refusée => aucune mission. Ne pas toucher PUT /status. Note docs : ambiguïté affectée/acceptée (question ouverte). Couche 3 : realtime-satellites mission_created, compléter ou justifier. Pas dans routes.ts. Push simple, PR ready, échéance ~1 h 30.
- Script #229 : branche locale chore/recensement-229 (80f4ddb+), non poussée, en attente de décision utilisatrice.
- Piège : port 54320 réservé Windows ; pile de test perso : docker compose -p c7test -f $TEMP/c7-compose.yml (ports 55432/55433), DATABASE_URL_TEST=postgres://fleet:fleet@postgres:5432/fleet_test DATABASE_WS_PROXY=localhost:55433/v1, drizzle-kit push avec DATABASE_URL=...55432 ; down -v ensuite.

## 2026-11-05 01:01 — c7 : #328 en relecture, attente de #327
- PR #328 (fix/mission-create-assigned) livrée, relue par 0a. Conflit prévu avec #327 (aa) : garde CPC de création remplacée par isCpcStatusValid (shared/constants/driver-cpc-eligibility.ts).
- Prochaine étape : quand 0a annonce #327 fusionnée, merger origin/main dans fix/mission-create-assigned, GARDER la règle partagée (pas normalizeCpcStatus local à la création), relancer le test mission-create-assigned (fixture CPC FORME sans accent : vérifier qu isCpcStatusValid l accepte, sinon adapter la fixture), push simple.
- Script #229 : chore/recensement-229 locale, non poussée, en attente de décision utilisatrice.

## 2026-11-05 01:11 — c7 : #328 déclencheur de test ciblé validé, attente de #327
- Réserves de 0a sur #328 traitées. Déclencheur du test d'échec d'insertion ciblé (WHEN sur le véhicule du test), poussé ; 5/5 verts, aucun déclencheur résiduel. 0a a validé sans db-lock.
- Prochaine étape inchangée : sur annonce de 0a que #327 est fusionnée, merger origin/main, garder isCpcStatusValid, relancer mission-create-assigned et mission-*, npm run check, push, message « mr 328 » à 0a.

## 2026-11-05 01:32 — c7 : conflits de planning à l'écriture (fix/mission-planning-conflict)
- #328 fusionnée (773b1f8). Branche fix/mission-planning-conflict depuis main : server/services/mission-planning.ts (findPlanningClash, verrou advisory), branché sur POST /api/missions, PATCH /:id (chauffeur, véhicule, dates), POST /:id/assignments, launch-readiness et la validation de lancement de PUT /:id/status (les 3 copies d'origine).
- Preuves : contrat mission-planning-conflict-write (9 cas, 6 rouges sans contrôle, rafale rouge 3/3 sans verrou), intégration mission-planning-clash (4), contrats mission-* 189 verts, npm test 2320 verts, npm run check 0 erreur.
- Suivi noté dans LESSONS : PUT /:id/status ne rejoue pas le contrôle.
- Prochaine étape : PR prête, avis de 0a.

## 2026-11-05 01:58 — c7 : #334 réserves de relecture traitées ; suivi PUT /status empilé
- #334 : PATCH prend la ligne mission FOR UPDATE avant les verrous consultatifs ; helper lockPlanningPairs (ordre global trié et dédoublonné, véhicules puis chauffeurs) dans mission-planning.ts. Rafale PATCH dates + ajout d'affectation sur le même véhicule : rouge 3/3 sans le FOR UPDATE, verte avec. Doc corrigée (les 3 copies = launch-readiness, POST /:id/assignments, validation de lancement de PUT /status). liveAssignments relu hors transaction : noté en suivi.
- Branche fix/mission-status-planning-clash (empilée sur #334, WIP commité, non poussée) : PUT /:id/status vers planned/assigned rejoue findPlanningClash sous verrou ; contrat mission-planning-conflict-status 5 cas (3 rouges sans correctif). À rebaser sur #334 corrigée, verrouiller la ligne mission FOR UPDATE avant les verrous consultatifs, puis PR.

## 2026-11-05 02:15 — c7 : PUT /:id/status rejoue le contrôle de planning (PR empilée sur #334)
- Branche fix/mission-status-planning-clash rebasée sur #334 corrigée ; PUT /status vers planned/assigned prend la ligne mission FOR UPDATE, puis lockPlanningPairs, puis findPlanningClash ; 409 lisible (AppError). Contrat mission-planning-conflict-status : 5 cas (3 rouges sans correctif), cancelled non régressé. Suivi de LESSONS (« PUT /status ne rejoue pas ») clos.

## 2026-11-05 03:05 — c7 : #339 réserves de relecture (lecture périmée, 409 centralisé)
- PATCH (liveAssignments, créneau) et PUT /status comparent, sous le FOR UPDATE de la mission, l'empreinte lue avant la transaction à celle de la base (assertPlanningStateUnchanged) : 409 lisible si périmée. Contrat tests/contract/mission-planning-stale-read : déterministe via un verrou de ligne tenu par le test, rouge 2/2 sans la comparaison. POST / renvoie son 409 par next(error) (Express 4 : un throw dans le handler async ne répond jamais). Cas draft vers planned sans affectation : 200. Suivi liveAssignments clos.

## 2026-11-05 03:30 — c7 : #339 poussée par merge de main (sans réécriture)
- Branche distante fix/mission-status-planning-clash : merge de origin/main + commit des réserves (lecture périmée, 409 de POST / par next). Base de #339 = main. Contrats mission 222 / npm test 2413 / check 0 vérifiés sur l'arbre rebasé identique. En attente de relecture de 0a.

## 2026-11-05 04:05 — c7 : PATCH de dates sans affectation vivante prend le verrou et l'empreinte
- Branche fix/mission-patch-dates-lock (empilée sur #339 non fusionnée à l'heure de la branche) : le PATCH qui change les dates prend aussi le FOR UPDATE de la mission et compare l'empreinte (condition `|| datesChanged`), sinon un POST /:id/assignments concurrent contrôlait sur les anciennes dates. Contrat déterministe ajouté (rouge sans le correctif). waitForBlockedWriter filtre sur pg_blocking_pids du pid qui tient le verrou.

## 2026-11-05 04:40 — c7 : analyse findPlanningClash(db) close, #346 en attente de base
- Lectures indicatives l.1782 (launch-readiness) et l.3019 (validation de lancement de PUT /status) : lecture seule, aucune écriture, aucun écran ne s'en sert comme garantie (canLaunch colore seulement le panneau). Conclusion transmise à 0a : « rien à faire ».
- #339 fusionnée (bbdd824). #346 (fix/mission-patch-dates-lock, relue OK par 0a) attend que l'utilisatrice repasse sa base sur main (`gh pr edit 346 --base main`) et la passe en ready ; je ne touche pas à la base. Test DB c7test arrêté. Rien d'autre en cours.
## 2026-11-05 05:10 — c7 : entrée LESSONS « ordre de verrouillage unique des missions »
- Branche docs/lessons-ordre-verrous-missions (depuis origin/main) : nouvelle entrée en fin de LESSONS_LEARNED (ligne mission FOR UPDATE, empreinte, advisory triés). Petite PR doc ; « mr » à 0a ensuite. #346 reste en attente de la décision de l'utilisatrice sur sa base.

## 2026-11-05 03:20 — c7 : #346 mis à jour, message de lancement chauffeur, validation stricte de l'identifiant de mission
- #346 : origin/main fusionné dans fix/mission-patch-dates-lock (f555fcba), poussé sans force ; contrats mission verts.
- fix/driver-status-error-message : AppError sans fieldErrors, message borné à 300 caractères (looksTechnical), conflit et budget en tête, consigne « Contactez l'exploitation » pour le chauffeur, toast via userMessageOf. Poussée, PR à ouvrir.
- fix/mission-id-strict : parseMissionId unique (garde et handlers), contrat + garde unitaire + entrée LESSONS.
## 2026-11-05 03:03 — c7 : PR doc « Suivis » (doublons LESSONS)
- docs/lessons-suivis-doublon : la ligne « Suivis » du conflit de planning figurait deux fois dans son entrée et en copies dans deux entrées sans rapport (trigger SQL, justificatif fournisseur). Il n'en reste qu'une, la plus récente, dans l'entrée du conflit de planning.
- PR ouvertes : #353 (id strict, relue par 0a), #354 (message de lancement chauffeur, relue). Stack de test c7test à arrêter en fin de session.

## 2026-11-05 03:19 — c7 : réserves de #354 (fonction pure du message de lancement)
- #353 et #354 fusionnées, #358 aussi. Branche fix/launch-message-followup : launchRefusalMessage extraite (continue au lieu de break), test unitaire, cas toast client, entrée LESSONS. PR à ouvrir, « mr » à 0a. Stack c7test à garder jusqu'à la fin de cette PR.

## 2026-11-05 — B1 garde de réservation OT : rôle avant lecture (fix/booking-guard-role-first, base main) ; état de session c7
- Garde de réservation : contrôle de rôle (mêmes gardes que les routes d'écriture) avant la première lecture ; contrat client/chauffeur 403 rouge avant, vert après ; LESSONS ajoutée.
- État : #373 mineurs poussés et fusionnés dans #375 ; #378 mineurs poussés (JSDoc, cas sans propriétaire) ; B1 à relire (« mr » envoyé).
- À venir après fusion de #379 : sur #375, `assertNotLastActiveAdmin(res, id)` dans la garde toggle quand elle désactive (handler async, erreurs vers next), cas concurrents toggle/DELETE et toggle/toggle dans last-active-admin-guard.contract ; vérifier le route-id.ts identique au rebase.
- Stack de test c7test à arrêter en fin de session ; chore/recensement-229 locale, en attente de l'utilisatrice.
