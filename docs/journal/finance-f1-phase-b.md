# Finance F1 phase B : factures en attente de paiement, retenues à la source

## Quoi

- Le client porte maintenant ses taux de retenue : TVA retenue (`withholding_vat_rate`), IS retenu (`withholding_is_rate`, en %, `NULL` = pas de retenue), et la base de l'IS (`withholding_is_base` : `ht` ou `ttc`, `ht` par défaut).
- La facture client gagne `deposited_at`, la date de dépôt chez le client, plus les retenues figées à cette date (`withholding_vat_amount`, `withholding_is_amount`, `net_payable`).
- Trois routes, derrière le drapeau `finance` :
  - `GET /api/finance/invoices-awaiting-payment` liste les factures `pending`, `partial` et `overdue`. Chaque ligne donne ses retenues, le net à payer et le nombre de jours depuis le dépôt ; la réponse inclut les totaux.
  - `PATCH /api/finance/invoices-awaiting-payment/:id/deposit` enregistre le dépôt et fige les retenues.
  - `PATCH /api/finance/clients/:id/withholding` modifie les taux d'un client.
- Rôles :
  - lecture par `admin`, `management` et `secretary` (`FINANCE_RECEIVABLE_READ_ROLES`) ;
  - écriture par `admin` et `secretary` (`FINANCE_RECEIVABLE_WRITE_ROLES`).
- Temps réel : `client_invoice_deposited` et `client_withholding_updated`. Ils déclenchent la resynchronisation de la liste, de la facturation, des clients et du tableau de bord direction.

## Comment

- Le calcul des retenues reste dans un seul module, `shared/finance/withholding.ts` (phase A) ; le service ne refait aucun calcul.
- Tant que la facture n'est pas déposée, ses retenues sont calculées à la lecture avec les taux actuels du client. Au dépôt, elles sont recopiées sur la facture : une fois figées, aucun changement de taux ne les modifie.
- Le dépôt est idempotent :
  - rejouer la même date renvoie 200 sans écriture ni diffusion ;
  - une autre date sur une facture déjà déposée donne 409 ;
  - une date future ou antérieure à la date de facture donne 400.
- Le dépôt se fait en transaction avec `FOR UPDATE`.
- Schéma :
  - la migration `server/db/migrations/20261105_finance_withholding.sql` a un jumeau `FINANCE_WITHHOLDING_SQL` dans `server/init-database.ts`, et un test unitaire vérifie que les deux sont identiques ;
  - les colonnes sont ajoutées avec `ADD COLUMN IF NOT EXISTS` et les CHECK avec `NOT VALID` ;
  - la migration prend un verrou consultatif et un `lock_timeout` ;
  - elle ne contient ni `UPDATE`, ni `DELETE`, ni `DROP`.
- Les champs de retenue sont exclus des schémas Zod d'insertion. Les taux ne passent que par la route finance, jamais par la fiche client.

## Pourquoi

- La feuille Excel CNPCC suit à la main le net à encaisser et l'ancienneté du dépôt, et cet écran la remplace. Il faut figer les retenues au dépôt : c'est ce montant que le client retient réellement, même si ses taux changent ensuite.
- Les taux sont réservés à la finance, au moindre privilège : la logistique, qui édite la fiche client, ne doit pas pouvoir les modifier.
- La base de l'IS vaut `ht` par défaut. Elle suit l'arrêté MINFI/DGI du 05/01/2026, qui assied la retenue sur le HT, et reste en attente de la question client n°2. L'écran affiche la base de chaque ligne (`withholdingIsBase`) pour que l'écart reste visible si la réponse est TTC.

## Preuves

- `tests/unit/server/finance-withholding-schema.test.ts` couvre le SQL jumelé, l'appel au démarrage, les CHECK `NOT VALID` et les schémas d'insertion.
- `tests/unit/shared/invoices-awaiting-payment-contract.test.ts` couvre les corps des requêtes et la base IS.
- `tests/contract/finance-receivables.contract.test.ts` (22 tests) couvre :
  - 401 et 403 par rôle ;
  - le calcul sur base HT et sur base TTC ;
  - les retenues figées et les retenues calculées ;
  - l'idempotence du dépôt, le 409 et le 400 ;
  - les identifiants hors plage, les 404 et l'idempotence des taux.

## Restes

- Écran F1c : tableau `PremiumDataTable`, compteur de jours, totaux et bouton « Déposée le ».
- Hors F1, renvoyés à O1 et O2 : `advance_rate`, `sector`, `invoice_kind`, `parent_invoice_id`, `paid_at`, `filed_at`.

## Réserves de relecture et d'audit (2026-11-05)

Quoi, comment, pourquoi, point par point :

1. **Drapeau coupé** : le test de contrat vérifie le 404 sur les trois routes. Le drapeau est relu à chaque requête, il n'est pas figé au chargement.
2. **Concurrence** : deux dépôts simultanés à la même date renvoient deux 200 identiques ; à deux dates différentes, ils renvoient un 200 et un 409. C'est le `FOR UPDATE` qui sérialise. Un taux envoyé en chaîne (`"19.25"`) donne 400.
3. **Auteurs** : `client_invoices.deposited_by` et `clients.withholding_updated_by` prennent le compte connecté, avec une FK `users` en `ON DELETE SET NULL`. Une FK non bloquante n'entre pas dans `cleanup-users-fk-coverage`, qui ne recense que `NO ACTION` et `RESTRICT` ; la suppression d'un compte ne bloque donc pas et ne détruit aucune donnée finance. Ces colonnes sont omises des schémas d'insertion.
4. **Fuite des taux** : `/api/clients` renvoyait les taux de retenue à tout le personnel. La liste, la fiche, la création, la modification et la restauration les retirent désormais pour les rôles sans lecture finance (`canReadFinanceReceivable`). La diffusion WebSocket, qui part à tout le personnel, les retire toujours.
5. **CHECK** : ils sont posés `NOT VALID` puis passent par `VALIDATE CONSTRAINT`. Sur `check_violation`, un `WARNING` est émis et la contrainte reste `NOT VALID`, comme dans #122. Les trois CHECK sont ajoutés à `CDC_RECONCILED_CONSTRAINTS`.
6. **Totaux HT/TTC** : ils sont sommés en SQL `numeric` par une fenêtre `sum() OVER ()`, et non plus avec `Number()` en JS. Les retenues et le net restent des FCFA entiers.
7. **Facture sans client** : la liste passe en `LEFT JOIN`, donc une facture sans `client_id` est listée sans retenue (base `ht` par défaut). `clientId` et `clientName` deviennent nullables dans le contrat.
8. Espace manquant dans `= z.infer`.

Preuves : `finance-receivables.contract.test.ts` (32 tests), `finance-withholding-schema.test.ts`, `cdc-schema-idempotence` et `cleanup-users-fk-coverage` sont verts, plus les 5 contrats qui touchent `/api/clients` ; 2755 tests unitaires passent et tsc renvoie 0 erreur.
