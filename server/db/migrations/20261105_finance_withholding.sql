-- Retenues à la source (lot F1) : taux et base par client, date de dépôt et retenues figées par facture.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté
-- par FINANCE_WITHHOLDING_SQL (AGENTS.md §5), comparé par tests/unit/server/finance-withholding-schema.test.ts.
-- Rétroactif : colonnes ajoutées à NULL (base IS à 'ht', repli en attente de la question client n°2),
-- aucune donnée modifiée ni supprimée. CHECK en NOT VALID : les lignes existantes ne bloquent pas.
-- Retour arrière : retirer FINANCE_WITHHOLDING_SQL et son appel, ce fichier et les colonnes de
-- shared/schema.ts, déployer, puis ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_withholding_*_check,
-- DROP COLUMN IF EXISTS withholding_vat_rate, withholding_is_rate, withholding_is_base ;
-- ALTER TABLE client_invoices DROP COLUMN IF EXISTS deposited_at, withholding_vat_amount, withholding_is_amount, net_payable;
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_vat_rate numeric(5,2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_is_rate numeric(5,2);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_is_base text NOT NULL DEFAULT 'ht';
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS deposited_at date;
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS withholding_vat_amount numeric(15,2);
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS withholding_is_amount numeric(15,2);
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS net_payable numeric(15,2);
ALTER TABLE client_invoices ADD COLUMN IF NOT EXISTS deposited_by integer;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS withholding_updated_by integer;
DO $$
DECLARE
  c record;
  f record;
BEGIN
  -- Auteur du dépôt et des taux : ON DELETE SET NULL, la trace ne bloque pas la suppression d'un compte.
  FOR f IN SELECT * FROM (VALUES
    ('client_invoices', 'client_invoices_deposited_by_users_id_fk', 'deposited_by'),
    ('clients', 'clients_withholding_updated_by_users_id_fk', 'withholding_updated_by')
  ) AS v(tbl, name, col) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = f.tbl::regclass AND conname = f.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE SET NULL', f.tbl, f.name, f.col);
    END IF;
  END LOOP;
  FOR c IN SELECT * FROM (VALUES
    ('clients_withholding_vat_rate_check', 'CHECK (withholding_vat_rate IS NULL OR (withholding_vat_rate >= 0 AND withholding_vat_rate <= 100))'),
    ('clients_withholding_is_rate_check', 'CHECK (withholding_is_rate IS NULL OR (withholding_is_rate >= 0 AND withholding_is_rate <= 100))'),
    ('clients_withholding_is_base_check', 'CHECK (withholding_is_base IN (''ht'', ''ttc''))')
  ) AS v(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'clients'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE clients ADD CONSTRAINT %I %s NOT VALID', c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'clients'::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE clients VALIDATE CONSTRAINT %I', c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'clients : lignes hors contrainte %, laissée NOT VALID', c.name;
      END;
    END IF;
  END LOOP;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes de retenue client non posées : verrou indisponible, nouvel essai au démarrage suivant';
END $$;
