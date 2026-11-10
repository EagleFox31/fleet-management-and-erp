-- Preuve de livraison (POD) : fichiers déposés sur une mission, en ajouts seulement.
-- Jumelle de MISSION_POD_FILES_SQL (server/init-database.ts) : tests/unit/server/mission-pod-files-schema.test.ts compare les deux.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS mission_pod_files (
  id serial PRIMARY KEY,
  mission_id integer NOT NULL
    CONSTRAINT mission_pod_files_mission_id_missions_id_fk REFERENCES missions(id),
  path text NOT NULL,
  original_name text,
  mime text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  uploaded_by integer NOT NULL
    CONSTRAINT mission_pod_files_uploaded_by_users_id_fk REFERENCES users(id),
  uploaded_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mission_pod_files_mime_check CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT mission_pod_files_size_check CHECK (size_bytes > 0),
  CONSTRAINT mission_pod_files_mission_sha256_unique UNIQUE (mission_id, sha256)
);

CREATE INDEX IF NOT EXISTS mission_pod_files_mission_idx ON mission_pod_files (mission_id, uploaded_at);

DO $$
DECLARE
  c record;
BEGIN
  -- Table déjà créée sans ces contraintes (drizzle-kit push antérieur) : la création conditionnelle est sautée.
  -- CHECK posé NOT VALID puis validé : une ligne non conforme laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS). Noms identiques à shared/schema.ts.
  FOR c IN SELECT * FROM (VALUES
    ('mission_pod_files_mime_check', 'CHECK (mime IN (''application/pdf'', ''image/jpeg'', ''image/png'', ''image/webp''))'),
    ('mission_pod_files_size_check', 'CHECK (size_bytes > 0)')
  ) AS v(name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_pod_files'::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE mission_pod_files ADD CONSTRAINT %I %s NOT VALID', c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_pod_files'::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE mission_pod_files VALIDATE CONSTRAINT %I', c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING 'mission_pod_files : lignes hors contrainte %, laissée NOT VALID', c.name;
      END;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'mission_pod_files'::regclass
                 AND conname = 'mission_pod_files_mission_sha256_unique') THEN
    BEGIN
      ALTER TABLE mission_pod_files ADD CONSTRAINT mission_pod_files_mission_sha256_unique UNIQUE (mission_id, sha256);
    EXCEPTION WHEN unique_violation THEN
      RAISE WARNING 'mission_pod_files : doublons (mission, sha256), contrainte mission_pod_files_mission_sha256_unique non posée';
    END;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes mission_pod_files non réconciliées : verrou de table indisponible';
END $$;
