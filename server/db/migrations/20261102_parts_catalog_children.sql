-- PRT1 / CAT2 : tables enfants du catalogue de pièces (spécifications, variantes) et pièces associées à une panne.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté par
-- PARTS_CATALOG_CHILDREN_SQL (AGENTS.md §5), comparé par tests/unit/server/parts-catalog-children-schema.test.ts.
-- Rétroactif : CREATE TABLE IF NOT EXISTS (ces tables n'existaient que par drizzle-kit push) ; les contraintes
-- portent explicitement le nom généré par drizzle (<table>_<colonne>_<table cible>_<colonne cible>_fk), pour qu'un
-- futur drizzle-kit push ne voie aucune dérive. fault_catalog_parts : la FK panne passe en ON DELETE CASCADE (supprimer
-- une panne emporte ses lignes) ; la FK pièce passe en ON DELETE RESTRICT (une pièce utilisée par une panne ne se
-- supprime pas : le service répond 409 avant). Avant l'index unique du couple (panne, pièce), seuls les doublons
-- strictement identiques (panne, pièce, quantité, optionnel) sont supprimés, la ligne la plus ancienne gardée (nombre
-- signalé par NOTICE) ; si des lignes divergentes subsistent, l'index n'est pas posé et un WARNING le signale.
-- part_specifications : unicité (pièce, nom insensible à la casse), non posée avec un WARNING si des homonymes existent.
-- Retour arrière : retirer PARTS_CATALOG_CHILDREN_SQL de init-database.ts et ce fichier, puis
--   DROP INDEX IF EXISTS ux_fault_catalog_parts_fault_part, ux_part_specifications_part_name ;
--   (les FK peuvent rester ; les doublons identiques supprimés ne sont pas restitués).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE TABLE IF NOT EXISTS part_specifications (
  id serial PRIMARY KEY,
  part_id integer,
  specification_name text NOT NULL,
  specification_value text NOT NULL,
  unit text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT part_specifications_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS part_variants (
  id serial PRIMARY KEY,
  part_id integer,
  variant_name text NOT NULL,
  variant_code text NOT NULL UNIQUE,
  additional_price numeric(10,2) DEFAULT '0',
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT part_variants_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS fault_catalog (
  id serial PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  category text NOT NULL,
  vehicle_brand text,
  symptoms text[],
  diagnostic_steps text[],
  repair_steps text[],
  estimated_duration integer,
  minimum_cost real,
  maximum_cost real,
  created_by integer,
  validated_by integer,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fault_catalog_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fault_catalog_validated_by_users_id_fk FOREIGN KEY (validated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS fault_catalog_parts (
  id serial PRIMARY KEY,
  fault_catalog_id integer NOT NULL,
  part_id integer NOT NULL,
  quantity integer DEFAULT 1,
  is_optional boolean DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fault_catalog_parts_fault_catalog_id_fault_catalog_id_fk FOREIGN KEY (fault_catalog_id) REFERENCES fault_catalog(id) ON DELETE CASCADE,
  CONSTRAINT fault_catalog_parts_part_id_parts_id_fk FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_part_specifications_part_id ON part_specifications (part_id);

CREATE INDEX IF NOT EXISTS idx_part_variants_part_id ON part_variants (part_id);

CREATE INDEX IF NOT EXISTS idx_fault_catalog_parts_part_id ON fault_catalog_parts (part_id);

DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT c.conname, a.attname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'fault_catalog_parts'::regclass AND c.contype = 'f'
      AND ((a.attname = 'fault_catalog_id' AND c.confdeltype <> 'c')
        OR (a.attname = 'part_id' AND c.confdeltype <> 'r'))
  LOOP
    EXECUTE format('ALTER TABLE fault_catalog_parts DROP CONSTRAINT %I', fk.conname);
    IF fk.attname = 'fault_catalog_id' THEN
      ALTER TABLE fault_catalog_parts ADD CONSTRAINT fault_catalog_parts_fault_catalog_id_fault_catalog_id_fk
        FOREIGN KEY (fault_catalog_id) REFERENCES fault_catalog(id) ON DELETE CASCADE;
    ELSE
      ALTER TABLE fault_catalog_parts ADD CONSTRAINT fault_catalog_parts_part_id_parts_id_fk
        FOREIGN KEY (part_id) REFERENCES parts(id) ON DELETE RESTRICT;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM fault_catalog_parts
  WHERE id NOT IN (
    SELECT min(id) FROM fault_catalog_parts GROUP BY fault_catalog_id, part_id, quantity, is_optional
  );
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed > 0 THEN
    RAISE NOTICE 'fault_catalog_parts : % doublon(s) identique(s) (panne, pièce, quantité, optionnel) supprimé(s), ligne la plus ancienne conservée', removed;
  END IF;
  IF EXISTS (SELECT 1 FROM fault_catalog_parts GROUP BY fault_catalog_id, part_id HAVING count(*) > 1) THEN
    RAISE WARNING 'ux_fault_catalog_parts_fault_part non posé : lignes divergentes (quantité ou optionnel) pour un même couple (panne, pièce)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS ux_fault_catalog_parts_fault_part ON fault_catalog_parts (fault_catalog_id, part_id);
  END IF;
END $$;

DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS ux_part_specifications_part_name ON part_specifications (part_id, lower(specification_name));
EXCEPTION WHEN unique_violation THEN
  RAISE WARNING 'ux_part_specifications_part_name non posé : spécifications homonymes existantes pour une même pièce';
END $$;
