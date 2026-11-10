# Lot V1 : verrouiller l'argent (pleins validés, factures émises, avoirs)

Plan établi le 2026-11-10 sur main e7b0f5ba. Les numéros de ligne ci-dessous valent pour ce commit.

## Constats

### Pleins
- `fuel_records.validation_status` vaut `pending` ou `validated` (`schema.ts:535`), avec `validated_by` et `validated_at`. La seule transition est `pending` → `validated`, faite par `fuel-voucher-service.ts:22-26`.
- `init-database.ts:172-177` a passé tout l'historique à `validated`, avec `validated_by` à NULL : à afficher « Validé (reprise) ».
- **Écritures** :
  - `fuel-service.ts:77` : PATCH (`routes.ts:2638-2720`), qui ignore le statut ;
  - `fuel-service.ts:114` : suppression douce, puis `reverseFuelLink` ;
  - `fuel-service.ts:125` : suppression physique (DELETE de `server/api/fuel-records.routes.ts:148`) ;
  - `backup-import-service.ts:99` : vidage lors d'une restauration ;
  - `storage.ts:964` : code mort ;
  - action de clé étrangère `mission_id ON DELETE SET NULL`.
- Consommation et budget de mission : trigger AFTER `mission-fuel-triggers.sql`, qui filtre `deleted_at IS NULL`.

### Factures
- Les lignes sont en `items jsonb`. Les paiements sont dans `client_payments`. Toute facture est émise dès sa création (statut `pending`, pas de brouillon).
- **Écritures** :
  - INSERT : `client-billing-service.ts:156` ;
  - passage en retard : `:303` (`status`) ;
  - paiement : `:393` (`balance`, `status`) ;
  - dépôt : `finance-receivables-service.ts:166`, une seule fois ;
  - aucune route PATCH ni DELETE.
- Le statut `cancelled` n'est écrit par aucun code applicatif.
- Numérotation : `client-billing-service.ts:60-85` (`FACT-YYYYMMDD-NNN`, verrou advisory `invoice-<date>`).
- PDF : `pdf-generation-service.ts:30`.
- Le calcul « payé = TTC − solde » deviendra faux avec les avoirs :
  - `client-billing-service.ts:264,518,611` ;
  - `management-dashboard-service.ts:760` ;
  - `mission-invoices-tab.tsx:125`.

### Erreurs
- Précédent de trigger : `USERS_KEEP_ACTIVE_ADMIN_SQL` (`init-database.ts:1234-1263`), avec `check_violation` et une contrainte nommée. Le mapping est dans `pg-errors.ts:45-50`.
- Une `AppError(500, { cause })` qui enveloppe une erreur de trigger sort en 500 (`error-handler.ts:135`). Il faut un filet.

## Décisions
- **D1. Avoir : table `client_credit_notes`.**
  - Numéro `AV-YYYYMMDD-NNN`, `invoice_id` en RESTRICT, motif obligatoire, `amount_ht > 0`, contrainte TTC = HT + TVA, `request_key` unique, `created_by`. Table immuable.
  - Nouvelle colonne `client_invoices.credited_amount_ttc`, par défaut 0.
  - Création : verrouiller la facture (`FOR UPDATE`), 409 si le TTC de l'avoir dépasse le solde, puis baisser `balance`, augmenter `credited_amount_ttc` et recalculer le statut.
  - Montant payé : `ttc − credited − balance`.
  - CA net : on soustrait le HT des avoirs à la date de l'avoir.
- **D2. Triggers par liste blanche** (`to_jsonb(NEW) - cols IS DISTINCT FROM to_jsonb(OLD) - cols`).
  - Erreur `check_violation`, avec les contraintes `fuel_records_validated_locked`, `client_invoices_issued_locked` et `client_credit_notes_immutable`, traduite en 409.
  - Échappement : GUC `fleetos.allow_money_override`, posé seulement par `withMoneyOverride(tx, reason)`, qui journalise. Une garde d'hygiène le vérifie.
  - Pleins validés :
    - DELETE refusé ;
    - colonnes libres : `updated_at`, `updated_by` ;
    - `mission_id` seulement vers NULL ;
    - `deleted_at`, `deleted_by` et `cancellation_reason` une seule fois, de NULL vers une valeur, avec un motif non vide.
  - Factures :
    - DELETE refusé ;
    - colonnes libres : `status`, `balance`, `updated_at` ;
    - `credited_amount_ttc` seulement à la hausse, au plus égal au TTC ;
    - colonnes de dépôt seulement si `OLD.deposited_at IS NULL`, et `deposited_by` peut passer à NULL.
- **D3. Correction d'un plein : annulation tracée.**
  - On réutilise la suppression douce, à laquelle on ajoute la colonne `cancellation_reason`.
  - Route `POST /api/fuel-records/:id/cancel`.
  - Les effets sont déjà en place : KPI, budget de mission et contre-passation en trésorerie.
- **D4. Le PATCH reste dans `routes.ts`.**
  - La garde 409 va dans `FuelService.updateFuelRecord`, ce qui n'ajoute aucune ligne à `routes.ts`.
  - Écart à la consigne « routeur qui masque » : le masquer obligerait à recopier environ 80 lignes. Le déplacement peut faire l'objet d'un lot à part.

