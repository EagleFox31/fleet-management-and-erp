
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
