# Registre de propriété des fichiers — lot recette du 2 novembre 2026

À lire par les deux sessions (lot et tests) avant chaque PR. Conventions : [ADR 0001](0001-lot-recette-2026-11-02.md).

Un fichier a **un seul propriétaire**. Un autre agent qui a besoin d'une modification la demande
au propriétaire, ou attend sa PR.

## Fichiers chauds

| Fichier | Propriétaire | Règle |
|---|---|---|
| `shared/schema.ts`, `server/init-database.ts`, `server/db/migrations/20261031_*` | DB | Une PR de schéma (T-07) avec toutes les tables du lot, puis PR d'amendement DB seulement. |
| `server/api/index.ts` | Architecte | Pré-câblé en T-08 : tous les routeurs du lot montés vides, intercepteurs passe-plat. |
| `package.json`, lockfile | Architecte | Dépendances ajoutées en T-02 (`docx`, `msw` en dev ; `altcha-lib` et `altcha` retirées avec le captcha). |
| `shared/feature-flags.ts`, `server/lib/feature-flags.ts` | Architecte | Clés listées dans l'ADR §6. |
| `shared/contracts/*` | Architecte et API | Figés à M0. Ensuite : ajout optionnel seulement, ou PR architecte dédiée. |
| `shared/contracts/realtime-events.ts` | API | Tout nouvel événement y est déclaré. |
| `client/src/App.tsx`, `client/src/components/layout/sidebar.tsx` | Frontend | Pré-câblé en T-09 : routes et menu vers des pages vides, derrière drapeaux. |
| `client/src/hooks/useRealTimeSync.ts` | Frontend | Seul consommateur des événements. |
| `client/src/mocks/*` | Frontend | Données simulées tirées des contrats (T-09b). |
| `server/services/alert-service.ts` | Backend | Modifié uniquement par T-17 ; les autres appellent ses fonctions publiques. |
| `docs/adr/*` | Architecte | |

Les écrans produits par l'architecte ou l'agent produit (T-36, T-51, T-53) ne touchent que leurs
pages pré-déclarées.

## Fichiers interdits à l'équipe du lot

| Fichier | Raison |
|---|---|
| `server/routes.ts`, `server/storage.ts` | Dette gelée (AGENTS.md §9) ; propriété de la session de tests. |
| `tests/**` existants, `e2e/01` à `e2e/09` | Suites de la session de tests. Les tests du lot sont dans des fichiers nouveaux. |
| `server/services/part-requirements-service.ts` | Bloqué jusqu'à la fusion, par la session de tests, de ses changements en cours (porte P-16, T-04). |
| `server/_archive/`, variantes `vehicle-*-service-*.ts` | Code mort. |

## Fichiers partagés annoncés

| Fichier | Qui | Changement | Quand |
|---|---|---|---|
| `server/services/fuel-card-service.ts` | API (T-44) | Une ligne : prix 828 en dur remplacé par la lecture du prix daté. | Rebase en dernier dans sa fenêtre. |
| `server/api/missions.routes.ts` | API (T-44) | Une ligne, même changement. | Idem. |
| `server/lib/audit-log-row.ts`, `server/api/audit-logs.routes.ts`, `server/api/work-order-audit-trail.routes.ts` | API (T-39) | Mappage ligne de journal vers contrat extrait de T-15 et partagé avec l'historique d'OT. | Rebase sans effet de bord. |
| `server/api/vehicle-documents.routes.ts` (nouveau) | API (T-16b) | Upload des documents véhicule, déplacé de `server/routes.ts` (suppression du seul handler, accord de l'utilisateur). | Rebase sans effet de bord. |
| Préfixes `/warehouse`, `/fuel-card`, `/drivers`, `/missions`, `/clients`, `/operations`, `/part-requirements` dans `server/api/index.ts` | API (T-62), via l'architecte | Garde `isStaff` au montage. | Lot sécurité, samedi 14 h. |

## Agents et worktrees

| Agent | Worktree | Branche Neon de test |
|---|---|---|
| Architecte | `../fm-sol` | `test-sol` |
| Base de données 1 et 2 | `../fm-db-1`, `../fm-db-2` | `test-db-1`, `test-db-2` |
| Backend 1 et 2 | `../fm-be-1`, `../fm-be-2` | `test-be-1`, `test-be-2` |
| API 1 et 2 | `../fm-api-1`, `../fm-api-2` | `test-api-1`, `test-api-2` |
| Frontend 1 et 2 | `../fm-fe-1`, `../fm-fe-2` | `test-fe-1`, `test-fe-2` |
| Produit | `../fm-pe` | `test-pe` |
| Agent de test (session tests) | son propre dépôt de travail | sa branche actuelle |

## Fenêtres de fusion

Vendredi 23 h 30 ; samedi 10 h, 14 h, 18 h, 22 h ; dimanche 10 h, 14 h, 18 h ; gel dimanche 20 h.

Ordre dans une fenêtre : PR de la session de tests d'abord, puis celles du lot dans l'ordre du
graphe (contrats, schéma, serveur, écrans, e2e).

## Fichiers touchés par fe-3 (branche `lot/fe/T-3xb-api-reelle`)

`client/src/components/profile/notification-preferences.tsx`, `client/src/components/vehicles/vehicle-documents.tsx`,
`client/src/components/billing/pending-invoices-table.tsx`, `client/src/components/dashboard/kpi-tiles.tsx`,
`client/src/pages/admin/dashboard.tsx`, `client/src/pages/management/dashboard.tsx` (une ligne : `KpiTiles`),
`shared/constants/roles.ts` (ajout : `KPI_VIEWER_ROLES`, `canViewKpi`), `tests/unit/client/pending-invoices-kpi-roles.test.ts` (nouveau), `docs/journal/fe-1.md`.
