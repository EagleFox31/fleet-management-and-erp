-- Avoirs clients (lot V1, PR5, D1) : colonne client_invoices.credited_amount_ttc et table client_credit_notes.
-- Un avoir est une note de crédit sur une facture émise : il baisse le solde (plafonné au solde, les remboursements
-- sont hors v1) et s'ajoute au cumul credited_amount_ttc. Montant payé = amount_ttc - credited_amount_ttc - balance.
-- Table immuable : UPDATE, DELETE et TRUNCATE refusés (check_violation, contrainte client_credit_notes_immutable,
-- traduite en 409 par server/lib/pg-errors.ts), levés pour une seule transaction par withMoneyOverride.
-- invoice_id en RESTRICT : une facture qui porte un avoir ne se supprime pas (sauf levée du verrou).
-- La règle de credited_amount_ttc dans le trigger des factures est posée par 20261110_money_lock_invoices_credits.sql
-- (nom choisi pour être rejoué APRES 20261110_money_lock_invoices.sql, qui ne connaît pas cette colonne).
-- Rétroactif et idempotent : aucune donnée réécrite (les factures existantes ont 0 d'avoir). Rejoué à chaque
-- démarrage par server/init-database.ts (applyMigrationSqlFiles) ; même SQL porté par CLIENT_CREDIT_NOTES_SQL
-- (AGENTS.md §5), comparé par tests/unit/server/client-credit-notes-schema.test.ts.
-- Retour arrière, dans cet ordre (sinon le démarrage suivant repose la table) :
--   1. retirer CLIENT_CREDIT_NOTES_SQL et son appel de server/init-database.ts, puis ce fichier ;
--   2. retirer la règle credited_amount_ttc de fn_client_invoices_issued_lock (20261110_money_lock_invoices_credits.sql) ;
--   3. DROP TABLE IF EXISTS client_credit_notes (sous withMoneyOverride) ; ALTER TABLE client_invoices DROP COLUMN IF EXISTS credited_amount_ttc.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

DO $do$
BEGIN
  -- ALTER TABLE prend un verrou exclusif même quand la colonne existe : on ne le demande que si elle manque.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'client_invoices' AND column_name = 'credited_amount_ttc'
  ) THEN
    ALTER TABLE client_invoices ADD COLUMN credited_amount_ttc numeric(15,2) NOT NULL DEFAULT 0;
  END IF;
END $do$;

CREATE TABLE IF NOT EXISTS client_credit_notes (
  id serial PRIMARY KEY,
  credit_note_number text NOT NULL UNIQUE,
  invoice_id integer NOT NULL REFERENCES client_invoices(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  amount_ht numeric(15,2) NOT NULL,
  vat_rate numeric(5,2) NOT NULL DEFAULT 0,
  vat_amount numeric(15,2) NOT NULL DEFAULT 0,
  amount_ttc numeric(15,2) NOT NULL,
  request_key text NOT NULL UNIQUE,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT client_credit_notes_amount_ht_positive CHECK (amount_ht > 0),
  CONSTRAINT client_credit_notes_ttc_sum CHECK (amount_ttc = amount_ht + vat_amount),
  CONSTRAINT client_credit_notes_reason_not_blank CHECK (length(btrim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_client_credit_notes_invoice_id ON client_credit_notes (invoice_id);

CREATE OR REPLACE FUNCTION fn_client_credit_notes_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Levée explicite pour la transaction en cours : restauration de sauvegarde, nettoyage de test, reset de recette.
  IF current_setting('fleetos.allow_money_override', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    ELSIF TG_OP = 'TRUNCATE' THEN
      RETURN NULL;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Avoir émis : il ne se modifie, ni ne se supprime.'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'client_credit_notes_immutable';
END;
$$;

-- Poser un trigger prend un verrou SHARE ROW EXCLUSIVE sur client_credit_notes : borné par lock_timeout, l'échec est toléré.
DO $do$
BEGIN
  CREATE OR REPLACE TRIGGER trg_client_credit_notes_immutable
  BEFORE UPDATE OR DELETE ON client_credit_notes
  FOR EACH ROW
  EXECUTE FUNCTION fn_client_credit_notes_immutable();

  CREATE OR REPLACE TRIGGER trg_client_credit_notes_truncate_lock
  BEFORE TRUNCATE ON client_credit_notes
  FOR EACH STATEMENT
  EXECUTE FUNCTION fn_client_credit_notes_immutable();
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'triggers d''immuabilité des avoirs non posés : verrou de table indisponible, nouvel essai au démarrage suivant';
END $do$;
