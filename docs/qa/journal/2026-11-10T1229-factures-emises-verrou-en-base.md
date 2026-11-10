## 2026-11-10 12:29 - Factures clients émises : verrou en base (lot V1, PR4)

**Quoi.** Trigger `trg_client_invoices_issued_lock` (BEFORE UPDATE OR DELETE, par ligne) et `trg_client_invoices_truncate_lock` (BEFORE TRUNCATE, par instruction) sur `client_invoices`, contrainte `client_invoices_issued_locked`, traduite en 409 par `moneyLockMessageOf`. Une facture est émise dès sa création : rien ne s'y modifie hors liste blanche, rien ne se supprime.

**Comment.**
- Migration `server/db/migrations/20261110_money_lock_invoices.sql`, jumelle `CLIENT_INVOICES_ISSUED_LOCK_SQL` dans `server/init-database.ts` (appel, puis relecture de `pg_trigger` et WARNING si absent). Verrou consultatif de migration, `SET LOCAL lock_timeout = '5s'`, `lock_not_available` toléré en WARNING. `CREATE OR REPLACE` partout, aucune donnée réécrite.
- Liste blanche (`free_cols`) : `status`, `balance`, `updated_at`, et le dépôt (`deposited_at`, retenues, `net_payable`, `deposited_by`) posé une seule fois, avec date et auteur, sur une facture non annulée. Toute autre colonne, présente ou future, est gelée. PR5 ajoutera `credited_amount_ttc` à ce tableau, avec sa règle à l'emplacement marqué.
- `cancelled` terminal : ni sortie de statut, ni solde, ni dépôt.
- Clés étrangères : `mission_id`, `client_id`, `created_by` en NO ACTION, donc la clé refuse déjà la suppression du parent. `deposited_by` (ON DELETE SET NULL) passe par `pg_trigger_depth() > 1` quand rien d'autre ne change ; un futur trigger qui viderait cette colonne passerait aussi (commentaire dans la fonction).
- Factures sans client ni mission : admises à la création, gelées ensuite.
- Tests : `createTestClientInvoice` accepte tous les champs à l'insertion ; cinq contrats qui posaient client, mission ou dépôt par un UPDATE les posent désormais à la création. Nouveaux : intégration `client-invoices-lock-trigger` (12), contrat `client-invoices-lock` (cycle complet), parité `client-invoices-lock-schema`, hygiène `money-override-hygiene` élargie.

**Pourquoi.** Une facture émise est une pièce comptable : son montant, son client ou sa date ne doivent changer par aucun chemin (route, script, SQL direct). Le service refusait déjà certains cas ; la base devient l'arbitre quel que soit l'appelant. Une correction passe par un avoir.

**Preuve.**
- Rouge d'abord (trigger retiré de la migration, d'init-database et de la base) : intégration 10 en échec, 2 vertes (champs libres et cycle de vie, attendu). Vert : 12/12.
- Contrats facturation, trésorerie, créances, retenues, missions : 57 fichiers verts sur 58, 778/781 ; les 3 échecs (`mission-budget-expenses`, délais de 10 s sous charge) passent 21/21 seuls, fichier sans lien avec les factures. Nouveau contrat de cycle : 1/1.
- Intégration factures, trésorerie, tableaux de bord, recette : 11 fichiers, 55/55.
- `tsc --noEmit` : 0 erreur. `check:tests` : aucune erreur. Unitaires : 3783 verts, seul `db-pool-options` échoue (node_modules local, connu).
- Idempotence : migration rejouée deux fois sur la base locale, comptes, empreinte des lignes, définitions des triggers et de la fonction identiques avant et après.
