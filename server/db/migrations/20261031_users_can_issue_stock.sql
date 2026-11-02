-- Droit de sortie de stock en dérogation du chef d'atelier, retirable par l'administrateur.
-- Rejoué automatiquement au démarrage via server/init-database.ts (applyMigrationSqlFiles).
-- Les comptes existants gardent le droit (DEFAULT true) : aucun changement de comportement.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS can_issue_stock boolean NOT NULL DEFAULT true;