## Découpage
1. **PR1, outillage** :
   - 409 sur les contraintes de verrou, y compris dans une `cause` ;
   - `withMoneyOverride` ;
   - helpers de nettoyage des tests, qui remplacent les DELETE directs de `client_invoices` et `fuel_records` dans tests/, e2e/ et scripts/ ;
   - garde d'hygiène.
   - Rouge : `toHttpError` donne 500 au lieu de 409.
2. **PR2, pleins (service)** :
   - 409 sur PATCH et DELETE d'un plein validé ;
   - `cancelFuelRecord` et sa route ;
   - écrans : masquer Modifier et Supprimer, proposer Annuler.
3. **PR3, trigger des pleins** : migration, SQL jumeau dans `init-database.ts`, test de parité, intégration.
4. **PR4, trigger des factures** : idem, plus la correction des tests qui écrivent des colonnes gelées.
5. **PR5, avoirs (serveur)** : table, numéro (`nextDailyNumber` extrait), service, routes, PDF, montant payé, CA.
6. **PR6, écrans des avoirs.**

## Décisions de 0a (2026-11-10)
- **a. D4 accepté.** La garde va dans `FuelService.updateFuelRecord`. Un contrat prouve le 409 en passant par la route réelle de `routes.ts`. Backlog : déplacer le PATCH des pleins dans `server/api`, dans un lot séparé.
- **b. Avoir sur une facture déposée : refusé (révisé le 2026-11-10, option a « base nette »).** Remplace « autorisé ».
  - Avoir émis avant le dépôt : les retenues et le net à payer se calculent sur HT et TTC diminués des avoirs (retenue TVA sur le HT net, retenue IS sur sa base nette), donc net à payer ≤ solde.
  - Avoir émis après un dépôt non soldé : 409 « Facture déposée : l'avoir n'est pas encore possible, net à payer figé. » (fail-closed). Facture déposée et soldée : refusée par le plafond au solde.
  - Le PDF de l'avoir cite la facture d'origine et son numéro de dépôt.
- **c. Annulation d'un plein sur un budget de mission soldé : 409.** Message : « Le budget de la mission est soldé : l'annulation n'est plus possible, contactez la comptabilité. »
- **d. Remboursement : hors v1.**
  - L'avoir est plafonné au solde de la facture.
  - Ajouter une ligne au backlog, et une au journal QA à soumettre au client.
- **e. `cancelled` reste possible en base.** Le trigger le traite comme un statut terminal : aucune sortie, aucune modification de montant.

