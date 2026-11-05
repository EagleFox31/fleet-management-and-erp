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

## Filtrage des champs finance étendu aux jointures (2026-11-05)

- **Quoi** : les taux de retenue du client, ainsi que les retenues et le net figés de la facture, ne sortent plus par les lectures hors finance. Cela couvre les missions et la création de mission depuis un plein, la facturation client (liste, détail, création, PDF), les exports et le tableau de bord de direction.
- **Comment** : une projection publique unique, `server/lib/client-public-columns.ts` (`publicClientColumns`, `publicClientInvoiceColumns`), est passée à `select()` et `returning()`. La trame `mission_created_from_fuel` part au personnel (`STAFF_ROLES`), plus en `broadcast`. `/api/clients` garde son filtrage par rôle.
- **Pourquoi** : les colonnes ajoutées par le lot arrivaient avec toute lecture entière de `clients` ou `client_invoices`.
- **Prévention** : `tests/unit/server/client-finance-select-hygiene.test.ts` échoue sur toute lecture entière de ces tables (`select()` vide, `{ x: clients }`, `getTableColumns`, `returning()` vide) hors liste blanche justifiée. La liste gelée de `broadcast-hygiene` perd une entrée.
- **Preuves** : `tests/contract/client-finance-fields-scope.contract.test.ts` vérifie la réponse et la trame de la création de mission (aucun compte client destinataire), `GET /api/operations/missions` côté chauffeur affecté et côté logistique, et `GET /api/billing/invoices` et `/:id` côté logistique. Sans la projection, 3 des 4 tests échouent.

## La logistique lit les champs finance (décision du 2026-11-05)

- **Quoi** : la logistique voit en lecture seule les retenues, le net à payer et les taux par client. Cela couvre `/api/finance/invoices-awaiting-payment`, la fiche et la liste `/api/clients`, les trames `client_invoice_deposited` et `client_withholding_updated`, ainsi que l'écran « Factures en attente de paiement », où les boutons sont masqués. L'écriture (dépôt, taux) reste réservée à l'administration et au secrétariat.
- **Comment** : `logistics` est ajouté à `FINANCE_RECEIVABLE_READ_ROLES` (`shared/constants/roles.ts`), qui est la source unique. Les routes, `forViewer`, les portées des trames et l'écran en dérivent.
- **Pourquoi** : c'est la décision de l'utilisatrice. Le fichier « SUIVI OPERATION & FACTURATION » de la logistique porte déjà la TVA retenue, l'acompte et le solde net.
- **Hors périmètre** : les projections publiques de facturation et des missions (`client-public-columns`) ne portent aucun champ finance, quel que soit le rôle, administrateur compris. Elles restent inchangées, et la lecture finance passe par les routes ci-dessus.
- **Preuves** : `finance-receivables.contract.test.ts` vérifie que la logistique lit (200), reçoit 403 en écriture, et voit les taux sur la fiche client. Le technicien et le chauffeur ne les voient pas.

## Garde-fou des champs finance : angles morts fermés (2026-11-05, suite de #472)

- **Quoi** : `client-finance-select-hygiene` repère désormais d'autres façons de lire les tables `clients` et `client_invoices` en entier :
  - `getTableColumns(...)` placé hors d'une projection ;
  - la table nommée par espace de noms (`schema.clients`) ;
  - les noms qui masquent la table : import renommé (`import { clients as c }`), accès par crochets (`schema["clients"]`) et copie locale (`const t = clients;`). Ces trois formes sont interdites sans exception.
  
  Côté contrat, `POST /api/clients` ignore les taux envoyés : la fiche reste en base HT, avec des taux nuls.
- **Comment** :
  - le préfixe d'espace de noms est accepté partout où la table est cherchée ;
  - les espaces de noms sont lus dans `import * as X from ".../shared/schema"` ;
  - les deux `getTableColumns` de `client-public-columns.ts` sont en liste blanche, avec leur justification.
- **Pourquoi** : la relecture sécurité de #472 a relevé ces formes. Chacune contournait le détecteur sans que la fuite change.
- **Limite connue** : un nom passé par paramètre de fonction (`function f(t = clients)`) ou par déstructuration n'est pas suivi. La relecture reste le filet.
- **Preuves** : cas de détecteur positifs et négatifs dans le test unitaire. `finance-receivables.contract.test.ts` vérifie le POST pour l'administration, le secrétariat et la logistique.

## 2026-11-05 — Relevé de compte client (GET /api/clients/:id/statement)
- **Quoi** : relevé d'un donneur d'ordre. Les factures TTC sont au débit et les paiements au crédit, avec un solde courant calculé en SQL par une fonction fenêtre. Le solde d'ouverture est celui de la veille de `from`. Les factures annulées sont exclues avec leurs paiements. Contrat : `shared/contracts/client-statement.ts`.
- **Droits** : la route est derrière `isAnyUser`, puis `canAccessOwned` (cloison §11), puis les rôles de lecture finance. Un compte client reçoit 403 hors périmètre, avec le même message pour un id absent : aucun compte utilisateur n'est rattaché à une fiche `clients`. Le routeur est monté avant `/clients` (`isStaff`) pour que cette cloison s'applique.
- **Champs finance** : la réponse ne porte que `client.id` et `client.name`, sans aucun taux de retenue. Les retenues restent sur l'écran des factures en attente.
- **Limite connue** : le jour où une fiche client sera rattachée à un compte, il faudra brancher `statementOwner` sur ce lien. Deux conditions : (a) ajouter le rôle `client` à `FINANCE_RECEIVABLE_READ_ROLES`, sans quoi le contrôle de rôle suivant renverra toujours 403 ; (b) `statementOwner` devra renvoyer l’`users.id` rattaché à la fiche, jamais `clients.id`, car `canAccessOwned` compare à `req.user.id` et deux tables d’identifiants qui se recoupent ouvriraient un accès par collision d’identifiant (IDOR).
- **Preuves** : `client-statement.contract.test.ts` (15 cas : droits par rôle, 401/403/404/400, solde courant, période, annulation). La route est inscrite à `COVERED_ELSEWHERE` du balayage de cloison.
