## 2026-11-09T16:50:00+01:00 — Statistiques plafonnées : OT, inventaire et OT en attente de pièces calculés sur toutes les lignes

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `GET /api/statistics/work-orders` : comptes pending / in_progress / completed / total par agrégat SQL (`group by status`) au lieu des 50 derniers OT ; `total` = tous les OT, tous statuts (awaiting_parts et cancelled inclus), comme la longueur de liste d'origine ;
  - `GET /api/reports/inventory` : `totalParts`, `totalValue`, `lowStockCount` par agrégat SQL (NULL traité comme 0, même règle que `(quantity||0) <= (minQuantity||0)`), pièces lues sans plafond, mouvements filtrés par période en SQL ; 422 au-delà de `INVENTORY_REPORT_MAX_PARTS` (5 000) ; forme de réponse inchangée (lue par `pdf-export.ts`) ;
  - `GET /api/work-orders/awaiting-parts` : liste complète, 422 « Trop d'OT en attente de pièces pour un affichage complet (N). » au-delà de `AWAITING_PARTS_MAX` (500) ; l'enrichissement garde des caches de promesses (un cache de valeurs, rempli après `await`, lançait N lectures simultanées du même véhicule : 500 dès une centaine d'OT) ;
  - les trois handlers sortent de `server/routes.ts` (suppressions seules) vers `server/api/capped-statistics.routes.ts`, monté avant tout routeur `/work-orders` ; rôles inchangés (`isStaff`, `isInventoryReportReader`) ; erreurs en `AppError`, `console.*` migrés vers `moduleLogger("capped-statistics")`.
- **Comment tester (QA)** : `tests/contract/capped-statistics.contract.test.ts` (OT > 50 par statut, pièces > 50 dont seuil NULL, témoin de moins de 50 lignes, 101 OT en attente, 422 aux deux bornes, 403 client / technicien). Rouge prouvé sur le code d'origine (compte à 0 d'écart au lieu de 23, 45 pièces au lieu de 61, 200 au lieu de 422, 500 sur 101 OT), vert après correctif.
- **RAIDER** : R : bornes en constantes exportées, routeur fabriqué avec limites injectables ; D : forme de réponse et rôles figés par contrat ; I : lectures seules.
- **Reste / risques** : `min_quantity` est NOT NULL en base, le test lève la contrainte le temps du passage pour prouver le traitement du NULL (tâche `fleet-db` si l'on veut le rendre définitif). `totalValue` est sommé en `numeric` : exact, là où la somme JS en flottants pouvait différer au dernier chiffre.

### Compléments (2026-11-10)

- **Quoi** :
  - `procurement/invoices/[id]` : « Enregistrer un paiement » et l'aide de rapprochement exigent des règlements lus (`settlementsData !== undefined`) ; pendant la première lecture, la liste de repli vide proposait le solde entier ;
  - `fuel/index` : la tuile « Véhicules suivis » lit « Indisponible » + message de l'erreur quand la lecture des pleins échoue, sur la même garde que les autres tuiles de pleins ;
  - contrat `capped-statistics` : la contrainte NOT NULL de `parts.min_quantity` n'est plus levée pour toute la durée du fichier mais cas par cas (`withNullableMinQuantity`), rétablie dans un `finally` immédiatement après le cas ; `afterAll` reste en filet.
- **Pourquoi pas une transaction annulée** : la route lit par une autre connexion, qui ne voit pas une insertion non validée ; de plus `DROP NOT NULL` pose un verrou exclusif qui bloquerait les lectures de `parts` des autres sessions sur la base partagée pendant la transaction.
- **Comment tester** : `tests/unit/client/invoices-render-error-states.test.ts` (« règlements en chargement »), `tests/unit/client/fuel-card-render-error-states.test.ts` (« Véhicules suivis », échec + témoin). Rouge prouvé garde retirée (bouton présent ; « 0 » au lieu de « Indisponible »), vert après correctif. Le contrat est joué par la CI (non lancé en local).