### Réserves
1. Aucune route HTTP ne lève le verrou, sauf une exception assumée (décision de 0a, 2026-11-10) : la restauration de sauvegarde. `server/services/backup-import-service.ts` appelle `withMoneyOverride(tx, "restauration de sauvegarde")` avant de vider `fuel_records`, et `server/api/admin-import-backup.routes.ts` (`POST /admin/import-backup`, `isAdmin`) l'atteint. Le motif est journalisé. La garde d'hygiène l'interdit ailleurs dans `server/api/**` et `server/routes.ts`, et fige que cette route est la seule à atteindre `backup-import-service` (scan des imports de `server/**`). Toute autre levée exige de modifier cette liste blanche, donc une revue.
2. Les PR 2 et 3 (pleins) passent en priorité : b7 attend ce verrou pour activer fuel-vouchers. Prévenir b7 à la fusion.
3. aa modifie `generateInvoiceFromMission` (vers la ligne 118) : éviter tout conflit sur ce fichier.
4. Revue sécurité obligatoire sur les PR 2 à 5. Envoyer à 0a chaque SHA final.
5. Avant la fusion de la PR 3, 0a compte en production, en lecture seule, les pleins validés et les factures émises.
6. **PR3 posée (2026-11-10, branche `c7-v1-fuel-trigger`)** : trigger BEFORE UPDATE OR DELETE `trg_fuel_records_validated_lock` (migration `20261110_money_lock_fuel.sql`, jumelle `FUEL_RECORDS_VALIDATED_LOCK_SQL`, parité par `tests/unit/server/fuel-records-lock-schema.test.ts`). Aucune donnée réécrite : les pleins déjà validés deviennent protégés. Écritures légitimes recensées dans `server/` : validation (`fuel-voucher-service.ts`, ligne en attente), annulation (`cancelFuelRecord`, liste blanche), `ON DELETE SET NULL` de la mission, restauration (`withMoneyOverride`). `storage.ts:964` (`deleteVehicle`, sans appelant) serait refusé sur un véhicule portant un plein validé : voulu.
   - Revue sécurité (#633) : `mission_id` vers NULL seulement par l'action de clé étrangère (`pg_trigger_depth() > 1`) ; trigger `BEFORE TRUNCATE ... FOR EACH STATEMENT` (`trg_fuel_records_truncate_lock`, même levée) ; `SET LOCAL lock_timeout = '5s'` avec refus toléré (`lock_not_available` → WARNING, relu dans `pg_trigger` et journalisé par `init-database`, nouvel essai au démarrage suivant). Aucun TRUNCATE dans les helpers de nettoyage ni dans la restauration (DELETE) : rien à adapter.
   - F3 (même PR) : la validation d'un bon ne touche qu'un plein `pending` non supprimé, et, si l'écran envoie la `version` affichée, inchangé depuis ; sinon 409 « Ce plein a changé ou est déjà validé : rechargez la liste. »

## Backlog (PR2)
- Déplacer le `PATCH /api/fuel-records/:id` de `server/routes.ts` vers `server/api/fuel-records.routes.ts` (lot séparé) ; la garde du plein validé vit déjà dans `FuelService.updateFuelRecord`.
- Budget de mission soldé : « soldé » = `mission_budgets.settled_at` non nul (seule notion de clôture existante, Q18).

## Avancement PR4 (factures émises)
- **Posée le 2026-11-10, branche `c7-v1-invoice-trigger`** : trigger BEFORE UPDATE OR DELETE `trg_client_invoices_issued_lock` (migration `20261110_money_lock_invoices.sql`, jumelle `CLIENT_INVOICES_ISSUED_LOCK_SQL`, parité par `tests/unit/server/client-invoices-lock-schema.test.ts`), contrainte `client_invoices_issued_locked`, 409 par `moneyLockMessageOf`. Aucune donnée réécrite.
- Liste blanche : `status`, `balance`, `updated_at` ; dépôt (`deposited_at`, `withholding_vat_amount`, `withholding_is_amount`, `net_payable`, `deposited_by`) posé une seule fois, avec date et auteur, sur une facture en attente de paiement avant et après l'`UPDATE` (ni payée, ni annulée), comme `depositInvoice`. Solde : en baisse seulement, jamais sous zéro (une hausse rouvrirait une facture payée) ; `recordPayment` arrondit le nouveau solde au centime et le borne à 0. Avoirs (PR5) : ajouter `credited_amount_ttc` au tableau `free_cols` et sa règle à l'emplacement marqué dans la fonction.
- `cancelled` terminal (décision e) : ni sortie, ni solde, ni dépôt. Suppression et `TRUNCATE` refusés (`trg_client_invoices_truncate_lock`), levée par `withMoneyOverride` seulement.
- Clés étrangères : `mission_id`, `client_id`, `created_by` en NO ACTION (la clé refuse déjà la suppression du parent) ; seul `deposited_by` (ON DELETE SET NULL) écrit la table depuis une action référentielle, admis par `pg_trigger_depth() > 1` quand rien d'autre ne change.
- Factures sans client ni mission : admises à la création, gelées ensuite. Les tests qui posaient client, mission ou dépôt par un UPDATE les posent désormais à l'insertion (`createTestClientInvoice`).

## Avancement PR5 (avoirs clients)
- **Posée le 2026-11-10, branche `c7-v1-credit-notes`** (empilée sur `c7-v1-invoice-trigger`, #641). Table `client_credit_notes` immuable (trigger `client_credit_notes_immutable`, migration `20261110_client_credit_notes.sql`, jumelle `CLIENT_CREDIT_NOTES_SQL`), colonne `client_invoices.credited_amount_ttc` (monte seulement, au plus `amount_ttc`), fonction de verrou des factures remplacée par `20261110_money_lock_invoices_credits.sql` (nommée pour se trier après les deux autres migrations).
- Cohérence statut / solde ajoutée au trigger des factures (demande 0a) : une facture payée ne repasse pas en attente, partielle ou en retard ; payée exige un solde nul ; un solde nul impose payée (sauf annulée). Cycle légitime relu : `recordPayment` (payée seulement à solde 0), passe des retards (solde > 0), `createCreditNote` (`statusAfterBalanceChange`).
- Service `createCreditNote` (une transaction, `FOR UPDATE`, rejeu par `request_key`, plafonné au solde, 409 sur annulée ou soldée), numérotation `nextDailyNumber` partagée avec les factures, PDF `generateCreditNotePDF`, routes sous `/api/billing`, événement `client_credit_note_created` (rôles de facturation, jamais client).
- Lecteurs « payé » corrigés (`paidTtcOf`) ; CA net = facturé HT moins HT des avoirs à la date de l'avoir (tableau de bord direction, CA par client).
- Remarque PR6 : écran d'émission et de consultation des avoirs, affichage de `creditedAmountTtc` ; `.gitattributes` `*.sql text eol=lf` en PR séparée (les migrations sont en CRLF sous Windows).

## Backlog (PR5)
- **Remboursements hors v1** : un avoir est plafonné au solde de la facture ; rembourser un client qui a déjà payé n'est pas géré. À soumettre au client (journal QA).
- Le PDF cite la date de dépôt de la facture : aucun numéro de dépôt n'existe en base.
- **Recalcul du net à payer figé par un avoir postérieur au dépôt** : aujourd'hui refusé (409). À reprendre si le client veut émettre des avoirs sur des factures déposées.
- Le trigger des factures n'a pas été modifié par cette révision.
