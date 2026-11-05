
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
