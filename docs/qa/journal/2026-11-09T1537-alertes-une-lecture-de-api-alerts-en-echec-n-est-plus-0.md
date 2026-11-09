## 2026-11-09T15:37:39+01:00 — Alertes : une lecture de `/api/alerts` en échec n'est plus « 0 alerte »

- **Statut** : fait (PR brouillon #607)
- **Quoi** :
  - trois écrans lisaient `GET /api/alerts` sans état d'erreur : tableau de bord secrétaire, centre d'alertes, résumé des alertes du tableau de bord. En échec, ils affichaient « 0 alerte », « Aucune alerte récente » ou « Tout est à jour » ;
  - secrétaire : tuile « Alertes actives » à « Indisponible », rappel « Alertes indisponibles », bannière masquée ;
  - centre d'alertes : encart d'erreur, compteurs à « Indisponible » (total, critiques et stock aussi quand la réappro échoue : pas de compte partiel), état vide présenté comme partiel, couleurs des compteurs conditionnées à leur disponibilité ;
  - résumé : encart avec « Réessayer », « Voir toutes » sans compte ;
  - `listQueryView` rejoint `client/src/lib/query-view.ts` ; `work-order-tires-cost.ts` le ré-exporte (importeurs inchangés).
- **Comment tester (QA)** :
  - `tests/unit/client/alerts-reads-error-states.test.ts` : 9 cas, 7 rouges sur main (7053ecda), 9 verts sur la branche ;
  - `tests/unit/client/money-stock-reads-error-states.test.ts` : la garde de #599 accepte `reorderAlertsFailed || alertsFailed ?` et exige toujours la condition réappro ;
  - campagnes : tsc 0, check:tests 0, unitaires verts (hors `db-pool-options`, échec local connu, vert en CI). Aucun fichier serveur modifié.
- **RAIDER** : R : un helper générique pour les trois écrans ; D : ré-export à signature identique, aucun `data-testid` retiré. Ne s'appliquent pas : A, I, Retroactive (client seul, lecture seule).
- **Reste / risques** : le reste du tableau de bord secrétaire (factures, documents, CPC, statistiques par client) traité dans la PR suivante, empilée sur #607.

