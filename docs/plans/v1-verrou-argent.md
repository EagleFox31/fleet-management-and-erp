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
- **b. Avoir sur une facture déposée : autorisé.**
  - `net_payable` reste figé et l'avoir réduit le solde.
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

## Backlog (PR2)
- Déplacer le `PATCH /api/fuel-records/:id` de `server/routes.ts` vers `server/api/fuel-records.routes.ts` (lot séparé) ; la garde du plein validé vit déjà dans `FuelService.updateFuelRecord`.
- Budget de mission soldé : « soldé » = `mission_budgets.settled_at` non nul (seule notion de clôture existante, Q18).
