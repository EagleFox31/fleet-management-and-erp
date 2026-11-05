-- Lot Q1 (drapeau qhse) : contrôles inopinés QHSE, en cabine et à l'arrêt.
-- qhse_inspection_criteria : grille de critères configurable (code stable, libellé, nature, actif).
-- qhse_inspections : une fiche par contrôle ; items jsonb = [{criterionId, code, label, conform, observation?}],
-- code et libellé figés à la saisie. Aucun effet sur les tables existantes.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté par
-- QHSE_INSPECTIONS_SQL (AGENTS.md §5), comparé par tests/unit/server/qhse-inspections-schema.test.ts.
-- Contraintes nommées comme dans shared/schema.ts ; sur une table déjà créée sans elles, posées NOT VALID puis
-- validées, et relues par reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS).
-- Critères d'origine : ceux que cite le document « Intégration du module QHSE dans le SI de T.A.Y » (fiches de
-- contrôle inopiné en cabine et à l'arrêt). La fiche à l'arrêt y est suivie d'un « etc. » : le reste de la grille
-- est à saisir par l'administration. Semis par code, ON CONFLICT DO NOTHING : un critère renommé ou désactivé
-- par l'administration n'est jamais réécrit au démarrage suivant.
-- Retour arrière : retirer la constante, son appel et ce fichier, déployer, puis DROP TABLE qhse_inspections,
-- qhse_inspection_criteria (sinon le démarrage suivant les recrée).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS qhse_inspection_criteria (
  id serial PRIMARY KEY,
  code text NOT NULL CONSTRAINT qhse_inspection_criteria_code_key UNIQUE,
  label text NOT NULL CONSTRAINT qhse_inspection_criteria_label_check CHECK (length(btrim(label)) > 0),
  category text NOT NULL CONSTRAINT qhse_inspection_criteria_category_check CHECK (category IN ('cabin', 'stop')),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qhse_inspections (
  id serial PRIMARY KEY,
  kind text NOT NULL CONSTRAINT qhse_inspections_kind_check CHECK (kind IN ('cabin', 'stop')),
  inspected_at timestamp NOT NULL DEFAULT now(),
  location text NOT NULL CONSTRAINT qhse_inspections_location_check CHECK (length(btrim(location)) > 0),
  vehicle_id integer NOT NULL REFERENCES vehicles(id),
  driver_id integer NOT NULL REFERENCES drivers(id),
  inspector_id integer NOT NULL REFERENCES users(id),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT qhse_inspections_items_check CHECK (jsonb_typeof(items) = 'array'),
  general_observation text,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qhse_inspections_driver ON qhse_inspections (driver_id, inspected_at);
CREATE INDEX IF NOT EXISTS idx_qhse_inspections_vehicle ON qhse_inspections (vehicle_id);

DO $$
DECLARE
  c record;
  existing text;
BEGIN
  -- Tables déjà créées sans ces contraintes (drizzle-kit push antérieur, push --force) : la création
  -- conditionnelle est sautée. CHECK posé NOT VALID puis validé : une ligne non conforme laisse un WARNING, relu par
  -- reportCdcConstraintGaps (CDC_RECONCILED_CONSTRAINTS), pas un démarrage bloqué. Noms identiques à shared/schema.ts.
  FOR c IN SELECT * FROM (VALUES
    ('qhse_inspection_criteria', 'qhse_inspection_criteria_label_check', 'CHECK (length(btrim(label)) > 0)'),
    ('qhse_inspection_criteria', 'qhse_inspection_criteria_category_check', 'CHECK (category IN (''cabin'', ''stop''))'),
    ('qhse_inspections', 'qhse_inspections_kind_check', 'CHECK (kind IN (''cabin'', ''stop''))'),
    ('qhse_inspections', 'qhse_inspections_location_check', 'CHECK (length(btrim(location)) > 0)'),
    ('qhse_inspections', 'qhse_inspections_items_check', 'CHECK (jsonb_typeof(items) = ''array'')')
  ) AS v(tbl, name, def) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s NOT VALID', c.tbl, c.name, c.def);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = c.tbl::regclass AND conname = c.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.tbl, c.name);
      EXCEPTION WHEN check_violation THEN
        RAISE WARNING '% : lignes hors contrainte %, laissée NOT VALID', c.tbl, c.name;
      END;
    END IF;
  END LOOP;
  -- Unicité du code sous le nom attendu : celle posée sous un autre nom (qhse_inspection_criteria_code_unique
  -- d'un push Drizzle antérieur) est renommée ; des doublons laissent un WARNING.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'qhse_inspection_criteria'::regclass
                 AND conname = 'qhse_inspection_criteria_code_key') THEN
    SELECT k.conname INTO existing FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
    WHERE k.conrelid = 'qhse_inspection_criteria'::regclass AND k.contype = 'u'
      AND cardinality(k.conkey) = 1 AND a.attname = 'code'
    LIMIT 1;
    IF existing IS NOT NULL THEN
      EXECUTE format('ALTER TABLE qhse_inspection_criteria RENAME CONSTRAINT %I TO qhse_inspection_criteria_code_key', existing);
    ELSE
      BEGIN
        ALTER TABLE qhse_inspection_criteria ADD CONSTRAINT qhse_inspection_criteria_code_key UNIQUE (code);
      EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'qhse_inspection_criteria : codes en double, contrainte qhse_inspection_criteria_code_key non posée';
      END;
    END IF;
  END IF;
EXCEPTION WHEN lock_not_available THEN
  RAISE WARNING 'contraintes QHSE non réconciliées : verrou de table indisponible';
END $$;

INSERT INTO qhse_inspection_criteria (code, label, category, sort_order) VALUES
  ('cabin_epi', 'Port des EPI', 'cabin', 10),
  ('cabin_tenue_de_route', 'Tenue de route', 'cabin', 20),
  ('cabin_telephone', 'Téléphone au volant', 'cabin', 30),
  ('cabin_ceinture', 'Port de la ceinture', 'cabin', 40),
  ('cabin_fumer_manger', 'Fumer ou manger au volant', 'cabin', 50),
  ('cabin_cession_conduite', 'Cession de la conduite', 'cabin', 60),
  ('cabin_passager', 'Passager à bord', 'cabin', 70),
  ('cabin_exces_vitesse', 'Excès de vitesse', 'cabin', 80),
  ('cabin_signalisation_verticale', 'Respect de la signalisation verticale', 'cabin', 90),
  ('cabin_heures_conduite', 'Heures de conduite', 'cabin', 100),
  ('stop_epi', 'Port des EPI', 'stop', 10),
  ('stop_stationnement', 'Stationnement sur emplacement dédié', 'stop', 20),
  ('stop_cales', 'Utilisation des cales', 'stop', 30),
  ('stop_portieres', 'Fermeture des portières', 'stop', 40),
  ('stop_signalisation_vehicule', 'Signalisation du véhicule', 'stop', 50),
  ('stop_gardien', 'Présence d''un gardien', 'stop', 60)
ON CONFLICT (code) DO NOTHING;
