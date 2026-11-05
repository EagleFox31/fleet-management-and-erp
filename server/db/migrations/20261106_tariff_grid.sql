-- O3 : grille tarifaire (prix suggéré par client, trajet, type de marchandise et période).
-- Jumelle de TARIFF_GRID_SQL (server/init-database.ts) : tests/unit/server/tariff-grid-schema.test.ts compare les deux.
-- Chevauchement de périodes refusé par le service (409) ; l'index unique n'attrape que le doublon exact.
-- Index unique : un client NULL (tarif générique) compte comme un client (COALESCE), les NULL étant distincts en PostgreSQL.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE TABLE IF NOT EXISTS tariff_grid (
  id serial PRIMARY KEY,
  client_id integer CONSTRAINT tariff_grid_client_id_clients_id_fk REFERENCES clients(id),
  origin text NOT NULL,
  destination text NOT NULL,
  cargo_type text NOT NULL DEFAULT '',
  pricing_unit text NOT NULL,
  unit_price numeric(15,2) NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by integer CONSTRAINT tariff_grid_created_by_users_id_fk REFERENCES users(id),
  updated_by integer CONSTRAINT tariff_grid_updated_by_users_id_fk REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT tariff_grid_pricing_unit_check CHECK (pricing_unit IN ('ton', 'container', 'trip')),
  CONSTRAINT tariff_grid_unit_price_check CHECK (unit_price >= 0),
  CONSTRAINT tariff_grid_period_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS tariff_grid_key_unique
  ON tariff_grid ((CASE WHEN client_id IS NULL THEN 0 ELSE client_id END), (lower(origin)), (lower(destination)), (lower(cargo_type)), (valid_from));

DO $$
DECLARE
  c record;
BEGIN
  -- Table déjà créée sans ces contraintes : CHECK posé NOT VALID puis validé ; une ligne non conforme
  -- laisse un WARNING, relu par reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS). Noms identiques à shared/schema.ts.
  FOR c IN SELECT * FROM (VALUES
    ('tariff_grid_pricing_unit_check', 'CHECK (pricing_unit IN (''ton'', ''container'', ''trip''))'),
    ('tariff_grid_unit_price_check', 'CHECK (unit_price >= 0)'),
    ('tariff_grid_period_check', 'CHECK (valid_to IS NULL OR valid_to >= valid_from)')
  ) AS t(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tariff_grid'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE tariff_grid ADD CONSTRAINT %I %s NOT VALID', c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tariff_grid'::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE tariff_grid VALIDATE CONSTRAINT %I', c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'tariff_grid : lignes hors contrainte %, laissée NOT VALID', c.name;
      END;
    END IF;
  END LOOP;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes tariff_grid non réconciliées : verrou de table indisponible';
END $$;
