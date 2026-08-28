-- Traçabilité stock : aligner parts et tires sur created_by / updated_by / created_at / updated_at
-- Rejoué automatiquement au démarrage via server/init-database.ts (applyMigrationSqlFiles).
-- Ce fichier sert aussi de référence pour application manuelle dans Neon Console si besoin.

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();

UPDATE parts
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE tires
  ADD COLUMN IF NOT EXISTS created_by integer REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_by integer REFERENCES users(id);

UPDATE tires
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;
