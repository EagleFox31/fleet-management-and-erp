# Journal — CDC-0 socle (`cdc-0-socle`)

Worktree : `../fm-cdc-0-socle`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-31T19:30:00+01:00 — CDC-0a — Socle serveur des écarts du cahier des charges

- **Agent** : api (lot CDC-0a) · **Branche** : `lot/api/CDC-0-socle` · **Commit** : voir `git log`
- **Statut** : fait ; contrat HTTP non joué (voir « Reste »)
- **Quoi** : pose une fois les registres partagés du chantier CDC. 7 drapeaux `should` coupés (`mission-maintenance-advisory`, `part-qr`, `part-sales`, `kpi-reports`, `maintenance-report`, `excel-import`, `technician-offline`), 10 groupes de rôles, 9 routeurs squelettes (501) montés avec garde de rôle et drapeau, garde d'idempotence et purge sans effet, audit des nouvelles écritures. Aucun comportement existant ne change : drapeaux coupés, tous les nouveaux chemins répondent 404.
- **Comment** :
  - `shared/feature-flags.ts` : 7 clés, libellés français ; `gps` existe déjà et n'est pas dupliqué.
  - `shared/constants/roles.ts` : `PART_LABEL_ROLES`, `PART_SCAN_ROLES`, `PART_SALE_ROLES` et `PART_SALE_READ_ROLES` (provisoires, décision utilisateur #4), `GPS_VIEW_ROLES`, `IMPORT_ROLES`, `IMPORT_INTERVENTION_ROLES`, `MAINTENANCE_REPORT_ROLES`, `MISSION_ADVISORY_ROLES`. `KPI_VIEWER_ROLES` inchangé (lot #7).
  - `server/api/{mission-advisories,part-scans,part-sales,telemetry,vehicle-positions,telemetry-devices,workshop-labor-rates,maintenance-reports,imports}.routes.ts` : `createStubRouter`, chemins relatifs au montage. `telemetry` est écrit à la main (le stub impose `authenticate`) et répond 501 sans rien lire.
  - `server/api/index.ts` : ordre des gardes au montage = drapeau (404), session (401), rôle (403). `/telemetry` est monté avant tout routeur gardé : exception documentée aux gardes de session (auth par jeton d'appareil au lot #6). Aucun doublon : grep de chaque chemin dans `server/routes.ts`, `server/api/*.routes.ts` et `shared/contracts` négatif avant montage.
  - `/part-sales` : la direction lit (`PART_SALE_READ_ROLES`), l'écriture reste à `PART_SALE_ROLES`.
  - `/imports` : le montage laisse passer l'admin et le chef d'atelier ; `POST /imports/:kind` est `adminOnly`, seul `POST /imports/interventions` est ouvert au chef d'atelier.
  - `/workshop-labor-rates` : placé derrière `maintenance-report` (aucun drapeau dédié dans la liste du brief), à confirmer.
  - `server/lib/idempotency-config.ts`, `server/middleware/idempotency-guard.ts` : garde à blanc (`next()`), liste de routes vide, monté sous `technician-offline`.
  - `server/jobs/idempotency-purge.ts`, `server/scheduler.ts` : purge horaire sans effet, sous `pg_try_advisory_lock` sur `listenerPool`, tolérante à l'absence de `idempotency_keys` (`to_regclass`). `purgeExpired` renvoie 0 jusqu'au lot #10b.
  - `server/lib/audit-config.ts` : `CDC_AUDIT_CONFIG` séparée (la liste `AUDIT_CONFIG` est gelée à 8 entités par un test existant), montée à la suite ; `/telemetry/positions` et `/vehicle-positions` ne sont pas audités (volume).
  - Choix : Build (aucun équivalent à adopter, ce sont des points de montage propres au dépôt).
- **Pourquoi** : lots CDC suivants ne touchent que leurs fichiers ; ADR 0001 §1 et §6 (tranches verticales, `requireFeature` sur tout endpoint SHOULD).
- **Comment tester (QA)** :
  - Prérequis : aucun (squelettes). Pour le contrat, une base de test distincte.
  - Étapes : 1. Sans `FEATURE_FLAGS`, GET `/api/part-scans` en admin. 2. `FEATURE_FLAGS=part-qr=on`, même appel sans session, puis en client, puis en magasinier. 3. `FEATURE_FLAGS=gps=on`, POST `/api/telemetry/positions` sans session.
  - Attendu : 404 ; 401, 403, 501 ; 501.
  - Preuve automatisée : `node node_modules/vitest/vitest.mjs run --reporter=dot` (unitaires, dont `cdc-mounts`, `cdc-flags`, `cdc-skeletons`) ; contrat `tests/contract/cdc-mounts.contract.test.ts` à rejouer sous verrou sur une base de test distincte.
- **RAIDER** : couvert R (table de cas partagée, rôles dérivés de `AppRole`), A (aucun repo en dur), I (purge sans effet rejouable, verrou), D (suites existantes vertes, drapeaux coupés = 404), E (moindre privilège, erreurs normalisées, aucun `console.*`) ; sans objet : migration (table `idempotency_keys` au lot DB-1).
- **Reste / risques** :
  - Contrat non joué ici : `DATABASE_URL_TEST` est identique à `DATABASE_URL` (même Neon que le développement), pas une base de test distincte.
  - `tests/contract/api-auth-guard.contract.test.ts` signalera `POST /api/telemetry/positions` (route sans garde de session, voulue) : ajouter l'entrée dans `PUBLIC_ROUTES` avec la justification « auth par jeton d'appareil, lot #6 ». Fichier existant, non modifié.
  - `tests/unit/server/audit-config.test.ts` gèle `AUDIT_CONFIG` à 8 entités : d'où `CDC_AUDIT_CONFIG` séparée. Fusionner les deux demande de mettre ce test à jour.
