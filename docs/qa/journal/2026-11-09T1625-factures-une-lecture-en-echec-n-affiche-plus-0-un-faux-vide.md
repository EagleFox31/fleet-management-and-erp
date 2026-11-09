## 2026-11-09T16:25:00+01:00 — Factures : une lecture en échec n'affiche plus 0, un faux vide ni une somme partielle (5 écrans)

- **Statut** : fait (PR brouillon)
- **Quoi** :
  - `operations/invoices` : Total TTC, Payées, En attente, compteur et titre de liste lisent « Indisponible » ; la liste montre l'erreur (`userMessageOf`) au lieu de « Aucune facture trouvée » ;
  - `invoicing-dashboard` : l'échec de `/api/billing/statistics` a son état d'erreur ; le vrai vide garde « Aucune donnée disponible » (client seul, route inchangée) ;
  - `procurement/invoices` : `/statistics` en échec, Montant total, Dette et Payé lisent « Indisponible » (plus de repli sur les sommes de la liste, conservé seulement pendant le chargement) ; liste en échec, compteurs et « Écarts (n) » lisent « Indisponible » et le tableau montre l'erreur ;
  - `discrepancies` : les trois tuiles et la liste gardées par l'échec (fin des `|| 0`) ;
  - `procurement/invoices/[id]` : règlements illisibles, les trois boutons « Enregistrer règlement » sont masqués, Rapproché et Saisi non rapproché lisent « Indisponible », message d'erreur, pas d'indication de rapprochement. Le serveur refuse déjà le dépassement : non touché.
- **Comment tester (QA)** :
  - `tests/unit/client/invoices-render-error-states.test.ts` (12 cas : échec + témoin 12 345 par écran, vrai vide du dashboard, bouton `button-record-payment` absent en échec et présent au témoin) ;
  - rouge prouvé en forçant chaque garde à false : un cas échoue à chaque fois (« expected '0 FCFA' to be 'Indisponible' », « '99 000 FCFA' », « '0' », bouton présent), restauré, vert ;
  - `money-stock-reads-error-states.test.ts` : regex de garde des 5 fichiers.
- **RAIDER** : R : même constante `UNAVAILABLE` et même méthode de test que les autres écrans ; D : contrats et serveur inchangés.
- **Reste / risques** : `client-revenue-chart.tsx` lit aussi `/api/billing/statistics` (hors périmètre, non revu).
- **Ajout (fuel, même PR, après fusion de #613)** : volume consommé (`logistics/dashboard`, deux tuiles) et « Volume carburant » / « Litres consommés » / « Consommation totale » (`client/dashboard`) lisent « Indisponible » + `userMessageOf` quand `/api/fuel-records/statistics` ou le solde échoue ; sous-lignes `userMessageOf` sur `fuel-statistics` et sur les tuiles de pleins de `fuel/index`. Tests dans `fuel-card-render-error-states.test.ts` (18 cas), rouge prouvé (« expected '0 L' to be 'Indisponible' », « expected 1 to be 4 », sous-ligne fixe), restauré.
