-- Lot Q1 (drapeau qhse) : contrôles inopinés QHSE, en cabine et à l'arrêt.
-- qhse_inspection_criteria : grille de critères configurable (code stable, libellé, nature, actif).
-- qhse_inspections : une fiche par contrôle ; items jsonb = [{criterionId, code, label, conform, observation?}],
-- code et libellé figés à la saisie. Aucun effet sur les tables existantes.
-- Rejoué à chaque démarrage par server/init-database.ts (applyMigrationSqlFiles) ; le même SQL est porté par
-- QHSE_INSPECTIONS_SQL (AGENTS.md §5), comparé par tests/unit/server/qhse-inspections-schema.test.ts.
-- Critères d'origine : ceux que cite le document « Intégration du module QHSE dans le SI de T.A.Y » (fiches de
-- contrôle inopiné en cabine et à l'arrêt). La fiche à l'arrêt y est suivie d'un « etc. » : le reste de la grille
-- est à saisir par l'administration. Semis par code, ON CONFLICT DO NOTHING : un critère renommé ou désactivé
-- par l'administration n'est jamais réécrit au démarrage suivant.
-- Retour arrière : retirer la constante, son appel et ce fichier, déployer, puis DROP TABLE qhse_inspections,
-- qhse_inspection_criteria (sinon le démarrage suivant les recrée).
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));

CREATE TABLE IF NOT EXISTS qhse_inspection_criteria (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  category text NOT NULL CHECK (category IN ('cabin', 'stop')),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS qhse_inspections (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('cabin', 'stop')),
  inspected_at timestamp NOT NULL DEFAULT now(),
  location text NOT NULL CHECK (length(btrim(location)) > 0),
  vehicle_id integer NOT NULL REFERENCES vehicles(id),
  driver_id integer NOT NULL REFERENCES drivers(id),
  inspector_id integer NOT NULL REFERENCES users(id),
  items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(items) = 'array'),
  general_observation text,
  created_by integer REFERENCES users(id),
  updated_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qhse_inspections_driver ON qhse_inspections (driver_id, inspected_at);
CREATE INDEX IF NOT EXISTS idx_qhse_inspections_vehicle ON qhse_inspections (vehicle_id);

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
