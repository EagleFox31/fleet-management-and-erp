-- Règlement fournisseur : un règlement saisi (non rapproché) peut être rejeté, avec motif et auteur.
-- Rejoué automatiquement au démarrage via server/init-database.ts, qui porte les mêmes ordres.
-- Rétroactif : colonnes nulles sur les règlements existants, aucun statut modifié.

ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejected_by integer REFERENCES users(id);

ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejected_at timestamp;

ALTER TABLE supplier_invoice_settlements ADD COLUMN IF NOT EXISTS rejection_reason text;
