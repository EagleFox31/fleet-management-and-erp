# Remorque d'affectation : suites de revue (#635)

## 2026-11-10 — Mineurs 3 à 7 et 9

**Quoi**
- Une remorque n'est plus acceptée comme camion : 400 lisible sur création de mission, PATCH et ajout d'affectation ; les listes « camion » des écrans de mission ne la proposent plus.
- La remorque attelée doit être éligible (statut, assurance, visite technique, plaque, récépissés), avec le même message que le camion.
- Conflit d'attelage : une remorque qui roule comme camion sur une affectation active (donnée ancienne) ne s'attelle pas ailleurs (409).
- PATCH sans `trailerId` conserve la remorque ; `null` la retire.
- O1 : la remorque reste préremplie après la fin de l'affectation (seules les affectations annulées ou refusées sont ignorées).
- Le suivi O1 se rafraîchit aussi au changement de statut et à la clôture de mission.
- Leçon consignée dans `docs/analysis/LESSONS_LEARNED.md`.

**Comment**
- `assertTruckIsNotTrailer` et l'éligibilité dans `server/services/trailer-assignment.ts`, appelés par les trois routes de `server/api/missions.routes.ts`.
- `VOID_ASSIGNMENT_STATUSES` dans `server/services/mission-operations-service.ts`.
- `client/src/lib/realtime-satellites.ts` pour le rafraîchissement.

**Pourquoi**
- Relecture de #635 par l'orchestrateur : points 3 à 7 et 9, à livrer après la fusion.

**Preuves**
- `tests/contract/mission-trailer-assignment.contract.test.ts` : 22 cas verts sur Postgres local.
- `tests/unit/client/realtime-satellites.test.ts` : nouveau cas O1.
