# Journal — Backend 2 (`be-2`)

Worktree : `../fm-be-2`. Modèle d'entrée et règles : `README.md`.
Entrées ajoutées en bas, dans l'ordre chronologique, une par commit.

## 2026-10-30T15:00:00+01:00 — T-43 — Service d'incidents

- **Agent** : be-2 · **Branche** : `lot/be/T-43-incidents` (sur T-07) · **Commit** : voir `git log`
- **Statut** : fait côté service ; routeur, contrat HTTP et temps réel à deux comptes pour l'API
- **Quoi** : un chauffeur peut déclarer une panne sur son véhicule ; le chef d'atelier et l'admin sont alertés et reçoivent `incident_reported`.
- **Comment** : `server/services/incident-service.ts` : `incidentScopeError` (règle pure : chauffeur limité aux véhicules de ses affectations actives `pending|accepted|in_progress` via `assignments` + `drivers.user_id`, client 403, personnel libre), `createIncident(actor, body)` (transaction, `created_by`/`updated_by`, puis alerte dédupliquée `incident_reported:<id>` par `storage.createAlert` aux rôles `workshop_manager` et `admin`, puis `broadcastUpdate("incident_reported", ..., scope roles)` après commit), `listIncidents(actor, { status })` (un chauffeur ne relit que ses déclarations). `alert-service.ts` non modifié. Écart au plan : l'alerte part après le commit et non dans la même transaction (`storage.createAlert` n'est pas transactionnel) ; la dédup rend un retry sans doublon et un échec d'alerte n'annule pas la déclaration.
- **Pourquoi** : P-22 / R-13, plan 04-backend T-43.
- **API pour l'API (`server/api/incidents.routes.ts`, drapeau `incidents`)** : `POST` → `createIncident(req.user, createIncidentRequestSchema.parse(body))` ; `GET` → `listIncidents(req.user, incidentsQuerySchema.parse(query))`. Les `AppError` 401/403 sortent telles quelles.
- **Comment tester (QA)** : preuve automatisée `node node_modules/vitest/vitest.mjs run --reporter=dot tests/unit/server/incident-service.test.ts` → 6 passed. Contrat HTTP et trame WS à deux comptes (chauffeur déclare, chef d'atelier reçoit) : après le routeur.
- **RAIDER** : R/A règle pure et dépendances injectées ; I alerte dédupliquée ; D aucun fichier existant modifié ; E audit 4 colonnes (createdAt/updatedAt posés), erreurs métier lisibles. Failure memory : sans objet.
- **Reste / risques** : intégration non écrite (base de test occupée) ; la table `incidents` n'a pas de `idx` testé ici.
