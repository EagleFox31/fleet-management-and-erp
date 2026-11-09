## 2026-11-09T11:51:18+01:00 — Argent et stock : une lecture en échec n'est plus un vide (8 lectures, écrans consommateurs)

- **Statut** : fait (PR brouillon)
- **Quoi** : 8 lectures renvoyaient `[]` ou `0` sur une erreur de base : `getParts`, `getAllStockMovements`, `getPartStockHistory`, `getPartsUsedForWorkOrder`, `getAllPartsUsed`, `getMaintenanceCost` (`storage.ts`), `getPartRequirements`, `getRequirementsByPartId` (`part-requirements-service.ts`). Une panne s'affichait comme « aucun mouvement », « 0 demande » ou un coût d'OT sous-évalué.
- **Comment** :
  - serveur : `storageLog.error({ err, … })` puis `AppError(500, message lisible, { cause })` ; les routes renvoient la 5xx normalisée avec sa référence ; `console.log` de ces fonctions migrés en `debug` ;
  - écrans : `queryView` / `listQueryView` + `InlineQueryError` ou « Indisponible » sur mouvements, demandes, accueil stock, tableau de bord magasin, activité récente, techniciens, nouvelle commande, dialogue de demandes d'une pièce, fiche OT ;
  - fiche OT : `workOrderDisplayCost` rend le coût pièces et le total inconnus si les pièces ne sont pas lues ; l'impression est refusée tant qu'elles ne le sont pas ; l'aperçu de demande ne promet plus « une demande sera créée » si la vérification a échoué ;
  - nouvelle commande : le préremplissage par URL n'est consommé qu'une fois les demandes lues ;
  - rapport PDF des coûts de maintenance : pièces d'OT ou ordres de travail illisibles → rapport refusé au lieu d'un total à 0 ou à l'estimation ; pièces lues une seule fois par OT.
- **Comment tester (QA)** :
  - `tests/unit/server/money-stock-reads-error.test.ts` : 8 lectures, rouges 8/8 sans le correctif serveur, vertes après ;
  - `tests/unit/client/money-stock-reads-error-states.test.ts` : 14 cas, rouges 14/14 sur les écrans d'avant ; `work-order-tires-cost.test.ts` : 3 cas pièces ;
  - cliquet `swallowed-read-catch-hygiene` : 48 → 40 ;
  - campagnes : tsc 0, check:tests 0, unitaires 318 fichiers / 3298 tests, contrats pièces/stock/demandes 19 fichiers / 227 tests sur Postgres local.
- **RAIDER** :
  - R : `queryView`, `listQueryView`, `InlineQueryError`, `formatKnownCost` existants ;
  - D : réponses de succès inchangées ; contrats verts ;
  - failure memory : leçon du 2026-11-07 (#591) appliquée, pas de nouvel incident.

  Ne s'appliquent pas : A, I, Retroactive (aucune donnée ni schéma touchés).
- **Reste / risques** : `warehouse.reorderAlerts` (`useWarehouse.ts`) expose une erreur que 5 tableaux de bord ignorent (`|| 0`) ; `/api/part-requirements/active-by-part` garde un `= {}` par défaut (lecture hors de ce lot). Revue sécurité requise (argent/stock).

