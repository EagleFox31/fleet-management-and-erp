-- O3 lot 3b : historique des changements du prix convenu d'une mission (qui, quand, avant/après, motif).
-- Jumelle de MISSION_PRICE_HISTORY_SQL (server/init-database.ts) : tests/unit/server/mission-price-history-schema.test.ts compare les deux.
-- Table neuve, contraintes posées à la création ; aucune ligne rétro-remplie. Après 20261106_mission_agreed_price.sql.
SELECT pg_advisory_xact_lock(hashtext('fleetmaster_migrations'));
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS mission_price_history (
  id serial PRIMARY KEY,
  mission_id integer NOT NULL,
  old_price numeric(15,0),
  new_price numeric(15,0),
  old_tariff_grid_id integer,
  new_tariff_grid_id integer,
  reason text,
  changed_by integer,
  changed_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT mission_price_history_mission_id_missions_id_fk FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
  CONSTRAINT mission_price_history_changed_by_users_id_fk FOREIGN KEY (changed_by) REFERENCES users(id),
  CONSTRAINT mission_price_history_price_check CHECK ((old_price IS NULL OR old_price >= 0) AND (new_price IS NULL OR new_price >= 0))
);
CREATE INDEX IF NOT EXISTS mission_price_history_mission_idx ON mission_price_history (mission_id, changed_at);
