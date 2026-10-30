-- Traçabilité stock : la demande de pièce porte l'utilisateur qui a enregistré l'entrée en stock.
-- Rejoué automatiquement au démarrage via server/init-database.ts (applyMigrationSqlFiles).
-- Les demandes déjà reçues restent à NULL : le réceptionnaire d'origine n'a pas été conservé.

ALTER TABLE part_requirements
  ADD COLUMN IF NOT EXISTS received_by integer REFERENCES users(id);
